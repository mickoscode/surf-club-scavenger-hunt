'use strict';
// DynamoDB store. One table, on-demand, string keys `pk` and `sk`:
//
//   pk      sk              item
//   META    GAME            { config, game, configuredAt }   the configured game and its zones/questions copy
//   META    COUNTER         { last }                         last team number handed out
//   META    RESULTS         { publishedAt }                  exists only while the final results are published
//   META    LOGINFAIL#<n>   { failures }                     failed admin logins in the n-th fixed window (a handful of tiny items)
//   NAME    <name key>      { playerId }                     reserves a team name (the key ignores case)
//   TEAM    <playerId>      { number, name, key, score, joinedAt,
//                             subs:   { "<zone>#<Qn>": { answerGiven, correct, points, at } },
//                             photos: { "<zone>#<photo id>": { sentAt, decision?, points?, appliedAt? } } }
//
// A team's whole state is ONE item, so "submit once" and "add to the score" are a single atomic conditional
// update (no transactions needed there). Joining uses a transaction so a name is never reserved without a team.
// A team item is a few KB (limit 400 KB) and there are under 50 teams, so listing them is one small query.
// Behaviour is specified by tests/api/contract.js; this file must pass the same tests as memory.js.
const {
  GetCommand, PutCommand, UpdateCommand, DeleteCommand, QueryCommand, TransactWriteCommand, BatchWriteCommand,
} = require('@aws-sdk/lib-dynamodb');
const { decisionDelta, photoPoints, roundScore } = require('../lib/scoring');

const MAX_ATTEMPTS = 6;
const MAX_DECISION_ATTEMPTS = 10;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const isConditionFailure = (e) => e?.name === 'ConditionalCheckFailedException';
const strip = ({ pk, sk, ...rest }) => rest;
const PK = { '#pk': 'pk' }; // attribute names are always aliased in expressions: DynamoDB has a long reserved-word list

function createDynamoStore({ client, tableName }) {
  const T = tableName;
  const send = (command) => client.send(command);

  async function getTeamItem(playerId) {
    const { Item } = await send(new GetCommand({ TableName: T, Key: { pk: 'TEAM', sk: playerId }, ConsistentRead: true }));
    return Item ?? null;
  }
  async function queryAll(pk) {
    const items = [];
    let ExclusiveStartKey;
    do {
      const page = await send(new QueryCommand({
        TableName: T, KeyConditionExpression: 'pk = :pk', ExpressionAttributeValues: { ':pk': pk },
        ConsistentRead: true, ExclusiveStartKey,
      }));
      items.push(...page.Items);
      ExclusiveStartKey = page.LastEvaluatedKey;
    } while (ExclusiveStartKey);
    return items;
  }

  return {
    async getGame() {
      const { Item } = await send(new GetCommand({ TableName: T, Key: { pk: 'META', sk: 'GAME' }, ConsistentRead: true }));
      return Item ? strip(Item) : null;
    },
    async saveGame({ config, game, event = null, configuredAt = Date.now() }) {
      // event: the event the game was loaded from ({ name, instructions, maps }), or null for a game loaded from the repository's file.
      await send(new PutCommand({ TableName: T, Item: { pk: 'META', sk: 'GAME', config, game, event, configuredAt } }));
    },

    async createTeam({ playerId, name, key, joinedAt = Date.now() }) {
      // Check first so an ordinary duplicate name does not use up a team number.
      const lock = await send(new GetCommand({ TableName: T, Key: { pk: 'NAME', sk: key }, ConsistentRead: true }));
      if (lock.Item) return { ok: false, error: 'name-taken' };

      const counter = await send(new UpdateCommand({
        TableName: T, Key: { pk: 'META', sk: 'COUNTER' }, UpdateExpression: 'ADD #last :one',
        ExpressionAttributeNames: { '#last': 'last' }, ExpressionAttributeValues: { ':one': 1 }, ReturnValues: 'UPDATED_NEW',
      }));
      const team = { playerId, number: counter.Attributes.last, name, key, score: 0, joinedAt, subs: {}, photos: {} };

      for (let attempt = 1; ; attempt++) {
        try {
          await send(new TransactWriteCommand({ TransactItems: [
            { Put: { TableName: T, Item: { pk: 'NAME', sk: key, playerId }, ConditionExpression: 'attribute_not_exists(#pk)', ExpressionAttributeNames: PK } },
            { Put: { TableName: T, Item: { pk: 'TEAM', sk: playerId, ...strip(team) }, ConditionExpression: 'attribute_not_exists(#pk)', ExpressionAttributeNames: PK } },
          ] }));
          return { ok: true, team };
        } catch (e) {
          if (e?.name !== 'TransactionCanceledException') throw e;
          const codes = (e.CancellationReasons ?? []).map((r) => r.Code);
          if (codes.includes('ConditionalCheckFailed')) return { ok: false, error: 'name-taken' };
          if (attempt >= MAX_ATTEMPTS) throw e; // still conflicting with another join: let the caller see it
          await sleep(20 * attempt);
        }
      }
    },
    async getTeam(playerId) {
      const item = await getTeamItem(playerId);
      return item ? { playerId, ...strip(item) } : null;
    },
    async listTeams() {
      return (await queryAll('TEAM')).map((item) => ({ playerId: item.sk, ...strip(item) }));
    },
    async removeTeam(playerId) {
      const item = await getTeamItem(playerId);
      if (!item) return false;
      try {
        await send(new TransactWriteCommand({ TransactItems: [
          { Delete: { TableName: T, Key: { pk: 'TEAM', sk: playerId }, ConditionExpression: 'attribute_exists(#pk)', ExpressionAttributeNames: PK } },
          { Delete: { TableName: T, Key: { pk: 'NAME', sk: item.key } } },
        ] }));
        return true;
      } catch (e) {
        if (e?.name === 'TransactionCanceledException') return false; // removed by someone else meanwhile
        throw e;
      }
    },

    async recordAnswer(playerId, zoneKey, questionId, { answerGiven, correct, points, at = Date.now() }) {
      try {
        const r = await send(new UpdateCommand({
          TableName: T, Key: { pk: 'TEAM', sk: playerId },
          UpdateExpression: 'SET #subs.#k = :v ADD #score :p',
          ConditionExpression: 'attribute_exists(#pk) AND attribute_not_exists(#subs.#k)',
          ExpressionAttributeNames: { ...PK, '#subs': 'subs', '#score': 'score', '#k': `${zoneKey}#${questionId}` },
          ExpressionAttributeValues: { ':v': { answerGiven, correct, points, at }, ':p': points },
          ReturnValues: 'UPDATED_NEW',
        }));
        return { ok: true, score: roundScore(r.Attributes.score) };
      } catch (e) {
        if (!isConditionFailure(e)) throw e;
        return { ok: false, error: (await getTeamItem(playerId)) ? 'already-submitted' : 'no-team' };
      }
    },
    async recordPhotoSent(playerId, zoneKey, { at = Date.now() } = {}) {
      try {
        await send(new UpdateCommand({
          TableName: T, Key: { pk: 'TEAM', sk: playerId },
          UpdateExpression: 'SET #photos.#z = :v',
          ConditionExpression: 'attribute_exists(#pk) AND attribute_not_exists(#photos.#z)',
          ExpressionAttributeNames: { ...PK, '#photos': 'photos', '#z': zoneKey }, ExpressionAttributeValues: { ':v': { sentAt: at } },
        }));
        return { ok: true };
      } catch (e) {
        if (!isConditionFailure(e)) throw e;
        return { ok: false, error: (await getTeamItem(playerId)) ? 'already-submitted' : 'no-team' };
      }
    },
    // Optimistic concurrency: compute the delta from the decision we read, and apply it only if that decision is
    // still the stored one; otherwise read again. Two admins applying at once can never double count.
    async applyPhotoDecision(playerId, zoneKey, { decision, photoScore, at = Date.now() }) {
      for (let attempt = 1; attempt <= MAX_DECISION_ATTEMPTS; attempt++) {
        const item = await getTeamItem(playerId);
        if (!item) return { ok: false, error: 'no-team' };
        const photo = item.photos?.[zoneKey];
        if (!photo) return { ok: false, error: 'no-photo' };
        const previous = photo.decision ?? null;
        const delta = decisionDelta(photoScore, previous, decision);
        try {
          const r = await send(new UpdateCommand({
            TableName: T, Key: { pk: 'TEAM', sk: playerId },
            UpdateExpression: 'SET #photos.#z.#decision = :d, #photos.#z.#points = :pts, #photos.#z.#appliedAt = :at ADD #score :delta',
            ConditionExpression: previous === null
              ? 'attribute_exists(#photos.#z) AND attribute_not_exists(#photos.#z.#decision)'
              : '#photos.#z.#decision = :prev',
            ExpressionAttributeNames: {
              '#photos': 'photos', '#z': zoneKey, '#decision': 'decision', '#points': 'points', '#appliedAt': 'appliedAt', '#score': 'score',
            },
            ExpressionAttributeValues: {
              ':d': decision, ':pts': photoPoints(photoScore, decision), ':at': at, ':delta': delta,
              ...(previous === null ? {} : { ':prev': previous }),
            },
            ReturnValues: 'UPDATED_NEW',
          }));
          return { ok: true, delta, score: roundScore(r.Attributes.score) };
        } catch (e) {
          if (!isConditionFailure(e)) throw e;
          await sleep(10 * attempt);
        }
      }
      throw new Error('could not apply the decision: too many concurrent changes');
    },

    async getPublishedAt() {
      const { Item } = await send(new GetCommand({ TableName: T, Key: { pk: 'META', sk: 'RESULTS' }, ConsistentRead: true }));
      return Item ? Item.publishedAt : null;
    },
    // The first publish wins: publishing again (or at the same time) returns the time it was first published.
    async publishResults(at = Date.now()) {
      try {
        await send(new PutCommand({
          TableName: T, Item: { pk: 'META', sk: 'RESULTS', publishedAt: at },
          ConditionExpression: 'attribute_not_exists(#pk)', ExpressionAttributeNames: PK,
        }));
        return at;
      } catch (e) {
        if (!isConditionFailure(e)) throw e;
        return this.getPublishedAt();
      }
    },
    async unpublishResults() {
      await send(new DeleteCommand({ TableName: T, Key: { pk: 'META', sk: 'RESULTS' } }));
    },

    // Failed admin logins, counted in fixed windows with an atomic counter (so simultaneous guesses are all counted).
    async getLoginFailures(now, windowMs) {
      const { Item } = await send(new GetCommand({ TableName: T, Key: { pk: 'META', sk: `LOGINFAIL#${Math.floor(now / windowMs)}` }, ConsistentRead: true }));
      return Item?.failures ?? 0;
    },
    async registerLoginFailure(now, windowMs) {
      const r = await send(new UpdateCommand({
        TableName: T, Key: { pk: 'META', sk: `LOGINFAIL#${Math.floor(now / windowMs)}` }, UpdateExpression: 'ADD #failures :one',
        ExpressionAttributeNames: { '#failures': 'failures' }, ExpressionAttributeValues: { ':one': 1 }, ReturnValues: 'UPDATED_NEW',
      }));
      return r.Attributes.failures;
    },
    async clearLoginFailures(now, windowMs) {
      await send(new DeleteCommand({ TableName: T, Key: { pk: 'META', sk: `LOGINFAIL#${Math.floor(now / windowMs)}` } }));
    },

    async exportAll() {
      return { game: await this.getGame(), teams: await this.listTeams() };
    },
    async deleteAllPlayerData() {
      const keys = [
        ...(await queryAll('TEAM')).map((i) => ({ pk: i.pk, sk: i.sk })),
        ...(await queryAll('NAME')).map((i) => ({ pk: i.pk, sk: i.sk })),
        { pk: 'META', sk: 'COUNTER' },
        { pk: 'META', sk: 'RESULTS' }, // back to provisional
      ];
      for (let i = 0; i < keys.length; i += 25) {
        let requests = keys.slice(i, i + 25).map((Key) => ({ DeleteRequest: { Key } }));
        for (let attempt = 1; requests.length > 0; attempt++) {
          if (attempt > MAX_ATTEMPTS) throw new Error('could not delete all player data');
          const r = await send(new BatchWriteCommand({ RequestItems: { [T]: requests } }));
          requests = r.UnprocessedItems?.[T] ?? [];
          if (requests.length > 0) await sleep(50 * attempt);
        }
      }
    },
  };
}

// The table definition (terraform/dynamodb.tf must match it).
const TABLE_DEFINITION = {
  AttributeDefinitions: [{ AttributeName: 'pk', AttributeType: 'S' }, { AttributeName: 'sk', AttributeType: 'S' }],
  KeySchema: [{ AttributeName: 'pk', KeyType: 'HASH' }, { AttributeName: 'sk', KeyType: 'RANGE' }],
  BillingMode: 'PAY_PER_REQUEST',
};

module.exports = { createDynamoStore, TABLE_DEFINITION };
