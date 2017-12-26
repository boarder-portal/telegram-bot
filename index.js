const path = require('path');
const util = require('util');

const Application = require('koa');
const bodyParser = require('koa-bodyparser');
const serve = require('koa-static');
const axios = require('axios');
const moment = require('moment');
const redis = require('redis');

const IMAGE_URL = 'https://money-telegram-bot.herokuapp.com/image.jpg';
const THUMB_URL = 'https://money-telegram-bot.herokuapp.com/thumb.jpg';

const botId = '492845691:AAGq50SceR8P9foZGepZhVf8eSwXHWbXaQI';

const {
  PORT = 3001,
  REDIS_URL
} = process.env;

const client = redis.createClient({
  url: REDIS_URL
});

const redisGet = util.promisify(client.get).bind(client);
const redisSet = util.promisify(client.set).bind(client);
const redisGetKeys = util.promisify(client.keys).bind(client);

redisGetKeys('*').then((result) => {
  console.log(result);
}, (err) => {
  console.log(err);
});

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
            await axios.post(`https://api.telegram.org/bot${botId}/answerInlineQuery`, {
              inline_query_id: ctx.inlineQuery.id,
              results: JSON.stringify([]),
              cache_time: 0,
              next_offset: ''
              // text: `${fullName} ${action}${amountText}`
            });
          } catch (err) {
            console.log(err);
          }
        })();
      }
    }
  })
  .use(async (ctx, next) => {
    if (ctx.url !== '/new-message' || ctx.method !== 'POST') {
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
      console.log(callback_query);

      return next();
    }

    ctx.inlineQuery = ctx.request.body.inline_query;

    const {
      id: queryId,
      from: {
        id: userId,
        first_name: firstName,
        last_name: lastName
      },
      query
    } = inline_query;
    const redisKey = 'money-telegram-bot';

    const matches = query.match(/^(\d+)(?: ([^]*))?$/);
    const getData = async () => {
      // let data = await redisGet(redisKey);
      let data = null;

      if (data) {
        data = JSON.parse(data);
      } else {
        data = {
          history: [],
          initialUser: null,
          diff: 0
        };

        // await redisSet(redisKey, data);
      }

      return data;
    };
    // const replaceData = (data) => redisSet(redisKey, JSON.stringify(data));
    const replaceData = () => null;

    if (matches) {
      let [, amount, description = ''] = matches;
      const fullName = `${firstName}${lastName ? ` ${lastName}` : ''}`;
      const data = await getData();
      const {
        initialUser,
        history
      } = data;

      amount = +amount;

      if (description) {
        description = ` (${description})`;
      }

      if (!initialUser) {
        data.initialUser = {
          id: userId,
          fullName
        };
      }

      data.diff += data.initialUser.id === userId ? amount : -amount;
      history.push({
        amount,
        fullName,
        description,
        date: moment.utc().format('DD MMMM YYYY в HH:mm UTC')
      });

      await replaceData(data);

      const keyboard = {
        inline_keyboard: [[{
          text: 'Подтверждено',
          callback_data: JSON.stringify({
            type: 'accept-button',
            userId,
            fullName,
            amount,
            description
          })
        }, {
          text: 'Отклонено',
          callback_data: JSON.stringify({
            type: 'decline-button'
          })
        }]]
      };

      await axios.post(`https://api.telegram.org/bot${botId}/answerInlineQuery`, {
        inline_query_id: queryId,
        results: [
          {
            type: 'article',
            id: `+${moment().toJSON()}`,
            thumb_url: THUMB_URL,
            thumb_width: 48,
            thumb_height: 48,
            input_message_content: {
              message_text: `${fullName} взял ${amount}р${description}`
            },
            reply_markup: keyboard,
            title: 'Взял',
            description: `Взял ${amount}р${description}`
          },
          {
            type: 'article',
            id: `-${moment().toJSON()}`,
            thumb_url: THUMB_URL,
            thumb_width: 48,
            thumb_height: 48,
            input_message_content: {
              message_text: `${fullName} вернул ${amount}р`
            },
            reply_markup: keyboard,
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
      const data = await getData();
      const {
        initialUser,
        diff
      } = data;

      if (!initialUser) {
        return next();
      }

      const action = diff > 0
        ? 'дал взаймы'
        : diff === 0
          ? 'ничего никому не должен'
          : 'должен';
      const amountText = diff === 0
        ? ''
        : ` ${Math.abs(diff)}р`;

      await axios.post(`https://api.telegram.org/bot${botId}/sendMessage`, {
        chat_id: '',
        text: `${initialUser.fullName} ${action}${amountText}`
      });

      return next();
    }

    if (query === 'history') {
      const data = await getData();
      const {
        history
      } = data;

      await axios.post(`https://api.telegram.org/bot${botId}/sendMessage`, {
        chat_id: '',
        text: history
          .map(({
            amount,
            fullName,
            description,
            date
          }) => `${amount} ${fullName} ${description} ${date}`)
          .join('\n')
      });

      return next();
    }

    await next();
  })
  .listen(PORT, () => {
    console.log(`Telegram app listening on port ${PORT}!`);
  });
