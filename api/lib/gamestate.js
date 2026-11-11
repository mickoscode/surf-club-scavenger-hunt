'use strict';
// Game timing: is the game before, during or after its window, and what is each role allowed to do?
// Pure functions: "now" is always passed in, so the server clock is the only clock that counts and tests can
// put it anywhere. Rules: docs/requirements.md ("Game Configuration & Management", "Typical Timeline").

const { normaliseWhatsappUrl } = require('./whatsapp');
const { normaliseJoinCode } = require('./joincode');

const DEFAULT_GAME_NAME = 'Sorrento Youth Scavenger Hunt';
const DEFAULT_TIME_ZONE = 'Australia/Perth'; // AWST, UTC+8, no daylight saving
// The time zones a game can be set in (more can be added here; the server clock decides everything, in this zone).
const TIME_ZONES = [
  { id: 'Australia/Perth', label: 'AWST - Perth (UTC+8)' },
  { id: 'Europe/Dublin', label: 'Dublin, Ireland (GMT/IST)' },
];

const formatters = new Map();
function formatterFor(timeZone) {
  if (!formatters.has(timeZone)) {
    formatters.set(timeZone, new Intl.DateTimeFormat('en-US', {
      timeZone, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric',
      hour: 'numeric', minute: 'numeric', second: 'numeric',
    }));
  }
  return formatters.get(timeZone);
}

// Offset of a time zone from UTC (ms) at the given instant.
function zoneOffsetMs(utcMs, timeZone) {
  const p = Object.fromEntries(formatterFor(timeZone).formatToParts(new Date(utcMs)).map((x) => [x.type, +x.value]));
  const wallAsUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return wallAsUtc - Math.floor(utcMs / 1000) * 1000;
}

// The instant (UTC ms) at which the wall clock in timeZone reads dateStr timeStr ("2026-11-14", "09:30").
// Games run in the daytime, so the daylight-saving gap/overlap hours are not a concern here.
function localToUtcMs(dateStr, timeStr, timeZone) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const [h, mi] = timeStr.split(':').map(Number);
  const wallAsUtc = Date.UTC(y, m - 1, d, h, mi);
  const guess = wallAsUtc - zoneOffsetMs(wallAsUtc, timeZone);
  return wallAsUtc - zoneOffsetMs(guess, timeZone);
}

const isRealDate = (s) => {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
};
const isTime = (s) => typeof s === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(s);

// Config shape: { name, timeZone, day: 'yyyy-mm-dd', start: 'hh:mm', end: 'hh:mm', whatsappUrl?, teamNames? (false = teams have no names), joinCode? (5-12 letters and digits) }. Returns a list of problems.
function validateConfig(config) {
  if (config === null || typeof config !== 'object' || Array.isArray(config)) return ['config must be an object'];
  const problems = [];
  if (typeof config.name !== 'string' || config.name.trim() === '' || config.name.trim().length > 80) problems.push('name');
  if (!TIME_ZONES.some((z) => z.id === config.timeZone)) problems.push('timeZone');
  if (!isRealDate(config.day)) problems.push('day');
  if (!isTime(config.start)) problems.push('start');
  if (!isTime(config.end)) problems.push('end');
  if (isTime(config.start) && isTime(config.end) && config.end <= config.start) problems.push('end-before-start');
  if (!normaliseWhatsappUrl(config.whatsappUrl).ok) problems.push('whatsappUrl'); // optional: absent is fine
  if (!normaliseJoinCode(config.joinCode).ok) problems.push('joinCode');
  if (config.teamNames !== undefined && typeof config.teamNames !== 'boolean') problems.push('teamNames');
  return problems;
}

function gameWindow(config) {
  return {
    startMs: localToUtcMs(config.day, config.start, config.timeZone),
    endMs: localToUtcMs(config.day, config.end, config.timeZone),
  };
}

// 'unconfigured' (no valid config yet), 'pre', 'active' (start and end both inclusive) or 'post'.
function gameStatus(config, nowMs) {
  if (!config || validateConfig(config).length > 0) return 'unconfigured';
  const { startMs, endMs } = gameWindow(config);
  if (nowMs < startMs) return 'pre';
  if (nowMs <= endMs) return 'active';
  return 'post';
}

// What the pages need for the countdown (the browser only displays it; the server decides everything).
function describeGame(config, nowMs) {
  const status = gameStatus(config, nowMs);
  if (status === 'unconfigured') return { status, serverNowMs: nowMs };
  const { startMs, endMs } = gameWindow(config);
  return { status, serverNowMs: nowMs, startMs, endMs };
}

// Who may do what in each status (docs/requirements.md, "Typical Timeline").
const PERMISSIONS = {
  unconfigured: { join: false, play: false, score: false, configure: true, deleteData: true, removeTeam: true, publish: false },
  pre: { join: true, play: false, score: false, configure: true, deleteData: true, removeTeam: true, publish: false },
  active: { join: true, play: true, score: true, configure: false, deleteData: false, removeTeam: true, publish: false },
  post: { join: false, play: false, score: true, configure: true, deleteData: true, removeTeam: true, publish: true },
};
const can = (status, action) => PERMISSIONS[status]?.[action] === true;

module.exports = {
  DEFAULT_GAME_NAME, DEFAULT_TIME_ZONE, TIME_ZONES,
  localToUtcMs, validateConfig, gameWindow, gameStatus, describeGame, can,
};
