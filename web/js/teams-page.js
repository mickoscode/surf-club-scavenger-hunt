// The /game-teams/ admin page: the live scoreboard (the same table as /view/, from the same public API) and, by tapping a team,
// everything that team has submitted, shown exactly as the team will see it once the results are published (the shared
// results view), but available at any time so the admin can check on a team during the game. The address says which team
// (#team-7), so the browser's Back button and a reload work. Behind the admin passcode (web/js/admin-auth.js).
import { getJson } from './api.js';
import { $, el, refreshInterval } from './dom.js';
import { guardAdminPage, isLocked } from './admin-auth.js';
import { renderAdminNav } from './admin-nav.js';
import { scoreboardRows } from './scoreboard-table.js';
import { renderResults } from './results-view.js';
import { ordinal } from './results-format.js';

const teamFromHash = () => {
  const match = /^#team-(\d+)$/.exec(location.hash);
  return match ? Number(match[1]) : null;
};

let shownList = null; // what the list shows now (rebuilt only when it changes)
let shownTeam = null;

function renderList(body) {
  const key = JSON.stringify(body);
  if (key === shownList) return;
  shownList = key;
  const rows = scoreboardRows(body.teams, body.questionTotal, {
    nameCell: (team) => {
      const open = el('a', { href: `#team-${team.number}`, class: 'team-name', 'data-testid': 'team-link' }, team.name); // text, never markup
      return open;
    },
  });
  $('scoreboard-body').replaceChildren(...rows);
  const published = body.game.published === true;
  const heading = $('scoreboard-heading');
  heading.dataset.published = String(published);
  heading.textContent = `${published ? 'final' : 'provisional'} results:`;
  heading.hidden = body.teams.length === 0;
  $('scoreboard').hidden = body.teams.length === 0;
  $('no-teams').hidden = body.teams.length > 0;
}

function renderTeam(body) {
  const key = JSON.stringify(body);
  if (key === shownTeam) return;
  shownTeam = key;
  const { results, team, published } = body;
  $('team-note').textContent = `${team.name}${published ? '' : ' (provisional: the game and the scoring are still open)'}`;
  renderResults(
    { heading: $('place-heading'), total: $('total'), zones: $('result-zones') },
    results,
    `${team.name}: ${ordinal(results.place)} of ${results.teamCount}`,
  );
}

async function refresh() {
  if (isLocked()) return;
  const number = teamFromHash();
  $('teams-list-view').hidden = number !== null;
  $('team-view').hidden = number === null;
  if (number === null) {
    shownTeam = null;
    const res = await getJson('/api/scoreboard');
    $('load-error').hidden = res.ok;
    if (res.ok) renderList(res.body);
    return;
  }
  const res = await getJson(`/api/admin/teams/${number}/results`);
  if (res.status === 400) { location.hash = ''; return; } // the team has been removed (or never existed): back to the list
  $('load-error').hidden = res.ok || res.status === 409;
  if (res.ok) renderTeam(res.body);
  else if (res.status === 409) { location.hash = ''; } // no game is set up
}

renderAdminNav();
$('back-to-teams').addEventListener('click', (event) => { event.preventDefault(); location.hash = ''; });
window.addEventListener('hashchange', () => { window.scrollTo(0, 0); refresh(); });

guardAdminPage({
  start: () => {
    refresh();
    setInterval(refresh, refreshInterval());
    document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });
  },
  refresh,
});
