'use strict';
// Builds the app for a Lambda function: DynamoDB store, real clock, game file next to the code.
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient } = require('@aws-sdk/lib-dynamodb');
const { createApp } = require('../app/app');
const { createDynamoStore } = require('../store/dynamo');
const { loadGameData } = require('../app/game-file');
const { fromLambdaEvent, toLambdaResponse } = require('../app/lambda');

function createHandler(role) {
  let app; // built once per warm container
  return async (event) => {
    app ??= createApp({
      role,
      store: createDynamoStore({
        client: DynamoDBDocumentClient.from(new DynamoDBClient({}), { marshallOptions: { removeUndefinedValues: true } }),
        tableName: process.env.TABLE_NAME,
      }),
      loadGameData,
    });
    return toLambdaResponse(await app.handle(fromLambdaEvent(event)));
  };
}

module.exports = { createHandler };
