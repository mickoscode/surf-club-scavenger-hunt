// The behaviour every store must have. Run against the in-memory store (always) and against DynamoDB Local
// (in CI, or locally with DYNAMODB_ENDPOINT set), so the fake can never drift from the real thing.
// Uses made-up teams and a made-up game, never the real game file.
const test = require('node:test');
const assert = require('node:assert/strict');
const { photoPoints } = require('../../api/lib/scoring.js');

const game = {
  config: { name: 'Test game', timeZone: 'Australia/Perth', day: '2026-11-14', start: '10:00', end: '12:00' },
  game: { 'zone 1': { 'zone-name': 'One', 'photo-score': 30, questions: [{ Q1: 'q', type: 'string', answer: 'a', score: 10 }] } },
};
const join = (store, n, name = `Team ${n}`) => store.createTeam({ playerId: `p${n}`, name, key: name.toLowerCase() });
const answer = (correct, points) => ({ answerGiven: 'x', correct, points });

function runStoreContract(label, makeStore, options = {}) {
  const t = (name, fn) => test(`${label}: ${name}`, options, async () => fn(await makeStore()));

  t('starts empty', async (store) => {
    assert.equal(await store.getGame(), null);
    assert.deepEqual(await store.listTeams(), []);
    assert.equal(await store.getTeam('nobody'), null);
  });

  t('saves and returns the configured game', async (store) => {
    await store.saveGame({ ...game, configuredAt: 5 });
    const saved = await store.getGame();
    assert.deepEqual(saved.config, game.config);
    assert.deepEqual(saved.game, game.game);
    assert.equal(saved.configuredAt, 5);
  });

  t('team numbers count up from 1, and a duplicate name (any case) is refused without using a number', async (store) => {
    const a = await join(store, 1, 'Sea Dogs');
    assert.equal(a.ok, true);
    assert.equal(a.team.number, 1);
    assert.deepEqual([a.team.score, a.team.subs, a.team.photos], [0, {}, {}]);
    const dup = await store.createTeam({ playerId: 'p9', name: 'SEA DOGS', key: 'sea dogs' });
    assert.deepEqual(dup, { ok: false, error: 'name-taken' });
    assert.equal(await store.getTeam('p9'), null);
    assert.equal((await join(store, 2)).team.number, 2);
  });

  t('many teams joining at once get different numbers', async (store) => {
    const results = await Promise.all(Array.from({ length: 8 }, (_, i) => join(store, i + 1)));
    assert.ok(results.every((r) => r.ok));
    assert.deepEqual(results.map((r) => r.team.number).sort((x, y) => x - y), [1, 2, 3, 4, 5, 6, 7, 8]);
  });

  t('the same name joining at once is given to exactly one team', async (store) => {
    const results = await Promise.all(Array.from({ length: 5 }, (_, i) => join(store, i + 1, 'Same Name')));
    assert.equal(results.filter((r) => r.ok).length, 1);
    assert.equal((await store.listTeams()).length, 1);
  });

  t('an answer counts once: the second submission, right or wrong, is refused and changes nothing', async (store) => {
    await join(store, 1);
    assert.deepEqual(await store.recordAnswer('p1', 'zone 1', 'Q1', answer(true, 10)), { ok: true, score: 10 });
    assert.deepEqual(await store.recordAnswer('p1', 'zone 1', 'Q1', answer(true, 10)), { ok: false, error: 'already-submitted' });
    assert.deepEqual(await store.recordAnswer('p1', 'zone 1', 'Q2', answer(false, 0)), { ok: true, score: 10 }); // a wrong answer still uses the slot
    assert.deepEqual(await store.recordAnswer('p1', 'zone 1', 'Q2', answer(true, 10)), { ok: false, error: 'already-submitted' });
    assert.equal((await store.getTeam('p1')).score, 10);
  });

  t('the same answer sent at once is counted once', async (store) => {
    await join(store, 1);
    const results = await Promise.all(Array.from({ length: 5 }, () => store.recordAnswer('p1', 'zone 1', 'Q1', answer(true, 10))));
    assert.equal(results.filter((r) => r.ok).length, 1);
    assert.equal((await store.getTeam('p1')).score, 10);
  });

  t('answers and photos for an unknown team are refused', async (store) => {
    assert.deepEqual(await store.recordAnswer('nobody', 'zone 1', 'Q1', answer(true, 10)), { ok: false, error: 'no-team' });
    assert.deepEqual(await store.recordPhotoSent('nobody', 'zone 1'), { ok: false, error: 'no-team' });
    assert.deepEqual(await store.applyPhotoDecision('nobody', 'zone 1', { decision: 'full', photoScore: 30 }), { ok: false, error: 'no-team' });
  });

  t('a photo can be sent once per zone and scored only after it was sent', async (store) => {
    await join(store, 1);
    assert.deepEqual(await store.applyPhotoDecision('p1', 'zone 1', { decision: 'full', photoScore: 30 }), { ok: false, error: 'no-photo' });
    assert.deepEqual(await store.recordPhotoSent('p1', 'zone 1', { at: 7 }), { ok: true });
    assert.deepEqual(await store.recordPhotoSent('p1', 'zone 1'), { ok: false, error: 'already-submitted' });
    assert.equal((await store.recordPhotoSent('p1', 'zone 2')).ok, true);
    assert.equal((await store.getTeam('p1')).photos['zone 1'].sentAt, 7);
  });

  t('photo decisions replace each other and never double count', async (store) => {
    await join(store, 1);
    await store.recordAnswer('p1', 'zone 1', 'Q1', answer(true, 10));
    await store.recordPhotoSent('p1', 'zone 1');
    const apply = async (decision) => (await store.applyPhotoDecision('p1', 'zone 1', { decision, photoScore: 25 }));
    assert.deepEqual(await apply('full'), { ok: true, delta: 25, score: 35 });
    assert.deepEqual(await apply('full'), { ok: true, delta: 0, score: 35 }); // applied twice: no change
    assert.deepEqual(await apply('half'), { ok: true, delta: -12.5, score: 22.5 });
    assert.deepEqual(await apply('zero'), { ok: true, delta: -12.5, score: 10 });
    const photo = (await store.getTeam('p1')).photos['zone 1'];
    assert.equal(photo.decision, 'zero');
    assert.equal(photo.points, 0);
  });

  t('decisions applied at once leave the score matching the stored decision', async (store) => {
    await join(store, 1);
    await store.recordAnswer('p1', 'zone 1', 'Q1', answer(true, 10));
    await store.recordPhotoSent('p1', 'zone 1');
    const results = await Promise.all(['full', 'half', 'zero', 'full'].map((decision) =>
      store.applyPhotoDecision('p1', 'zone 1', { decision, photoScore: 30 })));
    assert.ok(results.every((r) => r.ok));
    const team = await store.getTeam('p1');
    assert.equal(team.score, 10 + photoPoints(30, team.photos['zone 1'].decision));
  });

  t('lists every team with its score', async (store) => {
    await join(store, 1);
    await join(store, 2);
    await store.recordAnswer('p2', 'zone 1', 'Q1', answer(true, 10));
    const teams = await store.listTeams();
    assert.deepEqual(teams.map((x) => [x.number, x.score]).sort(), [[1, 0], [2, 10]]);
  });

  t('removing a team frees its name and leaves the others alone', async (store) => {
    await join(store, 1, 'Alpha');
    await join(store, 2, 'Bravo');
    assert.equal(await store.removeTeam('p1'), true);
    assert.equal(await store.removeTeam('p1'), false);
    assert.equal(await store.getTeam('p1'), null);
    assert.equal((await store.getTeam('p2')).name, 'Bravo');
    assert.equal((await join(store, 3, 'Alpha')).ok, true);
  });

  t('deleting all player data removes every team, name and the numbering, but keeps the game', async (store) => {
    await store.saveGame(game);
    for (let i = 1; i <= 30; i++) await join(store, i); // more than one batch of deletes
    await store.recordAnswer('p1', 'zone 1', 'Q1', answer(true, 10));
    await store.deleteAllPlayerData();
    assert.deepEqual(await store.listTeams(), []);
    const again = await join(store, 1);
    assert.equal(again.ok, true);
    assert.equal(again.team.number, 1);
    assert.equal(again.team.score, 0);
    assert.deepEqual((await store.getGame()).config, game.config);
  });

  t('export contains the game and every team', async (store) => {
    await store.saveGame(game);
    await join(store, 1);
    await join(store, 2);
    const all = await store.exportAll();
    assert.deepEqual(all.game.config, game.config);
    assert.equal(all.teams.length, 2);
  });

  t('the final results start unpublished; publishing records the time once and unpublishing clears it', async (store) => {
    assert.equal(await store.getPublishedAt(), null);
    assert.equal(await store.publishResults(100), 100);
    assert.equal(await store.getPublishedAt(), 100);
    assert.equal(await store.publishResults(200), 100); // publishing again changes nothing
    assert.equal(await store.getPublishedAt(), 100);
    await store.unpublishResults();
    assert.equal(await store.getPublishedAt(), null);
    await store.unpublishResults(); // and undoing twice is fine
    assert.equal(await store.publishResults(300), 300);
  });

  t('publishing at once records a single time', async (store) => {
    const times = await Promise.all([1, 2, 3, 4, 5].map((n) => store.publishResults(n * 100)));
    assert.equal(new Set(times).size, 1);
    assert.equal(await store.getPublishedAt(), times[0]);
  });

  t('deleting all player data returns the results to provisional and keeps the game', async (store) => {
    await store.saveGame(game);
    await join(store, 1);
    await store.publishResults(100);
    await store.deleteAllPlayerData();
    assert.equal(await store.getPublishedAt(), null);
    assert.deepEqual((await store.getGame()).config, game.config);
  });

  t('what the store returns is a copy: changing it does not change the store', async (store) => {
    await join(store, 1);
    const team = await store.getTeam('p1');
    team.score = 999;
    team.subs.hack = true;
    assert.equal((await store.getTeam('p1')).score, 0);
    assert.deepEqual((await store.getTeam('p1')).subs, {});
  });
}

module.exports = { runStoreContract };
