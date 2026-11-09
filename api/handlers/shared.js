'use strict';
// Builds the app for a Lambda function: DynamoDB store, real clock, game file next to the code.
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient } = require('@aws-sdk/lib-dynamodb');
const { createApp } = require('../app/app');
const { createDynamoStore } = require('../store/dynamo');
const { loadGameData } = require('../app/game-file');
const { fromLambdaEvent, toLambdaResponse } = require('../app/lambda');
const { createEvents } = require('../lib/events');
const { createS3Blobs } = require('../store/blobs');
const crypto = require('node:crypto');

// The events (games prepared in a private bucket): only the admin function is given the bucket names (terraform/lambda.tf).
function createEventsFromEnvironment(env = process.env) {
  if (!env.EVENTS_BUCKET || !env.SITE_BUCKET) return null;
  const s3 = require('@aws-sdk/client-s3'); // provided by the Lambda runtime
  const client = new s3.S3Client({});
  return createEvents({
    blobs: createS3Blobs({ s3: client, bucket: env.EVENTS_BUCKET, commands: s3 }),
    siteBlobs: createS3Blobs({ s3: client, bucket: env.SITE_BUCKET, commands: s3 }),
    newId: () => crypto.randomBytes(8).toString('hex'),
  });
}

function createHandler(role) {
  let app; // built once per warm container
  return async (event) => {
    app ??= createApp({
      role,
      events: role === 'admin' ? createEventsFromEnvironment() : null,
      store: createDynamoStore({
        client: DynamoDBDocumentClient.from(new DynamoDBClient({}), { marshallOptions: { removeUndefinedValues: true } }),
        tableName: process.env.TABLE_NAME,
      }),
      loadGameData,
      adminPasscodeHash: process.env.ADMIN_PASSCODE_HASH ?? '', // only the admin function is given it (terraform/lambda.tf)
    });
    return toLambdaResponse(await app.handle(fromLambdaEvent(event)));
  };
}

module.exports = { createHandler, createEventsFromEnvironment };
