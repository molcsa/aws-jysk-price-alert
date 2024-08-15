const axios = require('axios');
const cheerio = require('cheerio');
const { SESClient, SendEmailCommand } = require('@aws-sdk/client-ses');

const sesClient = new SESClient({ region: process.env.AWS_REGION });

const sendEmail = async (
  toAddress,
  fromAddress,
  subject,
  textBody,
  htmlBody
) => {
  const params = {
    Destination: {
      ToAddresses: [toAddress],
    },
    Message: {
      Body: {
        Text: { Data: textBody },
        Html: { Data: htmlBody },
      },
      Subject: { Data: subject },
    },
    Source: fromAddress,
  };

  const command = new SendEmailCommand(params);

  try {
    const data = await sesClient.send(command);
    return data;
  } catch (err) {
    return err;
  }
};

const scrapePriceAndName = async (url) => {
  try {
    const response = await axios.get(url);
    const data = response.data;
    const $ = cheerio.load(data);
    const priceString = $('.ssr-product-price__value').text();
    const price = parseFloat(priceString.match(/^[0-9]+/)[0]);
    const productName = $('.product-sumbox-series').text();
    console.log(`Current price of ${productName}: ${priceString}`);
    return { productName, price };
  } catch (err) {
    console.error(err);
    return {};
  }
};

exports.handler = (event) => {
  if (!Array.isArray(event.products)) {
    console.error(
      'event.products is not an array, check event params! Exiting...'
    );
    return;
  }

  event.products.forEach(async ({ url, targetPrice }) => {
    const { price, productName } = await scrapePriceAndName(url);
    const shouldSendEmail = Boolean(price && price < parseFloat(targetPrice));

    if (!shouldSendEmail) {
      console.log(
        `Not sending email for ${productName}, because price is ${price} and target price is ${targetPrice}`
      );
      return;
    }

    const toAddress = process.env.TO_EMAIL;
    const fromAddress = process.env.FROM_EMAIL;
    const subject = `AWS Jysk árfigyelő - A(z) ${productName} termék ára csökkent`;
    const htmlBody = `
      <html>
        <body>
          <h1> Jysk árfigyelő értesítés </h1>
          <p style="font-size: 16px;">
            A figyelt 
            <a href="${url}" target="_blank" style="color:#143c8a; font-weight: bold;">${productName}</a> 
            termék ára a beállított érték (${targetPrice} Ft) alá csökkent.
            <br>
            Jelenlegi ára: <b>${price} Ft</b>
          </p>
          <a href="${url}" target="_blank" style="
            display: inline-block;
            background-color: #143c8a;
            color: #fff;
            font-size: 16px;
            font-weight: bold;
            border: none;
            border-radius: 6px;
            padding: 10px 40px;
            cursor: pointer;
            text-decoration: none;
          ">
            Megnézem
          </a>
        </body>
      </html>      
    `;
    // For email clients which don't support HTML
    const textBody = `A megfigyelt ${productName} termék (${url}) ára a beállított érték (${targetPrice} Ft) alá csökkent. Jelenlegi ára: ${price} Ft`;

    const result = await sendEmail(
      toAddress,
      fromAddress,
      subject,
      textBody,
      htmlBody
    );

    if (result instanceof Error) {
      console.error(`Error sending email for ${productName}: `, result);
    } else {
      console.log(`Email for ${productName} sent successfully: `, result);
    }
  });
};
