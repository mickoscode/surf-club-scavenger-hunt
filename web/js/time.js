// Pure helpers for the countdown and the game phase. No DOM here, so they are tested in Node (tests/unit/frontend.test.js).
// The server is what decides who may do what: this is only for what the page shows.

const LAST_MINUTES_SECONDS = 5 * 60;
const pad = (n) => String(n).padStart(2, '0');

// Mirrors gameStatus() in api/lib/gamestate.js (the test checks they agree): start and end are both inclusive.
export function phaseOf(game, serverNowMs) {
  if (!game || game.status === 'unconfigured') return 'unconfigured';
  if (serverNowMs < game.startMs) return 'pre';
  if (serverNowMs <= game.endMs) return 'active';
  return 'post';
}

// The moment the countdown runs to: the start before the game, the end during it, none otherwise.
export function countdownTarget(game, phase) {
  if (phase === 'pre') return game.startMs;
  if (phase === 'active') return game.endMs;
  return null;
}

export const secondsUntil = (targetMs, nowMs) => Math.max(0, Math.ceil((targetMs - nowMs) / 1000));

// "42 min" until the last 5 minutes, then "4:59".
export function formatCountdown(seconds) {
  if (seconds <= LAST_MINUTES_SECONDS) return `${Math.floor(seconds / 60)}:${pad(seconds % 60)}`;
  return `${Math.ceil(seconds / 60)} min`;
}
