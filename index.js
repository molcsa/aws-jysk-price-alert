const axios = require('axios');
const cheerio = require('cheerio');
const { SESClient, SendEmailCommand } = require('@aws-sdk/client-ses');
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const {
  DynamoDBDocumentClient,
  ScanCommand,
  UpdateCommand,
} = require('@aws-sdk/lib-dynamodb');

const sesClient = new SESClient({ region: process.env.AWS_REGION });
const dbClient = new DynamoDBClient({ region: process.env.AWS_REGION });
const dynamodb = DynamoDBDocumentClient.from(dbClient); // DocumentClient wrapper for easier interactions

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
    const rawData = response.data;
    const $ = cheerio.load(rawData);
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

const getProducts = async () => {
  try {
    const scanData = await dynamodb.send(
      new ScanCommand({ TableName: process.env.DB_TABLE_NAME })
    );
    return scanData.Items;
  } catch (err) {
    console.error(err);
    return [];
  }
};

const setEmailSent = async (url) => {
  const updateParams = {
    TableName: process.env.DB_TABLE_NAME,
    Key: {
      productUrl: url,
    },
    UpdateExpression: 'set emailSent = :emailSent', // The expression to update the emailSent field
    ExpressionAttributeValues: {
      ':emailSent': true, // Set the value of emailSent to true
    },
    ReturnValues: 'UPDATED_NEW', // Returns only the updated attributes
  };

  try {
    const result = await dynamodb.send(new UpdateCommand(updateParams));
    console.log('Updated emailSent field.');
  } catch (err) {
    console.error('Error updating emailSent field:', err);
  }
};

exports.handler = async (event) => {
  const products = await getProducts();
  if (products.length === 0) {
    console.error('No products found in the database. Exiting...');
    return;
  }

  for (const { productUrl, targetPrice, emailSent = false } of products) {
    const { price, productName } = await scrapePriceAndName(productUrl);
    const shouldSendEmail =
      Boolean(price && price < parseFloat(targetPrice)) && !emailSent;

    if (!shouldSendEmail) {
      console.log(
        `Not sending email for ${productName} (price is ${price}, target price is ${targetPrice}, email was ${
          emailSent ? 'already' : 'not yet'
        } sent)`
      );
      continue;
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
            <a href="${productUrl}" target="_blank" style="color:#143c8a; font-weight: bold;">${productName}</a> 
            termék ára a beállított érték (${targetPrice} Ft) alá csökkent.
            <br>
            Jelenlegi ára: <b>${price} Ft</b>
          </p>
          <a href="${productUrl}" target="_blank" style="
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
    const textBody = `A megfigyelt ${productName} termék (${productUrl}) ára a beállított érték (${targetPrice} Ft) alá csökkent. Jelenlegi ára: ${price} Ft`;

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
      console.log(`Email for ${productName} sent successfully.`);
      await setEmailSent(productUrl);
    }
  }
};
