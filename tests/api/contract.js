// The behaviour every store must have. Run against the in-memory store (always) and against DynamoDB Local
// (in CI, or locally with DYNAMODB_ENDPOINT set), so the fake can never drift from the real thing.
// Uses made-up teams and a made-up game, never the real game file.
const test = require('node:test');
const assert = require('node:assert/strict');
const { photoPoints } = require('../../api/lib/scoring.js');

const game = {
  config: { name: 'Test game', timeZone: 'Australia/Perth', day: '2026-11-14', start: '10:00', end: '12:00' },
  game: { 'zone 1': { 'zone-name': 'One', questions: [{ Q1: 'q', type: 'string', answer: 'a', score: 10 }, { Q2: 'photo', type: 'photo', score: 30 }] } },
};
const join = (players, n, name = `Team ${n}`) => players.createTeam({ playerId: `p${n}`, name, key: name.toLowerCase() });
const answer = (correct, points) => ({ answerGiven: 'x', correct, points });

function runStoreContract(label, makeStore, options = {}) {
  // Each test gets the store and `p`, the player data of one event (the tests of several events use `store.forEvent` themselves).
  const t = (name, fn) => test(`${label}: ${name}`, options, async () => { const store = await makeStore(); return fn(store, store.forEvent('summer')); });

  t('starts empty', async (store, p) => {
    assert.equal(await store.getGame(), null);
    assert.deepEqual(await p.listTeams(), []);
    assert.equal(await p.getTeam('nobody'), null);
  });

  t('saves and returns the configured game', async (store, p) => {
    await store.saveGame({ ...game, configuredAt: 5 });
    const saved = await store.getGame();
    assert.deepEqual(saved.config, game.config);
    assert.deepEqual(saved.game, game.game);
    assert.equal(saved.configuredAt, 5);
  });

  t('keeps which event the game was loaded from (its instructions and map addresses), or none', async (store, p) => {
    await store.saveGame({ ...game, configuredAt: 5 });
    assert.equal((await store.getGame()).event, null);
    const event = { name: 'summer', instructions: '# Hi', maps: { 'zone 1': { thumb: '/event-maps/a/zone-1-thumb.webp', full: '/event-maps/a/zone-1.webp' } } };
    await store.saveGame({ ...game, event, configuredAt: 6 });
    assert.deepEqual((await store.getGame()).event, event);
  });

  t('team numbers count up from 1, and a duplicate name (any case) is refused without using a number', async (store, p) => {
    const a = await join(p, 1, 'Sea Dogs');
    assert.equal(a.ok, true);
    assert.equal(a.team.number, 1);
    assert.deepEqual([a.team.score, a.team.subs, a.team.photos], [0, {}, {}]);
    const dup = await p.createTeam({ playerId: 'p9', name: 'SEA DOGS', key: 'sea dogs' });
    assert.deepEqual(dup, { ok: false, error: 'name-taken' });
    assert.equal(await p.getTeam('p9'), null);
    assert.equal((await join(p, 2)).team.number, 2);
  });

  t('many teams joining at once get different numbers', async (store, p) => {
    const results = await Promise.all(Array.from({ length: 8 }, (_, i) => join(p, i + 1)));
    assert.ok(results.every((r) => r.ok));
    assert.deepEqual(results.map((r) => r.team.number).sort((x, y) => x - y), [1, 2, 3, 4, 5, 6, 7, 8]);
  });

  t('the same name joining at once is given to exactly one team', async (store, p) => {
    const results = await Promise.all(Array.from({ length: 5 }, (_, i) => join(p, i + 1, 'Same Name')));
    assert.equal(results.filter((r) => r.ok).length, 1);
    assert.equal((await p.listTeams()).length, 1);
  });

  t('an answer counts once: the second submission, right or wrong, is refused and changes nothing', async (store, p) => {
    await join(p, 1);
    assert.deepEqual(await p.recordAnswer('p1', 'zone 1', 'Q1', answer(true, 10)), { ok: true, score: 10 });
    assert.deepEqual(await p.recordAnswer('p1', 'zone 1', 'Q1', answer(true, 10)), { ok: false, error: 'already-submitted' });
    assert.deepEqual(await p.recordAnswer('p1', 'zone 1', 'Q2', answer(false, 0)), { ok: true, score: 10 }); // a wrong answer still uses the slot
    assert.deepEqual(await p.recordAnswer('p1', 'zone 1', 'Q2', answer(true, 10)), { ok: false, error: 'already-submitted' });
    assert.equal((await p.getTeam('p1')).score, 10);
  });

  t('the same answer sent at once is counted once', async (store, p) => {
    await join(p, 1);
    const results = await Promise.all(Array.from({ length: 5 }, () => p.recordAnswer('p1', 'zone 1', 'Q1', answer(true, 10))));
    assert.equal(results.filter((r) => r.ok).length, 1);
    assert.equal((await p.getTeam('p1')).score, 10);
  });

  t('answers and photos for an unknown team are refused', async (store, p) => {
    assert.deepEqual(await p.recordAnswer('nobody', 'zone 1', 'Q1', answer(true, 10)), { ok: false, error: 'no-team' });
    assert.deepEqual(await p.recordPhotoSent('nobody', 'zone 1#Q2'), { ok: false, error: 'no-team' });
    assert.deepEqual(await p.applyPhotoDecision('nobody', 'zone 1#Q2', { decision: 'full', photoScore: 30 }), { ok: false, error: 'no-team' });
  });

  t('a photo challenge can be sent once and scored only after it was sent', async (store, p) => {
    await join(p, 1);
    assert.deepEqual(await p.applyPhotoDecision('p1', 'zone 1#Q2', { decision: 'full', photoScore: 30 }), { ok: false, error: 'no-photo' });
    assert.deepEqual(await p.recordPhotoSent('p1', 'zone 1#Q2', { at: 7 }), { ok: true });
    assert.deepEqual(await p.recordPhotoSent('p1', 'zone 1#Q2'), { ok: false, error: 'already-submitted' });
    assert.equal((await p.recordPhotoSent('p1', 'zone 2#Q2')).ok, true);
    assert.equal((await p.getTeam('p1')).photos['zone 1#Q2'].sentAt, 7);
  });

  t('photo decisions replace each other and never double count', async (store, p) => {
    await join(p, 1);
    await p.recordAnswer('p1', 'zone 1', 'Q1', answer(true, 10));
    await p.recordPhotoSent('p1', 'zone 1#Q2');
    const apply = async (decision) => (await p.applyPhotoDecision('p1', 'zone 1#Q2', { decision, photoScore: 25 }));
    assert.deepEqual(await apply('full'), { ok: true, delta: 25, score: 35 });
    assert.deepEqual(await apply('full'), { ok: true, delta: 0, score: 35 }); // applied twice: no change
    assert.deepEqual(await apply('half'), { ok: true, delta: -12.5, score: 22.5 });
    assert.deepEqual(await apply('zero'), { ok: true, delta: -12.5, score: 10 });
    const photo = (await p.getTeam('p1')).photos['zone 1#Q2'];
    assert.equal(photo.decision, 'zero');
    assert.equal(photo.points, 0);
  });

  t('decisions applied at once leave the score matching the stored decision', async (store, p) => {
    await join(p, 1);
    await p.recordAnswer('p1', 'zone 1', 'Q1', answer(true, 10));
    await p.recordPhotoSent('p1', 'zone 1#Q2');
    const results = await Promise.all(['full', 'half', 'zero', 'full'].map((decision) =>
      p.applyPhotoDecision('p1', 'zone 1#Q2', { decision, photoScore: 30 })));
    assert.ok(results.every((r) => r.ok));
    const team = await p.getTeam('p1');
    assert.equal(team.score, 10 + photoPoints(30, team.photos['zone 1#Q2'].decision));
  });

  t('lists every team with its score', async (store, p) => {
    await join(p, 1);
    await join(p, 2);
    await p.recordAnswer('p2', 'zone 1', 'Q1', answer(true, 10));
    const teams = await p.listTeams();
    assert.deepEqual(teams.map((x) => [x.number, x.score]).sort(), [[1, 0], [2, 10]]);
  });

  t('removing a team frees its name and leaves the others alone', async (store, p) => {
    await join(p, 1, 'Alpha');
    await join(p, 2, 'Bravo');
    assert.equal(await p.removeTeam('p1'), true);
    assert.equal(await p.removeTeam('p1'), false);
    assert.equal(await p.getTeam('p1'), null);
    assert.equal((await p.getTeam('p2')).name, 'Bravo');
    assert.equal((await join(p, 3, 'Alpha')).ok, true);
  });

  t('deleting all player data removes every team, name and the numbering, but keeps the game', async (store, p) => {
    await store.saveGame(game);
    for (let i = 1; i <= 30; i++) await join(p, i); // more than one batch of deletes
    await p.recordAnswer('p1', 'zone 1', 'Q1', answer(true, 10));
    await p.deleteAllPlayerData();
    assert.deepEqual(await p.listTeams(), []);
    const again = await join(p, 1);
    assert.equal(again.ok, true);
    assert.equal(again.team.number, 1);
    assert.equal(again.team.score, 0);
    assert.deepEqual((await store.getGame()).config, game.config);
  });

  t('the final results start unpublished; publishing records the time once and unpublishing clears it', async (store, p) => {
    assert.equal(await p.getPublishedAt(), null);
    assert.equal(await p.publishResults(100), 100);
    assert.equal(await p.getPublishedAt(), 100);
    assert.equal(await p.publishResults(200), 100); // publishing again changes nothing
    assert.equal(await p.getPublishedAt(), 100);
    await p.unpublishResults();
    assert.equal(await p.getPublishedAt(), null);
    await p.unpublishResults(); // and undoing twice is fine
    assert.equal(await p.publishResults(300), 300);
  });

  t('publishing at once records a single time', async (store, p) => {
    const times = await Promise.all([1, 2, 3, 4, 5].map((n) => p.publishResults(n * 100)));
    assert.equal(new Set(times).size, 1);
    assert.equal(await p.getPublishedAt(), times[0]);
  });

  t('deleting all player data returns the results to provisional and keeps the game', async (store, p) => {
    await store.saveGame(game);
    await join(p, 1);
    await p.publishResults(100);
    await p.deleteAllPlayerData();
    assert.equal(await p.getPublishedAt(), null);
    assert.deepEqual((await store.getGame()).config, game.config);
  });

  t('failed admin logins are counted per window, a new window starts at zero, and a success clears the count', async (store, p) => {
    const WINDOW = 300_000;
    assert.equal(await store.getLoginFailures(1_000, WINDOW), 0);
    assert.equal(await store.registerLoginFailure(1_000, WINDOW), 1);
    assert.equal(await store.registerLoginFailure(200_000, WINDOW), 2); // the same window
    assert.equal(await store.getLoginFailures(299_999, WINDOW), 2);
    assert.equal(await store.getLoginFailures(300_000, WINDOW), 0); // the next window
    assert.equal(await store.registerLoginFailure(300_001, WINDOW), 1);
    await store.clearLoginFailures(299_999, WINDOW);
    assert.equal(await store.getLoginFailures(1_000, WINDOW), 0);
    assert.equal(await store.getLoginFailures(300_001, WINDOW), 1); // other windows are untouched
  });

  t('simultaneous failed logins are all counted', async (store, p) => {
    const counts = await Promise.all(Array.from({ length: 8 }, () => store.registerLoginFailure(5_000, 300_000)));
    assert.deepEqual([...counts].sort((x, y) => x - y), [1, 2, 3, 4, 5, 6, 7, 8]);
    assert.equal(await store.getLoginFailures(5_000, 300_000), 8);
  });

  t('each event keeps its own teams, numbering and names', async (store, a) => {
    const b = store.forEvent('winter');
    assert.equal((await join(a, 1, 'Sea Dogs')).team.number, 1);
    assert.equal((await join(a, 2)).team.number, 2);
    assert.equal((await join(b, 1, 'Sea Dogs')).team.number, 1); // the same name and the same player id, in another event
    assert.deepEqual((await a.listTeams()).map((x) => x.number).sort(), [1, 2]);
    assert.deepEqual((await b.listTeams()).map((x) => x.number), [1]);
    assert.equal((await b.getTeam('p2')), null); // a team is only found in its own event
    assert.deepEqual(await b.recordAnswer('p2', 'zone 1', 'Q1', answer(true, 10)), { ok: false, error: 'no-team' });
    assert.equal((await b.removeTeam('p2')), false);
    assert.equal((await a.getTeam('p2')).score, 0);
  });

  t('scores and photo decisions in one event never reach another', async (store, a) => {
    const b = store.forEvent('winter');
    await join(a, 1);
    await join(b, 1);
    await a.recordAnswer('p1', 'zone 1', 'Q1', answer(true, 10));
    await a.recordPhotoSent('p1', 'zone 1#Q2');
    await a.applyPhotoDecision('p1', 'zone 1#Q2', { decision: 'full', photoScore: 30 });
    assert.equal((await a.getTeam('p1')).score, 40);
    const other = await b.getTeam('p1');
    assert.deepEqual([other.score, other.subs, other.photos], [0, {}, {}]);
    assert.deepEqual(await b.recordAnswer('p1', 'zone 1', 'Q1', answer(true, 10)), { ok: true, score: 10 }); // its own slot is still free
  });

  t('publishing the results is per event', async (store, a) => {
    const b = store.forEvent('winter');
    assert.equal(await a.publishResults(100), 100);
    assert.equal(await b.getPublishedAt(), null);
    assert.equal(await b.publishResults(200), 200);
    await a.unpublishResults();
    assert.equal(await a.getPublishedAt(), null);
    assert.equal(await b.getPublishedAt(), 200);
  });

  t('deleting one event\'s player data leaves the other events and the game alone, and coming back finds the data', async (store, a) => {
    const b = store.forEvent('winter');
    await store.saveGame(game);
    for (let i = 1; i <= 30; i++) await join(a, i);
    await join(b, 1, 'Sharks');
    await b.recordAnswer('p1', 'zone 1', 'Q1', answer(true, 10));
    await b.publishResults(100);
    await a.publishResults(50);
    await a.deleteAllPlayerData();
    assert.deepEqual(await a.listTeams(), []);
    assert.equal(await a.getPublishedAt(), null);
    assert.equal((await join(a, 1)).team.number, 1); // a's numbering started again
    const again = store.forEvent('winter'); // asking for the event again (as the app does on every request) finds the same data
    assert.deepEqual((await again.listTeams()).map((x) => [x.number, x.name, x.score]), [[1, 'Sharks', 10]]);
    assert.equal(await again.getPublishedAt(), 100);
    assert.equal((await again.createTeam({ playerId: 'p2', name: 'Next', key: 'next' })).team.number, 2);
    assert.deepEqual((await store.getGame()).config, game.config);
  });

  t('a game loaded from no event has its own player data, and an invalid event name is refused', async (store, a) => {
    await join(a, 1);
    assert.deepEqual(await store.forEvent(null).listTeams(), []);
    assert.equal((await join(store.forEvent(null), 1)).team.number, 1);
    for (const bad of ['', 'Has Capitals', 'a#b', 'x/y', '-x', 'a'.repeat(41), 5]) assert.throws(() => store.forEvent(bad), /event/, String(bad));
  });

  t('what the store returns is a copy: changing it does not change the store', async (store, p) => {
    await join(p, 1);
    const team = await p.getTeam('p1');
    team.score = 999;
    team.subs.hack = true;
    assert.equal((await p.getTeam('p1')).score, 0);
    assert.deepEqual((await p.getTeam('p1')).subs, {});
  });
}

module.exports = { runStoreContract };
