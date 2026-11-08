'use strict';
// The admin passcode. Rules: docs/requirements.md, "Admin passcode".
//
// Only a one-way HASH of the passcode is ever stored (as a sensitive HCP Terraform variable, handed to the admin function).
// A login checks the passcode against it and starts a session: a signed token in a cookie, signed with a key made from the
// hash, so changing the passcode ends every session. Built-in modules only.
const crypto = require('node:crypto');

const SESSION_HOURS = 12;
const SESSION_MS = SESSION_HOURS * 60 * 60 * 1000;
// A passcode is made of 20 characters from an alphabet without look-alikes (no 0/o, 1/l/i), about 99 bits.
const ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';
const DEFAULT_COST = { N: 32768, r: 8, p: 1 }; // scrypt: 32 MB of memory, well within the 256 MB function
const HASH_FORMAT = /^scrypt\$\d+\$\d+\$\d+\$[A-Za-z0-9_-]+\$[A-Za-z0-9_-]+$/; // the same pattern as the Terraform variable

const b64 = (buffer) => Buffer.from(buffer).toString('base64url');

// Case, spaces and dashes do not matter when typing a passcode (a phone keyboard capitalises, people add spaces).
const normalise = (passcode) => String(passcode).trim().toLowerCase().replace(/[\s-]/g, '');

const scrypt = (password, salt, { N, r, p }, keylen) =>
  new Promise((resolve, reject) => {
    crypto.scrypt(password, salt, keylen, { N, r, p, maxmem: 128 * N * r * 2 }, (error, key) => (error ? reject(error) : resolve(key)));
  });

// -> "scrypt$N$r$p$<salt>$<hash>": everything needed to check a passcode later, nothing that reveals it.
async function hashPasscode(passcode, { cost = DEFAULT_COST, salt = crypto.randomBytes(16) } = {}) {
  const key = await scrypt(normalise(passcode), salt, cost, 32);
  return `scrypt$${cost.N}$${cost.r}$${cost.p}$${b64(salt)}$${b64(key)}`;
}

// true only for the right passcode. A stored value that is not a valid hash never matches (so a mistake locks the admin
// out instead of letting anybody in).
async function verifyPasscode(passcode, stored) {
  if (typeof stored !== 'string' || !HASH_FORMAT.test(stored)) return false;
  const [, N, r, p, salt, hash] = stored.split('$');
  const expected = Buffer.from(hash, 'base64url');
  let actual;
  try {
    actual = await scrypt(normalise(passcode), Buffer.from(salt, 'base64url'), { N: Number(N), r: Number(r), p: Number(p) }, expected.length);
  } catch {
    return false; // unusable parameters
  }
  return expected.length > 0 && actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

// "k7m2q-xd93p-wn4tr-h8jcf": random, shown in groups of five to be easy to copy.
function generatePasscode() {
  const chars = Array.from({ length: 20 }, () => ALPHABET[crypto.randomInt(ALPHABET.length)]).join('');
  return chars.match(/.{5}/g).join('-');
}

// ---------------------------------------------------------------------------------------------------- sessions

const sessionKey = (storedHash) => crypto.createHmac('sha256', 'hunt-admin-session-v1').update(String(storedHash)).digest();
const sign = (payload, storedHash) => b64(crypto.createHmac('sha256', sessionKey(storedHash)).update(payload).digest());

// A token that says "valid until <time>", signed so it cannot be forged or changed.
function createSession(storedHash, nowMs, ttlMs = SESSION_MS) {
  const payload = b64(JSON.stringify({ v: 1, exp: nowMs + ttlMs }));
  return `${payload}.${sign(payload, storedHash)}`;
}

function verifySession(token, storedHash, nowMs) {
  if (typeof token !== 'string' || typeof storedHash !== 'string' || storedHash === '') return false;
  const [payload, signature, ...extra] = token.split('.');
  if (!payload || !signature || extra.length > 0) return false;
  const expected = Buffer.from(sign(payload, storedHash));
  const given = Buffer.from(signature);
  if (expected.length !== given.length || !crypto.timingSafeEqual(expected, given)) return false;
  try {
    const { v, exp } = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    return v === 1 && Number.isFinite(exp) && nowMs < exp;
  } catch {
    return false;
  }
}

module.exports = {
  SESSION_MS, SESSION_HOURS, HASH_FORMAT, DEFAULT_COST,
  normalise, hashPasscode, verifyPasscode, generatePasscode, createSession, verifySession,
};
