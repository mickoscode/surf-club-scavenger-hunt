// Team names are public (children read them) and must be unique; the scoreboard order is a stated rule.
const test = require('node:test');
const assert = require('node:assert/strict');
const { validateTeamName, sortScoreboard, MAX_NAME_LENGTH } = require('../../api/lib/teams.js');

test('names are tidied and given a case-insensitive uniqueness key', () => {
  const r = validateTeamName('  Sea   Dogs ');
  assert.deepEqual(r, { ok: true, name: 'Sea Dogs', key: 'sea dogs' });
  assert.equal(validateTeamName('SEA DOGS').key, r.key);
});

test('empty, too long and control-character names are rejected with an error code', () => {
  assert.equal(validateTeamName('   ').error, 'empty');
  assert.equal(validateTeamName(undefined).error, 'empty');
  assert.equal(validateTeamName('x'.repeat(MAX_NAME_LENGTH)).ok, true);
  assert.equal(validateTeamName('x'.repeat(MAX_NAME_LENGTH + 1)).error, 'too-long');
  assert.equal(validateTeamName('bad\u0000name').error, 'invalid-characters');
  assert.equal(validateTeamName('flip‮name').error, 'invalid-characters');
});

test('markup and emoji are allowed as plain text (pages render names as text only)', () => {
  assert.equal(validateTeamName('<b>Sharks</b> 🦈').ok, true);
});

test('the blocklist works as designed: whole words versus anywhere, look-alikes, spaces', () => {
  const blocked = { whole: ['zork'], contains: ['blargh'] };
  assert.equal(validateTeamName('Zork Team', blocked).error, 'not-allowed');
  assert.equal(validateTeamName('Zorkers', blocked).ok, true); // whole-word entries do not match inside other words
  assert.equal(validateTeamName('xBLARGHx', blocked).error, 'not-allowed');
  assert.equal(validateTeamName('bl4rgh', blocked).error, 'not-allowed'); // look-alike digit
  assert.equal(validateTeamName('b l a r g h', blocked).error, 'not-allowed'); // spaced out
});

test('the built-in list blocks the obvious and leaves ordinary words alone', () => {
  assert.equal(validateTeamName('sh1t').error, 'not-allowed');
  for (const fine of ['Assassins', 'Class Act', 'Scunthorpe', 'Titans', 'Cockatoos Rule', 'Torpedoes', 'Swankers']) {
    assert.equal(validateTeamName(fine).ok, true, fine);
  }
});

test('scoreboard: highest score first, then name A-Z ignoring case', () => {
  const teams = [
    { number: 1, name: 'bravo', score: 20 },
    { number: 2, name: 'Alpha', score: 20 },
    { number: 3, name: 'Zulu', score: 50 },
    { number: 4, name: 'Echo', score: 0 },
    { number: 5, name: 'Delta', score: 12.5 },
  ];
  assert.deepEqual(sortScoreboard(teams).map((t) => t.number), [3, 2, 1, 5, 4]);
  assert.deepEqual(teams.map((t) => t.number), [1, 2, 3, 4, 5]); // the input is not modified
});

test('scoreboard: scores that differ only by floating point noise count as tied', () => {
  const teams = [{ number: 1, name: 'B', score: 0.1 + 0.2 }, { number: 2, name: 'A', score: 0.3 }];
  assert.deepEqual(sortScoreboard(teams).map((t) => t.number), [2, 1]);
});
