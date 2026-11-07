// Runs the store contract against DynamoDB Local. In CI it must run (REQUIRE_DYNAMODB=1); on a laptop it is
// skipped unless you start DynamoDB Local yourself:
//   docker run --rm -p 8000:8000 amazon/dynamodb-local
//   DYNAMODB_ENDPOINT=http://localhost:8000 npm run test:api
const test = require('node:test');
const assert = require('node:assert/strict');
const { DynamoDBClient, CreateTableCommand } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient } = require('@aws-sdk/lib-dynamodb');
const { runStoreContract } = require('./contract.js');
const { createDynamoStore, TABLE_DEFINITION } = require('../../api/store/dynamo.js');

const endpoint = process.env.DYNAMODB_ENDPOINT;

if (!endpoint && process.env.REQUIRE_DYNAMODB) {
  test('DynamoDB Local is configured', () => assert.fail('DYNAMODB_ENDPOINT is not set, but REQUIRE_DYNAMODB is: the DynamoDB tests must not be skipped here'));
} else {
  const client = DynamoDBDocumentClient.from(new DynamoDBClient({
    endpoint, region: 'ap-southeast-2', credentials: { accessKeyId: 'test', secretAccessKey: 'test' },
  }), { marshallOptions: { removeUndefinedValues: true } });
  let tables = 0;

  // A fresh table per test, so tests cannot affect each other.
  runStoreContract('DynamoDB store', async () => {
    const tableName = `hunt-test-${process.pid}-${Date.now()}-${tables++}`;
    await client.send(new CreateTableCommand({ TableName: tableName, ...TABLE_DEFINITION }));
    return createDynamoStore({ client, tableName });
  }, { skip: endpoint ? false : 'set DYNAMODB_ENDPOINT to run against DynamoDB Local' });
}
