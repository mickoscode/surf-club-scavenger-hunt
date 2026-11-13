// The /play/ page: who you are, the countdown, the instructions, and (during the game) the zones.
// Someone who has not joined (or whose team was removed) is sent back to the scoreboard page, where they can join.
import { getJson } from './api.js';
import { $, refreshInterval } from './dom.js';
import { createClock } from './clock.js';
import { createZones } from './zones.js';
import { applyWhatsAppLinks, safeWhatsAppUrl } from './whatsapp.js';
import { renderMarkdown } from './markdown.js';
import { formatScore } from './format.js';

const clock = createClock();
const zones = createZones({ container: $('zones'), onSubmitted: refresh });
let started = false;
let shownTeam = null;
let lastTeamNames = true;
let scoreShown = false; // the game is active or over
let teamScore = null; // this team's score from /api/me (null until known)
let shownInstructions; // the instructions text last put on the page (undefined: none yet, and the panel stays hidden)

// The instructions of the event the game was loaded from (text; empty means none).
function renderInstructions(text) {
  if (typeof text !== 'string' || text === shownInstructions) return;
  shownInstructions = text;
  $('instructions').hidden = text.trim() === '';
  renderMarkdown(document.querySelector('[data-testid="instructions"] .instructions'), text);
  whatsappUrl = undefined; // the text was rebuilt: put the WhatsApp links back
}
let whatsappUrl; // undefined until known, so the first answer always applies

const PHASE_MESSAGE = {
  unconfigured: 'No game is set up yet.',
  pre: 'The game has not started yet. The zones appear here when it does.',
  post: 'The game is over. Final results will be published soon!',
};

function renderTeam(team, teamNames) {
  const key = `${team.number}:${team.name}:${teamNames}`;
  if (key === shownTeam) return;
  shownTeam = key;
  const number = $('team-number');
  number.dataset.teamNumber = String(team.number);
  number.textContent = `Team ${team.number}`;
  $('team-name').textContent = teamNames ? team.name : ''; // text, never markup; with team names off only "Team 7" is shown
  $('team-name').hidden = !teamNames;
}

// "Score: 12 scoreboard": the team's score sits in front of the scoreboard link while the game is active or over.
// With no score yet to show it stays hidden, and the link keeps its full "View scoreboard" wording.
function renderScore() {
  const el = $('score');
  const show = scoreShown && teamScore !== null;
  el.hidden = !show;
  el.dataset.score = show ? String(teamScore) : '';
  el.textContent = show ? `Score: ${formatScore(teamScore)} ` : '';
  $('scoreboard-link').textContent = show ? 'scoreboard' : 'View scoreboard';
}

function renderPhase() {
  clock.render();
  const phase = clock.phase();
  const message = $('play-message');
  message.dataset.phase = phase;
  message.hidden = !PHASE_MESSAGE[phase];
  // once the admin has published, "will be published soon" would be wrong
  message.textContent = phase === 'post' && clock.published() ? 'The game is over. The final results are in!' : PHASE_MESSAGE[phase] ?? '';
  $('zones').hidden = phase !== 'active';
  scoreShown = phase === 'active' || phase === 'post';
  renderScore();
  $('results-link').hidden = !clock.published(); // the final results are out: the same Results button as on the scoreboard page
}

async function refresh() {
  const [me, game] = await Promise.all([getJson('/api/me'), getJson('/api/game')]);
  $('load-error').hidden = me.ok && game.ok;
  if (me.ok && !me.body.team) return location.replace('/view/');
  if (me.ok) teamScore = typeof me.body.team.score === 'number' ? me.body.team.score : null;
  if (me.ok) renderTeam(me.body.team, game.ok ? game.body.game.teamNames !== false : lastTeamNames);
  if (game.ok) {
    lastTeamNames = game.body.game.teamNames !== false;
    clock.update(game.body.game);
    renderInstructions(game.body.instructions);
    started = true;
    renderPhase();
    if (game.body.zones.length > 0) zones.render(game.body.zones);
  }
  renderScore();
  if (me.ok && me.body.done) zones.applyDone(me.body.done);
  if (me.ok) { // the WhatsApp group link, if the admin set one: only a team with a session is given it
    const link = safeWhatsAppUrl(me.body.whatsappUrl);
    if (link !== whatsappUrl) {
      whatsappUrl = link;
      applyWhatsAppLinks($('instructions'), link);
      zones.setWhatsApp(link);
    }
  }
}

refresh();
setInterval(refresh, refreshInterval());
setInterval(() => { if (started) renderPhase(); }, 1000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });
