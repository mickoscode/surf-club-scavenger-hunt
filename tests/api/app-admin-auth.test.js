// The admin passcode, through the app with the in-memory store and a controllable clock. Status codes and error codes only,
// never wording. A low scrypt cost keeps it fast; the hash says which cost it was made with.
const test = require('node:test');
const assert = require('node:assert/strict');
const { setup, CONFIG, START, END } = require('./helpers.js');
const { hashPasscode, createSession } = require('../../api/lib/passcode.js');

const PASSCODE = 'k7m2q-xd93p-wn4tr-h8jcf';
let HASH;
test.before(async () => { HASH = await hashPasscode(PASSCODE, { cost: { N: 1024, r: 8, p: 1 } }); });

const locked = (over = {}) => setup({ adminPasscodeHash: HASH, now: START - 60_000, ...over });
const login = (admin, passcode = PASSCODE) => admin.post('/api/admin/login', { passcode });

// Every admin route, with a body that would work if it were allowed.
const ADMIN_CALLS = [
  ['GET', '/api/admin/config'], ['PUT', '/api/admin/config', CONFIG], ['GET', '/api/admin/teams'], ['DELETE', '/api/admin/teams/1'],
  ['GET', '/api/admin/photos'], ['POST', '/api/admin/photos/apply', { teamNumber: 1, zone: 'zone 1', question: 'Q4', decision: 'full' }],
  ['POST', '/api/admin/results/publish', { confirm: true }], ['POST', '/api/admin/results/unpublish', {}],
  ['GET', '/api/admin/export'], ['POST', '/api/admin/delete-all', { confirm: 'delete' }],
];
const call = (admin, [method, path, body]) => admin.call(method, path, body);

// ------------------------------------------------------------------------------------------------ not set yet

test('with no passcode set the admin stays open, exactly as before, and says so', async () => {
  const env = setup({ now: START - 60_000 });
  assert.deepEqual((await env.admin().get('/api/admin/session')).body, { required: false, authenticated: true });
  assert.equal((await env.admin().get('/api/admin/config')).status, 200);
  assert.equal((await env.admin().put('/api/admin/config', CONFIG)).status, 200);
  assert.deepEqual((await login(env.admin())).body, { required: false, authenticated: true }); // nothing to log in to
});

// ------------------------------------------------------------------------------------------------ set

test('once a passcode is set every admin call is refused without a session, including the export and the delete', async () => {
  const env = locked();
  for (const c of ADMIN_CALLS) {
    const res = await call(env.admin(), c);
    assert.deepEqual([res.status, res.body.error], [401, 'not-authenticated'], `${c[0]} ${c[1]}`);
    assert.equal(res.headers['cache-control'], 'no-store');
  }
  assert.equal(await env.store.getGame(), null); // and nothing was changed
});

test('the session check always answers, and says whether a login is needed and whether you are in', async () => {
  const env = locked();
  const admin = env.admin();
  assert.deepEqual((await admin.get('/api/admin/session')).body, { required: true, authenticated: false });
  await login(admin);
  assert.deepEqual((await admin.get('/api/admin/session')).body, { required: true, authenticated: true });
});

test('the right passcode logs in with a protected cookie that only the admin API receives, and then everything works', async () => {
  const env = locked();
  const admin = env.admin();
  const res = await login(admin);
  assert.deepEqual([res.status, res.body], [200, { required: true, authenticated: true }]);
  const cookie = res.cookies[0];
  for (const attribute of ['hunt_admin=', 'HttpOnly', 'Secure', 'SameSite=Strict', 'Path=/api/admin', 'Max-Age=43200']) assert.ok(cookie.includes(attribute), attribute);
  assert.equal(res.cookies.length, 1);
  assert.doesNotMatch(JSON.stringify(res.body), /hunt_admin|k7m2q/); // nothing secret in the body
  for (const c of [ADMIN_CALLS[0], ADMIN_CALLS[1], ADMIN_CALLS[2], ADMIN_CALLS[8]]) assert.equal((await call(admin, c)).status, 200, `${c[0]} ${c[1]}`);
});

test('a wrong passcode is refused with no cookie, whatever else is sent', async () => {
  const env = locked();
  for (const bad of ['wrong', '', 'k7m2q-xd93p-wn4tr-h8jcg', 'x'.repeat(300), 42, null, {}, ['k7m2q-xd93p-wn4tr-h8jcf']]) { // 300 characters is over the passcode's own limit
    const res = await login(env.admin(), bad);
    assert.deepEqual([res.status, res.body.error, res.cookies.length], [401, 'wrong-passcode', 0], JSON.stringify(bad).slice(0, 40));
  }
  assert.equal((await env.admin().post('/api/admin/login', {})).status, 401);
  const huge = await login(env.admin(), 'x'.repeat(5000)); // and a huge body is refused earlier still, also without a cookie
  assert.deepEqual([huge.status, huge.cookies.length], [413, 0]);
});

test('case, spaces and dashes do not matter when typing the passcode', async () => {
  const env = locked();
  for (const typed of ['K7M2Q-XD93P-WN4TR-H8JCF', 'k7m2q xd93p wn4tr h8jcf', ' k7m2qxd93pwn4trh8jcf ']) {
    assert.equal((await login(env.admin(), typed)).status, 200, typed);
  }
});

test('logging out ends the session', async () => {
  const env = locked();
  const admin = env.admin();
  await login(admin);
  const out = await admin.post('/api/admin/logout', {});
  assert.deepEqual([out.status, out.body], [200, { authenticated: false }]);
  assert.match(out.cookies[0], /Max-Age=0/);
  assert.equal((await admin.get('/api/admin/config')).status, 401);
});

test('login needs a JSON body like every other POST', async () => {
  const env = locked();
  const res = await env.admin().call('POST', '/api/admin/login', undefined, { type: 'application/x-www-form-urlencoded', raw: `passcode=${PASSCODE}` });
  assert.equal(res.status, 415);
});

// ------------------------------------------------------------------------------------------------ sessions

test('a session lasts 12 hours, then the passcode is asked for again', async () => {
  const env = locked();
  const admin = env.admin();
  await login(admin);
  env.clock.now += 12 * 60 * 60 * 1000 - 1;
  assert.equal((await admin.get('/api/admin/config')).status, 200);
  env.clock.now += 1;
  assert.deepEqual([(await admin.get('/api/admin/config')).status, (await admin.get('/api/admin/session')).body.authenticated], [401, false]);
});

test('a session cannot be forged or altered, and changing the passcode ends every session', async () => {
  const env = locked();
  const real = createSession(HASH, env.clock.now);
  const [payload, signature] = real.split('.');
  const forged = Buffer.from(JSON.stringify({ v: 1, exp: 9e15 })).toString('base64url');
  const rotated = createSession(await hashPasscode('another-passcode', { cost: { N: 1024, r: 8, p: 1 } }), env.clock.now);
  const attempts = { 'a longer life with the old signature': `${forged}.${signature}`, 'an altered signature': `${payload}.${signature.slice(0, -2)}AA`, 'signed for another passcode': rotated, 'garbage': 'not-a-token', 'empty': '' };
  for (const [what, token] of Object.entries(attempts)) {
    const admin = env.admin();
    admin.jar.set('hunt_admin', token);
    assert.equal((await admin.get('/api/admin/config')).status, 401, what);
  }
  const admin = env.admin();
  admin.jar.set('hunt_admin', real); // the genuine token works
  assert.equal((await admin.get('/api/admin/config')).status, 200);
});

test('a team\'s session cookie does not open the admin', async () => {
  const env = locked();
  const admin = env.admin();
  await login(admin);
  assert.equal((await admin.put('/api/admin/config', CONFIG)).status, 200); // set the game up as the admin
  const team = env.player();
  await team.post('/api/join', { name: 'Sea Dogs' });
  const intruder = env.admin();
  for (const [name, value] of team.jar) intruder.jar.set(name, value); // the team's cookie, sent to the admin API
  assert.equal((await intruder.get('/api/admin/config')).status, 401);
});

// ------------------------------------------------------------------------------------------------ guessing

test('after 10 wrong passcodes in 5 minutes logins are refused, even the right one, until the window passes', async () => {
  const env = locked();
  const admin = env.admin();
  for (let i = 0; i < 10; i++) assert.equal((await login(admin, `wrong-${i}`)).status, 401, `guess ${i + 1}`);
  const blocked = await login(admin); // the right passcode, but too late
  assert.deepEqual([blocked.status, blocked.body.error], [409, 'too-many-attempts']);
  assert.ok(blocked.body.retryAfterSeconds > 0 && blocked.body.retryAfterSeconds <= 300);
  assert.equal(blocked.cookies.length, 0);
  assert.equal((await admin.get('/api/admin/config')).status, 401);

  env.clock.now += 5 * 60 * 1000; // the next window
  assert.equal((await login(admin)).status, 200);
});

test('a successful login clears the count, so a typo now and then never locks the admin out', async () => {
  const env = locked();
  for (let round = 0; round < 3; round++) {
    for (let i = 0; i < 9; i++) await login(env.admin(), 'typo');
    assert.equal((await login(env.admin())).status, 200, `round ${round}`); // 9 failures then success, three times over
  }
});

test('guessing is counted across every browser, not per browser', async () => {
  const env = locked();
  for (let i = 0; i < 10; i++) await login(env.admin(), `guess-${i}`); // ten different browsers
  assert.equal((await login(env.admin())).body.error, 'too-many-attempts');
});

// ------------------------------------------------------------------------------------------------ mistakes fail closed

test('a passcode setting that is not a valid hash locks the admin out instead of opening it', async () => {
  for (const broken of ['plain-text-passcode', 'scrypt$1$1$1$x$y', 'x']) {
    const env = setup({ adminPasscodeHash: broken, now: START - 60_000 });
    assert.deepEqual((await env.admin().get('/api/admin/session')).body, { required: true, authenticated: false }, broken);
    assert.equal((await env.admin().get('/api/admin/config')).status, 401, broken);
    assert.equal((await login(env.admin(), broken)).status, 401, broken); // not even the setting itself works as a passcode
  }
});

// ------------------------------------------------------------------------------------------------ the rest of the site

test('players are unaffected: the passcode protects only the admin', async () => {
  const env = locked();
  const admin = env.admin();
  await login(admin);
  await admin.put('/api/admin/config', CONFIG);
  env.clock.now = START + 60_000; // the game is on
  const p = env.player(); // a player has no admin session and needs none
  assert.equal((await p.post('/api/join', { name: 'Sea Dogs' })).status, 200);
  for (const path of ['/api/health', '/api/game', '/api/scoreboard', '/api/me', '/api/results']) assert.equal((await p.get(path)).status, 200, path);
  assert.equal((await p.post('/api/answer', { zone: 'zone 1', question: 'Q2', answer: '42' })).status, 200);
});

test('the public function has no login routes, and the admin function has no player routes', async () => {
  const env = locked();
  assert.equal((await env.player().post('/api/admin/login', { passcode: PASSCODE })).status, 404);
  assert.equal((await env.player().get('/api/admin/session')).status, 404);
  assert.equal((await env.admin().get('/api/scoreboard')).status, 404);
});

test('the passcode routes never answer 403 or 404 for their own errors, which CloudFront would replace with the site 404 page', async () => {
  const env = locked();
  const admin = env.admin();
  const calls = [
    () => login(admin, 'wrong'), () => login(admin), () => admin.get('/api/admin/config'), () => admin.post('/api/admin/logout', {}),
    () => admin.get('/api/admin/session'), () => admin.post('/api/admin/delete-all', { confirm: 'delete' }),
  ];
  for (const now of [START - 1000, START + 1000, END + 1]) {
    env.clock.now = now;
    for (const c of calls) assert.ok(![403, 404].includes((await c()).status), `now=${now}`);
  }
  for (let i = 0; i < 12; i++) await login(admin, `x${i}`); // and while locked out
  assert.ok(![403, 404].includes((await login(admin)).status));
});
