// Publishing the final results and a team's results, through the app with the in-memory store and a controllable clock.
// Status codes and error codes only, never wording. Fixture game (tests/api/helpers.js): zone 1 "Alpha" has Q1 text 10
// (secret one / alt one), Q2 number 20 (42), Q3 decimal 5 (2.5), photo 30; zone 2 "Bravo" has Q1 text 10 (secret two), photo 25.
const test = require('node:test');
const assert = require('node:assert/strict');
const { setup, configure, answer, CONFIG, START, END } = require('./helpers.js');

const publish = (admin, body = { confirm: true }) => admin.post('/api/admin/results/publish', body);
const results = (p) => p.get('/api/results');
const apply = (admin, teamNumber, zone, decision) => admin.post('/api/admin/photos/apply', { teamNumber, zone, question: zone === 'zone 2' ? 'Q2' : 'Q4', decision });
const gameOf = async (env) => (await env.player().get('/api/scoreboard')).body.game;

// Three teams, then the game is over. Alpha (1) and Charlie (3) both finish on 60; Bravo (2) has a wrong answer and a photo
// that is never scored. Alpha also leaves Q3 and the whole of zone 2 alone.
async function finishedGame() {
  const env = setup();
  await configure(env);
  const alpha = env.player(); const bravo = env.player(); const charlie = env.player();
  await alpha.post('/api/join', { name: 'Alpha' });
  await bravo.post('/api/join', { name: 'Bravo' });
  await charlie.post('/api/join', { name: 'Charlie' });
  await answer(alpha, 'zone 1', 'Q1', 'alt one');
  await answer(alpha, 'zone 1', 'Q2', '42');
  await alpha.post('/api/photo', { zone: 'zone 1', question: 'Q4' });
  await answer(bravo, 'zone 1', 'Q1', 'purple');
  await bravo.post('/api/photo', { zone: 'zone 1', question: 'Q4' });
  await answer(charlie, 'zone 1', 'Q1', 'secret one');
  await answer(charlie, 'zone 1', 'Q2', '42');
  await charlie.post('/api/photo', { zone: 'zone 1', question: 'Q4' });
  env.clock.now = END + 1;
  const admin = env.admin();
  assert.equal((await apply(admin, 1, 'zone 1', 'full')).status, 200);
  assert.equal((await apply(admin, 3, 'zone 1', 'full')).status, 200);
  return { env, admin, alpha, bravo, charlie };
}

// ---------------------------------------------------------------------------------------- publishing rules

test('the final results can only be published once the game is over, and only with the confirmation', async () => {
  const env = setup({ now: START - 1000 });
  await configure(env);
  const admin = env.admin();
  for (const now of [START - 1000, START, END]) { // before, at the start, and at the exact end (still in progress)
    env.clock.now = now;
    const res = await publish(admin);
    assert.deepEqual([res.status, res.body.error], [409, 'game-not-over'], `now=${now}`);
  }
  assert.equal((await gameOf(env)).published, false);

  env.clock.now = END + 1;
  for (const confirm of [undefined, false, 'true', 1]) {
    const res = await publish(admin, { confirm });
    assert.deepEqual([res.status, res.body.error], [400, 'confirmation-required'], String(confirm));
  }
  const ok = await publish(admin);
  assert.deepEqual([ok.status, ok.body.published], [200, true]);
  assert.equal((await gameOf(env)).published, true);
});

test('nothing can be published before a game exists', async () => {
  const env = setup();
  assert.equal((await publish(env.admin())).body.error, 'game-not-over');
});

test('publishing twice changes nothing, and the published state shows on the scoreboard and the game summary', async () => {
  const { env, admin } = await finishedGame();
  const first = (await publish(admin)).body;
  const second = (await publish(admin)).body;
  assert.equal(first.publishedAt, second.publishedAt);
  assert.equal((await env.player().get('/api/scoreboard')).body.game.published, true);
  assert.equal((await env.player().get('/api/game')).body.game.published, true);
});

test('returning to provisional undoes it, and does so at any time', async () => {
  const { env, admin } = await finishedGame();
  await publish(admin);
  assert.deepEqual((await admin.post('/api/admin/results/unpublish', {})).body, { published: false });
  assert.equal((await gameOf(env)).published, false);
  assert.equal((await admin.post('/api/admin/results/unpublish', {})).status, 200); // already provisional: fine
});

test('the admin sees whether results are published and how many photos are still unscored', async () => {
  const { admin } = await finishedGame();
  let info = (await admin.get('/api/admin/config')).body;
  assert.deepEqual([info.results.published, info.results.publishedAt, info.unscoredPhotos], [false, null, 1]); // Bravo's photo
  await apply(admin, 2, 'zone 1', 'zero');
  await publish(admin);
  info = (await admin.get('/api/admin/config')).body;
  assert.deepEqual([info.results.published, info.unscoredPhotos], [true, 0]);
  assert.ok(info.results.publishedAt > 0);
});

// ---------------------------------------------------------------------------------------- scoring is locked

test('scores cannot be changed while the results are published, and can again after returning to provisional', async () => {
  const { env, admin } = await finishedGame();
  await publish(admin);
  const locked = await apply(admin, 2, 'zone 1', 'half');
  assert.deepEqual([locked.status, locked.body.error], [409, 'results-published']);
  assert.equal((await admin.get('/api/admin/photos')).status, 200); // still readable
  assert.equal((await env.player().get('/api/scoreboard')).body.teams.find((t) => t.number === 2).score, 0);

  await admin.post('/api/admin/results/unpublish', {});
  assert.equal((await apply(admin, 2, 'zone 1', 'half')).body.score, 15);
});

// ---------------------------------------------------------------------------------------- what a team receives

test('before publishing a team learns only that the results are not ready, and nothing about answers is sent', async () => {
  const { alpha, env } = await finishedGame();
  const anon = (await results(env.player())).body;
  assert.deepEqual(anon, { published: false, team: null });
  const mine = (await results(alpha)).body;
  assert.deepEqual(mine, { published: false, team: { number: 1, name: 'Alpha' } });
  const everything = JSON.stringify([anon, mine]);
  for (const forbidden of ['secret one', 'alt one', 'secret two', 'purple', 'yourAnswer', 'officialAnswers', '"answer"']) {
    assert.ok(!everything.includes(forbidden), `leaked before publishing: ${forbidden}`);
  }
});

test('nothing about answers is sent during the game either', async () => {
  const env = setup();
  await configure(env);
  const p = env.player();
  await p.post('/api/join', { name: 'Alpha' });
  await answer(p, 'zone 1', 'Q1', 'my private guess');
  const body = JSON.stringify((await results(p)).body);
  assert.ok(!body.includes('my private guess') && !body.includes('secret one'));
  assert.equal((await results(p)).body.published, false);
});

test('once published, a team gets its place, total and a breakdown of every question and photo with the official answers', async () => {
  const { alpha, bravo, admin } = await finishedGame();
  await publish(admin);

  const a = (await results(alpha)).body;
  assert.deepEqual([a.published, a.team], [true, { number: 1, name: 'Alpha' }]);
  assert.deepEqual([a.results.place, a.results.teamCount, a.results.total], [1, 3, 60]); // tied with Charlie: both 1st
  const [zone1, zone2] = a.results.zones;
  assert.deepEqual([zone1.key, zone1.name, zone2.key, zone2.name], ['zone 1', 'Alpha', 'zone 2', 'Bravo']);
  assert.deepEqual(zone1.questions[0], {
    id: 'Q1', text: 'first?', type: 'string', points: 10, answered: true, yourAnswer: 'alt one', correct: true, earned: 10, officialAnswers: ['secret one', 'alt one'],
  });
  assert.deepEqual([zone1.questions[2].answered, zone1.questions[2].yourAnswer, zone1.questions[2].correct, zone1.questions[2].earned], [false, null, null, 0]);
  assert.deepEqual(zone1.questions[2].officialAnswers, ['2.5']); // the official answer is shown even for a question not answered
  assert.deepEqual(zone1.photos, [{ id: 'Q4', challenge: 'photo one', points: 30, submitted: true, scored: true, decision: 'full', percent: 100, earned: 30 }]);
  assert.deepEqual(zone2.photos, [{ id: 'Q2', challenge: 'photo two', points: 25, submitted: false, scored: false, decision: null, percent: null, earned: 0 }]);

  const b = (await results(bravo)).body.results; // a wrong answer, and a photo that was sent but never scored
  assert.deepEqual([b.place, b.total], [3, 0]);
  assert.deepEqual([b.zones[0].questions[0].correct, b.zones[0].questions[0].earned, b.zones[0].questions[0].yourAnswer], [false, 0, 'purple']);
  assert.deepEqual([b.zones[0].photos[0].submitted, b.zones[0].photos[0].scored, b.zones[0].photos[0].percent], [true, false, 0]);
});

test('a team result always adds up to its score on the scoreboard', async () => {
  const { env, admin, alpha, bravo, charlie } = await finishedGame();
  await apply(admin, 2, 'zone 1', 'half'); // Bravo's photo, sent but not yet scored, is now worth half of 30
  await publish(admin);
  const board = (await env.player().get('/api/scoreboard')).body.teams;
  for (const [number, browser] of [[1, alpha], [2, bravo], [3, charlie]]) {
    const { results: mine } = (await results(browser)).body;
    const parts = mine.zones.flatMap((z) => [...z.questions.map((q) => q.earned), ...z.photos.map((p) => p.earned)]);
    const sum = parts.reduce((x, y) => x + y, 0);
    assert.equal(sum, mine.total, `team ${number}: the breakdown does not add up to the total`);
    assert.equal(mine.total, board.find((t) => t.number === number).score, `team ${number}: the total differs from the scoreboard`);
  }
  assert.equal((await results(bravo)).body.results.total, 15);
});

test('a browser with no team, or a removed team, gets no results even when they are published', async () => {
  const { env, admin, alpha } = await finishedGame();
  await publish(admin);
  assert.deepEqual((await results(env.player())).body, { published: true, team: null });
  assert.equal((await admin.del('/api/admin/teams/1')).status, 200); // removing a team is still allowed while published
  assert.deepEqual((await results(alpha)).body, { published: true, team: null });
});

test('removing a team while published changes the places of the others', async () => {
  const { admin, bravo } = await finishedGame();
  await publish(admin);
  assert.deepEqual([(await results(bravo)).body.results.place, (await results(bravo)).body.results.teamCount], [3, 3]);
  await admin.del('/api/admin/teams/1');
  assert.deepEqual([(await results(bravo)).body.results.place, (await results(bravo)).body.results.teamCount], [2, 2]);
});

// ---------------------------------------------------------------------------------------- resets

test('deleting the player data returns the results to provisional', async () => {
  const { env, admin } = await finishedGame();
  await publish(admin);
  assert.equal((await admin.post('/api/admin/delete-all', { confirm: 'delete' })).status, 200);
  assert.equal((await gameOf(env)).published, false);
  assert.equal((await admin.get('/api/admin/config')).body.results.published, false);
});

test('saving the game configuration returns the results to provisional', async () => {
  const { env, admin } = await finishedGame();
  await publish(admin);
  assert.equal((await admin.put('/api/admin/config', CONFIG)).status, 200); // allowed after the game
  assert.equal((await gameOf(env)).published, false);
});

// ---------------------------------------------------------------------------------------- safety

test('the new routes belong to their own role only', async () => {
  const env = setup();
  await configure(env);
  assert.equal((await env.player().post('/api/admin/results/publish', { confirm: true })).status, 404);
  assert.equal((await env.player().post('/api/admin/results/unpublish', {})).status, 404);
  assert.equal((await env.admin().get('/api/results')).status, 404);
});

test('the new routes never answer 403 or 404 for their own errors, which CloudFront would replace with the site 404 page', async () => {
  const { env, admin, alpha } = await finishedGame();
  const calls = [
    () => publish(admin, {}), () => publish(admin), () => apply(admin, 2, 'zone 1', 'half'), () => results(alpha),
    () => results(env.player()), () => admin.post('/api/admin/results/unpublish', {}), () => publish(admin, { confirm: 'yes' }),
  ];
  for (const now of [START - 1000, START + 1000, END + 1]) {
    env.clock.now = now;
    for (const call of calls) assert.ok(![403, 404].includes((await call()).status), `now=${now}`);
  }
});
