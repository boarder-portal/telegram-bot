const path = require('path');
const util = require('util');

const Application = require('koa');
const bodyParser = require('koa-bodyparser');
const serve = require('koa-static');
const axios = require('axios');
const moment = require('moment');
const redis = require('redis');

const THUMB_URL = 'https://money-telegram-bot.herokuapp.com/thumb.jpg';

const {
  PORT = 3001,
  TELEGRAM_BOT_ID,
  REDIS_URL
} = process.env;

const client = redis.createClient({
  url: REDIS_URL
});

const redisGet = util.promisify(client.get).bind(client);
const redisSet = util.promisify(client.set).bind(client);
const redisDrop = util.promisify(client.del).bind(client);
const redisGetKeys = util.promisify(client.keys).bind(client);
const redisGetList = util.promisify(client.lrange).bind(client);
const redisPush = util.promisify(client.rpush).bind(client);

console.log(`State up: ${moment().toJSON()}`);

const app = new Application();

moment.locale('ru');

app
  .use(serve(path.resolve(__dirname, 'static')))
  .use(bodyParser())
  .use(async (ctx, next) => {
    try {
      await next();
    } catch (err) {
      console.log(err);
    } finally {
      ctx.body = '';

      if (ctx.inlineQuery && !ctx.answerSent) {
        console.log('sending fallback');

        (async () => {
          try {
            await axios.post(`https://api.telegram.org/bot${TELEGRAM_BOT_ID}/answerInlineQuery`, {
              inline_query_id: ctx.inlineQuery.id,
              results: [],
              next_offset: ''
            });
          } catch (err) {
            console.log(err);
          }
        })();
      }
    }
  })
  .use(async (ctx, next) => {
    if (ctx.url !== `/new-message/${TELEGRAM_BOT_ID}` || ctx.method !== 'POST') {
      return next();
    }

    console.log(ctx.request.body);

    const {
      inline_query,
      callback_query
    } = ctx.request.body;

    if (!inline_query && !callback_query) {
      return next();
    }

    if (callback_query) {
      const {
        from: {
          id: userId
        },
        inline_message_id,
        data = ''
      } = callback_query;
      const getDebtMatches = data.match(/^get-debt-(\d+)$/);
      const getHistoryMatches = data.match(/^get-history-(\d+)$/);
      const transactionMatches = data.match(/^(accept|decline)-(take|return)-(\d+)$/);

      if (getDebtMatches) {
        const masterUserId = +getDebtMatches[1];

        if (masterUserId === userId) {
          return next();
        }

        const minUserId = Math.min(userId, masterUserId);
        const maxUserId = Math.max(userId, masterUserId);
        const historyKey = `history-${minUserId}-${maxUserId}`;

        let history = await redisGetList(historyKey, 0, -1);

        if (!history) {
          await axios.post(`https://api.telegram.org/bot${TELEGRAM_BOT_ID}/editMessageText`, {
            inline_message_id,
            text: '_Истории выплат нет_',
            parse_mode: 'Markdown',
            reply_markup: {
              inline_keyboard: []
            }
          });

          return next();
        }

        history = history.map(JSON.parse);

        let debt = 0;

        history.forEach(({
          userId,
          method,
          amount
        }) => {
          if (userId === masterUserId) {
            if (method === 'take') {
              debt -= amount;
            } else {
              debt += amount;
            }
          } else {
            if (method === 'take') {
              debt += amount;
            } else {
              debt -= amount;
            }
          }
        });

        let caption;
        let parseModeOptions = {};

        if (debt === 0) {
          caption = '_Никто никому ничего не должен_';
          parseModeOptions = {
            parse_mode: 'Markdown'
          };
        } else if (debt > 0) {
          caption = `Я должен ${debt}р`;
        } else {
          caption = `Я дал в долг ${-debt}р`;
        }

        await axios.post(`https://api.telegram.org/bot${TELEGRAM_BOT_ID}/editMessageText`, {
          inline_message_id,
          text: caption,
          ...parseModeOptions,
          reply_markup: {
            inline_keyboard: []
          }
        });

        return next();
      }

      if (getHistoryMatches) {
        const masterUserId = +getHistoryMatches[1];

        if (masterUserId === userId) {
          return next();
        }

        const minUserId = Math.min(userId, masterUserId);
        const maxUserId = Math.max(userId, masterUserId);
        const historyKey = `history-${minUserId}-${maxUserId}`;

        let history = await redisGetList(historyKey, 0, -1);

        if (!history) {
          await axios.post(`https://api.telegram.org/bot${TELEGRAM_BOT_ID}/editMessageText`, {
            inline_message_id,
            text: '_Истории выплат нет_',
            parse_mode: 'Markdown',
            reply_markup: {
              inline_keyboard: []
            }
          });

          return next();
        }

        history = history.map(JSON.parse);

        const historyText = history
          .map(({
            fullName,
            method,
            date,
            amount,
            description
          }) => {
            const dateString = moment.utc(date).format('DD.MM.YYYY HH:mm UTC');
            const action = method === 'take' ? 'взял в долг' : 'вернул';

            return `${dateString}: ${fullName} ${action} ${amount}р${description ? ` (${description})` : ''}`;
          })
          .join('\n\n');

        await axios.post(`https://api.telegram.org/bot${TELEGRAM_BOT_ID}/editMessageText`, {
          inline_message_id,
          text: `История выплат:\n\n${historyText}`,
          reply_markup: {
            inline_keyboard: []
          }
        });

        return next();
      }

      if (!transactionMatches) {
        return next();
      }

      let [, response, method, queryId] = transactionMatches;
      const transactionCandidateKey = `transaction-candidate-${queryId}`;
      const transactionCandidate = await redisGet(transactionCandidateKey);

      if (!transactionCandidate) {
        await axios.post(`https://api.telegram.org/bot${TELEGRAM_BOT_ID}/editMessageText`, {
          inline_message_id,
          text: '_Срок хранения истек_',
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: []
          }
        });

        return next();
      }

      const {
        userId: masterUserId,
        fullName: masterFullName,
        amount,
        description
      } = JSON.parse(transactionCandidate);

      if (masterUserId === userId) {
        return next();
      }

      const accepted = response === 'accept';
      const text = method === 'take'
        ? `Я взял в долг ${amount}р${description ? ` (${description})` : ''}${accepted ? ' #money' : ''}`
        : `Я вернул ${amount}р${accepted ? ' #money' : ''}`;

      await redisDrop(transactionCandidateKey);

      const minUserId = Math.min(userId, masterUserId);
      const maxUserId = Math.max(userId, masterUserId);
      const historyKey = `history-${minUserId}-${maxUserId}`;

      await redisPush(historyKey, JSON.stringify({
        userId: masterUserId,
        fullName: masterFullName,
        method,
        date: +new Date(),
        amount,
        description
      }));

      await axios.post(`https://api.telegram.org/bot${TELEGRAM_BOT_ID}/editMessageText`, {
        inline_message_id,
        text: `${accepted ? '✅' : '❌'} ${text}`,
        reply_markup: {
          inline_keyboard: []
        }
      });

      return next();
    }

    ctx.inlineQuery = inline_query;

    const {
      id: queryId,
      from: {
        id: userId,
        username,
        first_name: firstName,
        last_name: lastName
      },
      query
    } = inline_query;
    const matches = query.match(/^(\d+)(?: ([^]*))?$/);

    if (matches) {
      let [, amount, description = ''] = matches;
      const fullName = username
        ? `@${username}`
        : `${firstName}${lastName ? ` ${lastName}` : ''}`;

      amount = +amount;

      await redisSet([`transaction-candidate-${queryId}`, JSON.stringify({
        userId,
        fullName,
        amount,
        description
      }), 'EX', 24 * 60 * 60]);

      await axios.post(`https://api.telegram.org/bot${TELEGRAM_BOT_ID}/answerInlineQuery`, {
        inline_query_id: queryId,
        results: [
          {
            type: 'article',
            id: `+${moment().toJSON()}`,
            thumb_url: THUMB_URL,
            thumb_width: 48,
            thumb_height: 48,
            input_message_content: {
              message_text: `Я взял в долг ${amount}р${description ? ` (${description})` : ''}`
            },
            reply_markup: {
              inline_keyboard: [[{
                text: 'Подтверждено',
                callback_data: `accept-take-${queryId}`
              }, {
                text: 'Отклонено',
                callback_data: `decline-take-${queryId}`
              }]]
            },
            title: 'Взял',
            description: `Взял в долг ${amount}р${description ? ` (${description})` : ''}`
          },
          {
            type: 'article',
            id: `-${moment().toJSON()}`,
            thumb_url: THUMB_URL,
            thumb_width: 48,
            thumb_height: 48,
            input_message_content: {
              message_text: `Я вернул ${amount}р`
            },
            reply_markup: {
              inline_keyboard: [[{
                text: 'Подтверждено',
                callback_data: `accept-return-${queryId}`
              }, {
                text: 'Отклонено',
                callback_data: `decline-return-${queryId}`
              }]]
            },
            title: 'Вернул',
            description: `Вернул ${amount}р`
          }
        ],
        cache_time: 0,
        next_offset: ''
      });

      ctx.answerSent = true;

      return next();
    }

    if (query === 'get') {
      await axios.post(`https://api.telegram.org/bot${TELEGRAM_BOT_ID}/answerInlineQuery`, {
        inline_query_id: queryId,
        results: [
          {
            type: 'article',
            id: `+${moment().toJSON()}`,
            thumb_url: THUMB_URL,
            thumb_width: 48,
            thumb_height: 48,
            input_message_content: {
              message_text: 'Я хочу получить текущий долг'
            },
            reply_markup: {
              inline_keyboard: [[{
                text: 'Получить текущий долг',
                callback_data: `get-debt-${userId}`
              }]]
            },
            title: 'Текущий долг',
            description: 'Я хочу получить текущий долг'
          }
        ],
        cache_time: 0,
        next_offset: ''
      });

      ctx.answerSent = true;

      return next();
    }

    if (query === 'history') {
      await axios.post(`https://api.telegram.org/bot${TELEGRAM_BOT_ID}/answerInlineQuery`, {
        inline_query_id: queryId,
        results: [
          {
            type: 'article',
            id: `+${moment().toJSON()}`,
            thumb_url: THUMB_URL,
            thumb_width: 48,
            thumb_height: 48,
            input_message_content: {
              message_text: 'Я хочу получить историю выплат'
            },
            reply_markup: {
              inline_keyboard: [[{
                text: 'Получить историю выплат',
                callback_data: `get-history-${userId}`
              }]]
            },
            title: 'История выплат',
            description: 'Я хочу получить историю выплат'
          }
        ],
        cache_time: 0,
        next_offset: ''
      });

      ctx.answerSent = true;

      return next();
    }

    await next();
  })
  .listen(PORT, () => {
    console.log(`Telegram app listening on port ${PORT}!`);
  });
