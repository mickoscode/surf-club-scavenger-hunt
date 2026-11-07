// The /view/ page: join (or play), the live scoreboard and the game countdown.
// Team names are only ever put on the page as text.
import { getJson } from './api.js';
import { $, refreshInterval } from './dom.js';
import { formatScore } from './format.js';
import { createClock } from './clock.js';
import { createMeArea } from './me-area.js';

const clock = createClock();
let started = false; // set once the first scoreboard has arrived: before that, nothing is known about the game
let me = null; // { number, name, score } once this device has joined

const meArea = createMeArea({ container: $('me-area'), onJoined: refresh });
const canJoin = () => ['pre', 'active'].includes(clock.phase());

function renderMeArea() {
  if (started) meArea.render({ team: me, canJoin: canJoin() });
}

function renderScoreboard(teams) {
  const rows = teams.map((team) => {
    const mine = me?.number === team.number;
    const row = document.createElement('tr');
    row.dataset.testid = 'scoreboard-row';
    row.dataset.teamNumber = String(team.number);
    row.dataset.score = String(team.score);
    if (mine) {
      row.dataset.mine = 'true';
      row.className = 'table-primary';
    }
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
  const [board, mine] = await Promise.all([getJson('/api/scoreboard'), getJson('/api/me')]);
  $('load-error').hidden = board.ok;
  if (!board.ok) return; // keep showing what we have; the next refresh tries again
  clock.update(board.body.game);
  if (mine.ok) me = mine.body.team;
  started = true;
  renderScoreboard(board.body.teams);
  clock.render();
  renderMeArea();
}

refresh();
setInterval(refresh, refreshInterval());
setInterval(() => { // the countdown ticks every second; joining opens and closes as the phase changes
  if (!started) return;
  clock.render();
  renderMeArea();
}, 1000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });
