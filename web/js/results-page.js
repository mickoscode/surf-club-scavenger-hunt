// The /results/ page. A player sees how they finished and a breakdown of every question and photo, once the admin has
// published the final results. Anybody else (a viewer, a removed team) sees only the link back to the scoreboard, and so
// does a player before the results are published (plus a note). Everything from the server is put on the page as text.
import { getJson } from './api.js';
import { $, refreshInterval } from './dom.js';
import { renderResults } from './results-view.js';

function render(data) {
  renderResults({ heading: $('place-heading'), total: $('total'), zones: $('result-zones') }, data.results);
}

let shown = null;
async function refresh() {
  const res = await getJson('/api/results');
  if (!res.ok) return; // keep what is shown; try again at the next refresh
  const { body } = res;
  const state = !body.team ? 'viewer' : body.published ? 'results' : 'not-ready';
  const key = JSON.stringify([state, state === 'results' ? body.results : null]);
  if (key === shown) return;
  shown = key;
  $('results-not-ready').hidden = state !== 'not-ready';
  $('results-body').hidden = state !== 'results';
  if (state === 'results') render(body);
}

refresh();
setInterval(refresh, refreshInterval());
document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });
