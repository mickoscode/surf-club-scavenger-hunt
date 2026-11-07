// The /view/ page: the live scoreboard and the game countdown. Team names are only ever put on the page as text.
import { getJson } from './api.js';
import { formatScore } from './format.js';
import { phaseOf, countdownTarget, secondsUntil, formatCountdown } from './time.js';

const $ = (testId) => document.querySelector(`[data-testid="${testId}"]`);
const DEFAULT_REFRESH_MS = 5000;

// ?refresh=500 speeds up the refresh (used by the browser tests); anything outside 0.5 to 60 seconds is ignored.
function refreshInterval() {
  const asked = Number(new URLSearchParams(location.search).get('refresh'));
  return asked >= 500 && asked <= 60000 ? asked : DEFAULT_REFRESH_MS;
}

const STATUS_TEXT = { unconfigured: 'Coming soon', pre: 'Game starts in', active: 'Time left', post: 'Game over' };

let game = null;
let clockSkewMs = 0; // server time minus this device's time, so the countdown does not trust the phone's clock

function renderGame() {
  const phase = phaseOf(game, Date.now() + clockSkewMs);
  const status = $('status');
  status.dataset.phase = phase;
  status.textContent = STATUS_TEXT[phase];
  if (game?.name) $('game-name').textContent = game.name;

  const countdown = $('countdown');
  countdown.dataset.phase = phase;
  const target = game ? countdownTarget(game, phase) : null;
  if (target === null) {
    countdown.hidden = true;
    delete countdown.dataset.seconds;
  } else {
    const seconds = secondsUntil(target, Date.now() + clockSkewMs);
    countdown.hidden = false;
    countdown.dataset.seconds = String(seconds);
    countdown.textContent = formatCountdown(seconds);
  }
}

function renderScoreboard(teams) {
  const rows = teams.map((team) => {
    const row = document.createElement('tr');
    row.dataset.testid = 'scoreboard-row';
    row.dataset.teamNumber = String(team.number);
    row.dataset.score = String(team.score);
    const cells = [
      [String(team.number), 'text-muted'],
      [team.name, 'team-name'],
      [formatScore(team.score), 'text-end fw-semibold'],
    ];
    for (const [text, classes] of cells) {
      const cell = document.createElement('td');
      cell.className = classes;
      cell.textContent = text; // text, never markup
      row.append(cell);
    }
    return row;
  });
  $('scoreboard-body').replaceChildren(...rows);
  $('scoreboard').hidden = teams.length === 0;
  $('no-teams').hidden = teams.length > 0;
}

async function refresh() {
  const res = await getJson('/api/scoreboard');
  $('load-error').hidden = res.ok;
  if (!res.ok) return; // keep showing what we have; the next refresh tries again
  game = res.body.game;
  clockSkewMs = game.serverNowMs - Date.now();
  renderScoreboard(res.body.teams);
  renderGame();
}

refresh();
setInterval(refresh, refreshInterval());
setInterval(() => { if (game) renderGame(); }, 1000); // the countdown ticks every second
document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });
