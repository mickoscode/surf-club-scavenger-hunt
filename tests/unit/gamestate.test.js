// Game timing is the rule everything else depends on (who may join, play, score, configure, delete), so these
// tests pin the boundaries and the time zone maths with hand-calculated UTC instants.
const test = require('node:test');
const assert = require('node:assert/strict');
const { localToUtcMs, validateConfig, gameStatus, describeGame, can, AU_TIME_ZONES } = require('../../api/lib/gamestate.js');

const perth = { name: 'Test game', timeZone: 'Australia/Perth', day: '2026-11-14', start: '10:00', end: '12:00' };
// Perth is UTC+8 all year: 10:00 AWST = 02:00Z, 12:00 AWST = 04:00Z.
const START = Date.UTC(2026, 10, 14, 2, 0);
const END = Date.UTC(2026, 10, 14, 4, 0);

test('wall-clock times convert to the right instant, including daylight saving', () => {
  assert.equal(localToUtcMs('2026-11-14', '10:00', 'Australia/Perth'), START);
  // Sydney is UTC+11 in November (daylight saving) and UTC+10 in July.
  assert.equal(localToUtcMs('2026-11-14', '09:00', 'Australia/Sydney'), Date.UTC(2026, 10, 13, 22, 0));
  assert.equal(localToUtcMs('2026-07-01', '09:00', 'Australia/Sydney'), Date.UTC(2026, 5, 30, 23, 0));
  // Darwin is UTC+9:30 with no daylight saving.
  assert.equal(localToUtcMs('2026-11-14', '09:30', 'Australia/Darwin'), Date.UTC(2026, 10, 14, 0, 0));
});

test('every offered time zone is understood by the runtime', () => {
  for (const z of AU_TIME_ZONES) {
    assert.ok(Number.isFinite(localToUtcMs('2026-11-14', '09:00', z.id)), z.id);
  }
});

test('status changes exactly at the start and end, both inclusive', () => {
  assert.equal(gameStatus(perth, START - 1), 'pre');
  assert.equal(gameStatus(perth, START), 'active');
  assert.equal(gameStatus(perth, END), 'active');
  assert.equal(gameStatus(perth, END + 1), 'post');
});

test('the day before is pre-game and the day after is post-game, whatever the time of day', () => {
  assert.equal(gameStatus(perth, Date.UTC(2026, 10, 13, 5, 0)), 'pre'); // 13th, 13:00 AWST: after the start time of day
  assert.equal(gameStatus(perth, Date.UTC(2026, 10, 15, 0, 0)), 'post'); // 15th, 08:00 AWST: before the end time of day
});

test('no valid config means unconfigured', () => {
  assert.equal(gameStatus(null, START), 'unconfigured');
  assert.equal(gameStatus({ ...perth, end: '09:00' }, START), 'unconfigured');
});

test('config validation rejects bad values and accepts good ones', () => {
  assert.deepEqual(validateConfig(perth), []);
  const bad = {
    'blank name': { name: '  ' },
    'unknown time zone': { timeZone: 'Europe/London' },
    'impossible date': { day: '2026-02-30' },
    'bad date format': { day: '14/11/2026' },
    'bad time': { start: '25:00' },
    'end equals start': { end: '10:00' },
    'end before start': { end: '09:59' },
  };
  for (const [what, change] of Object.entries(bad)) {
    assert.ok(validateConfig({ ...perth, ...change }).length > 0, what);
  }
  assert.ok(validateConfig(null).length > 0);
});

test('who may do what in each status', () => {
  const expected = {
    //                join   play   score  config deleteData removeTeam
    unconfigured: [false, false, false, true, true, true],
    pre: [true, false, false, true, true, true],
    active: [true, true, true, false, false, true],
    post: [false, false, true, true, true, true],
  };
  const actions = ['join', 'play', 'score', 'configure', 'deleteData', 'removeTeam'];
  for (const [status, row] of Object.entries(expected)) {
    actions.forEach((a, i) => assert.equal(can(status, a), row[i], `${status}: ${a}`));
  }
  assert.equal(can('active', 'launchRockets'), false);
});

test('describeGame gives the pages what they need and nothing else', () => {
  assert.deepEqual(describeGame(perth, START), { status: 'active', serverNowMs: START, startMs: START, endMs: END });
  assert.deepEqual(describeGame(null, 5), { status: 'unconfigured', serverNowMs: 5 });
});
