'use strict';
// Team names and the scoreboard order. Rules: docs/requirements.md, "Joining" and "Scoreboard". Pure functions.
const { normaliseText } = require('./answers');
const { roundScore } = require('./scoring');

const MAX_NAME_LENGTH = 30;

// A basic filter, not a promise: team names are public and children read them, so the obvious cases are blocked,
// and the admin can remove a team. "whole" words match only as a complete word (so "assassins" is fine);
// "contains" words are blocked anywhere, even with spaces or look-alike digits ("sh1t", "s h i t").
const DEFAULT_BLOCKED = {
  whole: ['ass', 'arse', 'tit', 'tits', 'cock', 'dick', 'piss', 'fag', 'fags', 'wog', 'coon', 'spic', 'cunt', 'cunts',
    'wank', 'wanker', 'wankers', 'pedo', 'retard', 'retards', 'retarded'],
  // Only long, unambiguous words are matched inside other words: short ones would block names like "Torpedoes".
  contains: ['fuck', 'shit', 'bitch', 'bastard', 'twat', 'slut', 'whore', 'nigger', 'nigga', 'faggot', 'paedo', 'rapist'],
};
const LOOK_ALIKES = { 0: 'o', 1: 'i', 3: 'e', 4: 'a', 5: 's', 7: 't', '@': 'a', $: 's' };

function isBlocked(name, blocked) {
  const mapped = name.toLowerCase().replace(/[013457@$]/g, (c) => LOOK_ALIKES[c]);
  const words = mapped.split(/[^a-z]+/).filter(Boolean);
  if (words.some((w) => blocked.whole.includes(w))) return true;
  const letters = mapped.replace(/[^a-z]/g, '');
  return blocked.contains.some((w) => letters.includes(w));
}

// -> { ok: true, name, key } or { ok: false, error }. `key` is what must be unique (ignoring case).
// Errors are codes, not sentences: 'empty' | 'too-long' | 'invalid-characters' | 'not-allowed'.
function validateTeamName(raw, blocked = DEFAULT_BLOCKED) {
  if (typeof raw !== 'string') return { ok: false, error: 'empty' };
  const name = raw.normalize('NFKC').trim().replace(/\s+/g, ' ');
  if (name === '') return { ok: false, error: 'empty' };
  if ([...name].length > MAX_NAME_LENGTH) return { ok: false, error: 'too-long' };
  if (/[\p{Cc}‪-‮⁦-⁩]/u.test(name)) return { ok: false, error: 'invalid-characters' };
  if (isBlocked(name, blocked)) return { ok: false, error: 'not-allowed' };
  return { ok: true, name, key: normaliseText(name) };
}

// Teams may have names or not: a game setting ("team names", on unless the configuration says false). With names off a team
// is "Team <number>" everywhere, whatever name it may have stored.
const teamNamesOn = (config) => config?.teamNames !== false;
const teamLabel = (team, config) => (teamNamesOn(config) && team.name ? team.name : `Team ${team.number}`);

// Teams: [{ number, name, score }]. Highest score first, then team name A-Z (ignoring case), then number; with team names
// off, then by number.
function sortScoreboard(teams, { namesOn = true } = {}) {
  return [...teams].sort((a, b) =>
    roundScore(b.score) - roundScore(a.score)
    || (namesOn ? a.name.localeCompare(b.name, 'en-AU', { sensitivity: 'base' }) : 0)
    || a.number - b.number);
}

module.exports = { MAX_NAME_LENGTH, DEFAULT_BLOCKED, validateTeamName, sortScoreboard, teamNamesOn, teamLabel };
