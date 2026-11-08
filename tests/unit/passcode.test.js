// The admin passcode: hashing, checking, generating and session tokens. A low scrypt cost keeps the tests fast; the hash itself
// says which cost it was made with, so checking works the same.
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  hashPasscode, verifyPasscode, generatePasscode, createSession, verifySession, normalise, HASH_FORMAT, SESSION_MS,
} = require('../../api/lib/passcode.js');

const FAST = { cost: { N: 1024, r: 8, p: 1 } };

test('the right passcode matches its hash and a wrong one does not', async () => {
  const hash = await hashPasscode('k7m2q-xd93p-wn4tr-h8jcf', FAST);
  assert.equal(await verifyPasscode('k7m2q-xd93p-wn4tr-h8jcf', hash), true);
  assert.equal(await verifyPasscode('k7m2q-xd93p-wn4tr-h8jcg', hash), false);
  assert.equal(await verifyPasscode('', hash), false);
  assert.equal(await verifyPasscode('x'.repeat(10_000), hash), false);
});

test('case, spaces and dashes do not matter when typing the passcode', async () => {
  const hash = await hashPasscode('k7m2q-xd93p-wn4tr-h8jcf', FAST);
  for (const typed of ['K7M2Q-XD93P-WN4TR-H8JCF', 'k7m2q xd93p wn4tr h8jcf', '  k7m2qxd93pwn4trh8jcf  ', 'k7m2q-xd93p-wn4tr-h8jcf\n']) {
    assert.equal(await verifyPasscode(typed, hash), true, JSON.stringify(typed));
  }
  assert.equal(normalise(' A-b c '), 'abc');
});

test('a hash holds no trace of the passcode, and two hashes of one passcode differ (random salt)', async () => {
  const a = await hashPasscode('k7m2q-xd93p-wn4tr-h8jcf', FAST);
  const b = await hashPasscode('k7m2q-xd93p-wn4tr-h8jcf', FAST);
  assert.notEqual(a, b);
  assert.ok(!a.includes('k7m2q') && !a.includes('xd93p'));
  assert.match(a, HASH_FORMAT); // the pattern the Terraform variable accepts
});

test('a stored value that is not a valid hash never matches: a mistake locks the admin out, it never lets anybody in', async () => {
  for (const stored of ['', undefined, null, 42, 'plain-text-passcode', 'scrypt$1$1$1$x$y', 'scrypt$notanumber$8$1$c2FsdA$aGFzaA', 'scrypt$1024$8$1$c2FsdA$']) {
    assert.equal(await verifyPasscode('anything', stored), false, String(stored));
  }
  assert.equal(await verifyPasscode('', 'scrypt$1024$8$1$c2FsdA$'), false);
});

test('a generated passcode is 20 characters from an unambiguous alphabet, in groups of five, and different every time', () => {
  const seen = new Set();
  for (let i = 0; i < 200; i++) {
    const code = generatePasscode();
    assert.match(code, /^[a-hjkmnp-z2-9]{5}(-[a-hjkmnp-z2-9]{5}){3}$/);
    seen.add(code);
  }
  assert.equal(seen.size, 200);
});

test('a session token is valid until it expires and not a moment longer', () => {
  const hash = 'scrypt$1024$8$1$c2FsdA$aGFzaA';
  const token = createSession(hash, 1_000);
  assert.equal(verifySession(token, hash, 1_000), true);
  assert.equal(verifySession(token, hash, 1_000 + SESSION_MS - 1), true);
  assert.equal(verifySession(token, hash, 1_000 + SESSION_MS), false);
  assert.equal(SESSION_MS, 12 * 60 * 60 * 1000);
});

test('a session token cannot be forged, altered, or used after the passcode is changed', () => {
  const hash = 'scrypt$1024$8$1$c2FsdA$aGFzaA';
  const token = createSession(hash, 0);
  const [payload, signature] = token.split('.');
  const forgedPayload = Buffer.from(JSON.stringify({ v: 1, exp: 9e15 })).toString('base64url');
  const attempts = [
    `${forgedPayload}.${signature}`, // a longer life with the old signature
    `${payload}.${signature.slice(0, -2)}AA`, // an altered signature
    `${payload}.`, `.${signature}`, payload, '', `${token}.extra`, 'not a token', undefined, null, 42,
  ];
  for (const bad of attempts) assert.equal(verifySession(bad, hash, 1), false, String(bad));
  assert.equal(verifySession(token, 'scrypt$1024$8$1$c2FsdA$b3RoZXI', 1), false); // a new passcode ends every old session
  assert.equal(verifySession(token, '', 1), false);
  assert.equal(verifySession(token, undefined, 1), false);
});
