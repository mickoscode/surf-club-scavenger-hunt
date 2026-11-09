'use strict';
// The optional code a new team must enter to join (docs/requirements.md, "Join code"): a short word told to people at the
// event, so remote people cannot join. 5 to 12 letters and digits; case, spaces and dashes are ignored when it is typed.
// It is a shared secret, not a password: stored with the game configuration, shown only to the admin. Pure functions.
const crypto = require('node:crypto');

const normalise = (s) => String(s ?? '').toLowerCase().replace(/[\s-]+/g, '');
const ALLOWED = /^[A-Za-z0-9\s-]*$/; // anything else is refused when the configuration is saved

// For the configuration: absent or empty means no code. Otherwise { ok: true, code } (upper case, as the admin reads it out) or { ok: false }.
function normaliseJoinCode(input) {
  if (input === undefined || input === null || String(input).trim() === '') return { ok: true, code: '' };
  if (typeof input !== 'string' || !ALLOWED.test(input)) return { ok: false };
  const plain = normalise(input);
  return /^[a-z0-9]{5,12}$/.test(plain) ? { ok: true, code: plain.toUpperCase() } : { ok: false };
}

const digest = (s) => crypto.createHash('sha256').update(normalise(s)).digest();

// Whether what was typed is the code (compared in constant time).
const matchesJoinCode = (typed, code) => typeof typed === 'string' && typed.length <= 100 && crypto.timingSafeEqual(digest(typed), digest(code));

module.exports = { normaliseJoinCode, matchesJoinCode };
