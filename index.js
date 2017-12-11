const path = require('path');
const fs = require('fs');
const express = require('express');
const app = express();
const bodyParser = require('body-parser');
const axios = require('axios');
const moment = require('moment');

const botId = '492845691:AAGq50SceR8P9foZGepZhVf8eSwXHWbXaQI';
const file = path.join(__dirname, 'data.json');

moment.locale('ru');

try {
  fs.writeFileSync(file, JSON.stringify({
    history: [],
    initialUser: null,
    diff: 0
  }), { flag: 'wx' });
} catch (err) {}

app
  .use(bodyParser.json())
  .use(bodyParser.urlencoded({
    extended: true
  }))
  .post('/new-message', (req, res) => {
  	console.log(req.body);
  	
  	if (!req.body.message) return res.end();

    const {
      message: {
        from: {
          id: userId,
          username,
					first_name: firstName,
					last_name: lastName
        },
        chat: {
          id: chatId
        },
        date,
        text
      }
    } = req.body;

    const matches = text.match(/^(-?\d+) ([^]+)$/);

    if (matches) {
      let [, amount, description] = matches;
			const fullName = `${firstName} ${lastName}`;
      const data = JSON.parse(fs.readFileSync(file));
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
				date: moment.utc(date * 1000).format('DD MMMM YYYY в HH:mm UTC')
      });

      const action = amount > 0
				? 'дал взаймы'
				: amount === 0
					? 'фанится'
					: 'получил';
      const amountText = amount === 0
				? ''
				: ` ${Math.abs(amount)}р. на ${description}`;

      fs.writeFileSync(file, JSON.stringify(data), 'utf8');

			axios.post(`https://api.telegram.org/bot${botId}/sendMessage`, {
				chat_id: chatId,
				text: `${fullName} ${action}${amountText}`
			});

			return res.end();
		}

		if (text === 'get') {
			const data = JSON.parse(fs.readFileSync(file));
			const {
				initialUser,
				diff
			} = data;

			if (!initialUser) {
				return res.end();
			}

			const action = diff > 0
				? 'дал взаймы'
				: diff === 0
					? 'ничего никому не должен'
					: 'должен';
			const amountText = diff === 0
				? ''
				: ` ${Math.abs(diff)}р`;

			axios.post(`https://api.telegram.org/bot${botId}/sendMessage`, {
				chat_id: chatId,
				text: `${initialUser.fullName} ${action}${amountText}`
			});

			return res.end();
		}

		if (text === 'history') {
			const data = JSON.parse(fs.readFileSync(file));
			const {
				history
			} = data;

			axios.post(`https://api.telegram.org/bot${botId}/sendMessage`, {
				chat_id: chatId,
				text: history
					.map(({
						amount,
						fullName,
						description,
						date
					}) => `${amount} ${fullName} ${description} ${date}`)
					.join('\n')
			});

			return res.end();
		}

		res.end();
  })
  .listen(process.env.PORT, () => {
    console.log(`Telegram app listening on port ${process.env.PORT}!`);
  });
