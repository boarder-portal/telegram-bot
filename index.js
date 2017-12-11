const path = require('path');
const fs = require('fs');
const express = require('express');
const app = express();
const bodyParser = require('body-parser');
const axios = require('axios');

const botId = '492845691:AAGq50SceR8P9foZGepZhVf8eSwXHWbXaQI';
const file = path.join(__dirname, 'data.json');

try {
  fs.writeFileSync(file, JSON.stringify({
    history: [],
    initialUser: {
      id: null,
      name: ''
    },
    diff: 0
  }), { flag: 'wx' });
} catch (err) {}

app
  .use(bodyParser.json())
  .use(bodyParser.urlencoded({
    extended: true
  }))
  .post('/new-message', (req, res) => {
    const {
      message: {
        from: {
          id: userId,
          username
        },
        chat: {
          id: chatId
        },
        date,
        text
      }
    } = req.body;

    console.log(req.body);

    /*if (text.indexOf('get') !== 0 && text.indexOf('history') !== 0 && !/^-?\d+/.test(text)) {
      return res.end();
    }*/

    const matches = text.match(/^(-?\d+) ([^]+)$/);

    if (matches) {
      const [, amount, description] = matches;
      const data = JSON.parse(fs.readFileSync(file));
      const {
				initialUser: {
				  id: initialUserId
        },
        history
      } = data;

      if (!initialUserId) {
        data.initialUser = {
          id: userId,
          name: username
        };
      }

      data.diff += data.initialUser.id === userId ? +amount : -amount;
      history.push({
				amount: +amount,
				username,
				date
      });

      const action = amount > 0 ? amount === 0 ? 'фанится' : 'одолжил' : 'вернул';
      const amountText = amount === 0 ? '' : `${Math.abs(amount)}р`;

			axios.post(`https://api.telegram.org/bot${botId}/sendMessage`, {
				chat_id: chatId,
				text: `${username} ${action} ${amountText}.`
			});

			return res.end();
		}

		res.end();
  })
  .listen(process.env.PORT, () => {
    console.log('Telegram app listening on port 3000!');
  });
