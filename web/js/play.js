// The /play/ page: who you are, the countdown, the instructions, and (during the game) the zones.
// Someone who has not joined (or whose team was removed) is sent back to the scoreboard page, where they can join.
import { getJson } from './api.js';
import { $, refreshInterval } from './dom.js';
import { createClock } from './clock.js';
import { createZones } from './zones.js';

const clock = createClock();
const zones = createZones({ container: $('zones'), onSubmitted: refresh });
let started = false;
let shownTeam = null;

const PHASE_MESSAGE = {
  unconfigured: 'No game is set up yet.',
  pre: 'The game has not started yet. The zones appear here when it does.',
  post: 'The game is over. Thanks for playing!',
};

function renderTeam(team) {
  const key = `${team.number}:${team.name}`;
  if (key === shownTeam) return;
  shownTeam = key;
  const number = $('team-number');
  number.dataset.teamNumber = String(team.number);
  number.textContent = `Team ${team.number}`;
  $('team-name').textContent = team.name; // text, never markup
}

function renderPhase() {
  clock.render();
  const phase = clock.phase();
  const message = $('play-message');
  message.dataset.phase = phase;
  message.hidden = !PHASE_MESSAGE[phase];
  message.textContent = PHASE_MESSAGE[phase] ?? '';
  $('zones').hidden = phase !== 'active';
  $('results-link').hidden = !clock.published(); // the final results are out: the same Results button as on the scoreboard page
}

async function refresh() {
  const [me, game] = await Promise.all([getJson('/api/me'), getJson('/api/game')]);
  $('load-error').hidden = me.ok && game.ok;
  if (me.ok && !me.body.team) return location.replace('/view/');
  if (me.ok) renderTeam(me.body.team);
  if (game.ok) {
    clock.update(game.body.game);
    started = true;
    renderPhase();
    if (game.body.zones.length > 0) zones.render(game.body.zones);
  }
  if (me.ok && me.body.done) zones.applyDone(me.body.done);
}

refresh();
setInterval(refresh, refreshInterval());
setInterval(() => { if (started) renderPhase(); }, 1000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });
