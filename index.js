const util = require('util');

const Application = require('koa');
const bodyParser = require('koa-bodyparser');
const axios = require('axios');
const moment = require('moment');
const redis = require('redis');

const botId = '492845691:AAGq50SceR8P9foZGepZhVf8eSwXHWbXaQI';
const imageUrl = 'https://loanscanada.ca/wp-content/uploads/2017/05/Borrowing_money.jpg';

const {
  PORT,
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

console.log(process.env);

const app = new Application();

moment.locale('ru');

app
  .use(bodyParser())
  .use(async (ctx, next) => {
    try {
      await next();
    } catch (err) {
      console.log(err);
    } finally {
      ctx.body = '';

      if (ctx.inlineQuery && !ctx.answerSent) {
        axios.post(`https://api.telegram.org/bot${botId}/answerInlineQuery`, {
          inline_query_id: ctx.inlineQuery.id,
          results: JSON.stringify([]),
          cache_time: 0,
          next_offset: ''
          // text: `${fullName} ${action}${amountText}`
        });
      }
    }
  })
  .use(async (ctx, next) => {
    if (ctx.url !== '/new-message' || ctx.method !== 'POST') {
      return next();
    }

    console.log(ctx.request.body);

    if (!ctx.request.body.inline_query) {
      return next();
    }

    ctx.inlineQuery = ctx.request.body.inline_query;

    const {
      inline_query: {
        id: queryId,
        from: {
          id: userId,
          first_name: firstName,
          last_name: lastName
        },
        query
      }
    } = ctx.request.body;
    const redisKey = 'money-telegram-bot';

    const matches = query.match(/^(-?\d+) ([^]+)$/);
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
      let [, amount, description] = matches;
      const fullName = `${firstName} ${lastName}`;
      const data = await getData();
      const {
        initialUser,
        history
      } = data;

      amount = +amount;

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

      const action = amount > 0
        ? 'дал'
        : amount === 0
          ? 'фанится'
          : 'взял';
      const amountText = amount === 0
        ? ''
        : ` ${Math.abs(amount)}р. на ${description}`;

      await replaceData(data);

      await axios.post(`https://api.telegram.org/bot${botId}/answerInlineQuery`, {
        inline_query_id: queryId,
        results: JSON.stringify([
          {
            type: 'photo',
            id: moment().toJSON(),
            photo_url: imageUrl,
            thumb_url: imageUrl,
            photo_width: 900,
            photo_height: 900,
            input_message_content: `${fullName} ${action}${amountText}`
          }
        ]),
        cache_time: 0,
        next_offset: ''
        // text: `${fullName} ${action}${amountText}`
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
