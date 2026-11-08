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
let meAsked = false; // /api/me cannot be shared between people, so a visitor with no team asks only once, not every refresh

const meArea = createMeArea({ container: $('me-area'), onJoined: () => refresh(true) });
const canJoin = () => ['pre', 'active'].includes(clock.phase());

function renderMeArea() {
  // From the moment the game is over the Play button is a Results button, even before the results are published (the results
  // page then says they are not ready yet).
  if (started) meArea.render({ team: me, canJoin: canJoin(), gameOver: clock.phase() === 'post' || clock.published() });
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
  const heading = $('scoreboard-heading'); // "provisional results:" until the admin publishes, then "final results:"
  heading.dataset.published = String(clock.published());
  heading.textContent = `${clock.published() ? 'final' : 'provisional'} results:`;
  heading.hidden = teams.length === 0;
  $('scoreboard').hidden = teams.length === 0;
  $('no-teams').hidden = teams.length > 0;
}

// forceMe: ask who this is even though we know nobody (just joined, or came back to the tab).
async function refresh(forceMe = false) {
  const askMe = forceMe || !meAsked || me !== null; // a team keeps asking, to notice if the admin removes it
  const [board, mine] = await Promise.all([getJson('/api/scoreboard'), askMe ? getJson('/api/me') : null]);
  $('load-error').hidden = board.ok;
  if (!board.ok) return; // keep showing what we have; the next refresh tries again
  clock.update(board.body.game);
  if (mine?.ok) { me = mine.body.team; meAsked = true; }
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
document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(true); });
