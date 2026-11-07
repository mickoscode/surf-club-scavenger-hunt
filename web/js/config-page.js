// The /game-config/ admin page: the game's configuration, the teams (remove one), and the player data (download, delete).
// There is no login: the address is simply not shared (docs/requirements.md). Names and messages are set as text only.
import { getJson, putJson, postJson, deleteJson } from './api.js';
import { $, el, refreshInterval } from './dom.js';
import { formatScore } from './format.js';

const STATUS_TEXT = { loading: 'loading', unconfigured: 'no game set up yet', pre: 'before the game', active: 'game in progress', post: 'game finished' };
const FIELD_PROBLEM = {
  name: 'The game name must be 1 to 80 characters.',
  timeZone: 'Choose a time zone.',
  day: 'Enter the game day.',
  start: 'Enter a start time.',
  end: 'Enter an end time.',
  'end-before-start': 'The end must be after the start.',
};

let status = 'loading';
let downloaded = false; // the data must be downloaded before it can be deleted
let confirming = null; // the number of the team whose removal is awaiting confirmation
let formLoaded = false;
let shownTeams = null;

const form = $('config-form');
const fields = { name: $('config-name'), timeZone: $('config-timezone'), day: $('config-day'), start: $('config-start'), end: $('config-end') };

function fillForm({ config, defaults, timeZones }) {
  fields.timeZone.replaceChildren(...timeZones.map((z) => el('option', { value: z.id }, z.label)));
  fields.name.value = config?.name ?? defaults.name;
  fields.timeZone.value = config?.timeZone ?? defaults.timeZone;
  fields.day.value = config?.day ?? '';
  fields.start.value = config?.start ?? '';
  fields.end.value = config?.end ?? '';
}

function renderStatus(info, teamCount) {
  status = info.status;
  const badge = $('game-status');
  badge.dataset.status = status;
  badge.textContent = STATUS_TEXT[status];
  const zones = info.zoneCount > 0 ? `${info.zoneCount} zone${info.zoneCount === 1 ? '' : 's'} loaded` : 'no zones loaded';
  $('status-detail').textContent = `${zones} · ${teamCount} team${teamCount === 1 ? '' : 's'}`;
  const active = status === 'active';
  $('active-notice').hidden = !active;
  for (const input of [...Object.values(fields), $('config-save')]) input.disabled = active;
  renderDeleteSection();
}

function renderDeleteSection() {
  const active = status === 'active';
  const typed = $('delete-confirm').value.trim().toLowerCase() === 'delete';
  $('delete-confirm').disabled = active;
  $('delete-button').disabled = active || !downloaded || !typed;
  $('delete-notice').textContent = active
    ? 'Not while the game is in progress.'
    : downloaded ? '' : 'Download the data first (step 1) to enable the delete button.';
}

function renderTeams(teams) {
  const key = JSON.stringify([teams, confirming]);
  if (key === shownTeams) return;
  shownTeams = key;
  $('no-teams').hidden = teams.length > 0;
  $('teams-list').replaceChildren(...teams.map((team) => {
    const item = el('li', { class: 'list-group-item d-flex flex-wrap justify-content-between align-items-center gap-2', 'data-testid': 'team-item', 'data-team-number': String(team.number) });
    item.append(el('span', { class: 'team-name flex-grow-1' }, `${team.number}. ${team.name} (${formatScore(team.score)})`)); // text, never markup
    const actions = el('span', { class: 'd-flex gap-2' });
    if (confirming === team.number) {
      const yes = el('button', { type: 'button', class: 'btn btn-danger btn-sm', 'data-testid': 'team-remove-confirm' }, 'Remove team');
      const no = el('button', { type: 'button', class: 'btn btn-outline-secondary btn-sm', 'data-testid': 'team-remove-cancel' }, 'Keep');
      yes.addEventListener('click', async () => { confirming = null; await deleteJson(`/api/admin/teams/${team.number}`); await refresh(); });
      no.addEventListener('click', () => { confirming = null; shownTeams = null; refresh(); });
      actions.append(yes, no);
    } else {
      const remove = el('button', { type: 'button', class: 'btn btn-outline-danger btn-sm', 'data-testid': 'team-remove' }, 'Remove');
      remove.addEventListener('click', () => { confirming = team.number; shownTeams = null; refresh(); });
      actions.append(remove);
    }
    item.append(actions);
    return item;
  }));
}

async function refresh() {
  const [info, teams] = await Promise.all([getJson('/api/admin/config'), getJson('/api/admin/teams')]);
  $('load-error').hidden = info.ok && teams.ok;
  if (!info.ok || !teams.ok) return;
  if (!formLoaded) { fillForm(info.body); formLoaded = true; }
  renderStatus(info.body, teams.body.teams.length);
  renderTeams(teams.body.teams);
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const error = $('config-error');
  const problems = $('config-problems');
  const success = $('config-success');
  error.hidden = problems.hidden = success.hidden = true;
  const res = await putJson('/api/admin/config', Object.fromEntries(Object.entries(fields).map(([name, input]) => [name, input.value])));
  if (res.ok) {
    success.textContent = `Saved. ${res.body.zoneCount} zone${res.body.zoneCount === 1 ? '' : 's'} loaded from the game file.`;
    success.hidden = false;
    await refresh();
    return;
  }
  const code = res.status === 0 ? 'network' : (res.body?.error ?? 'unknown');
  error.dataset.error = code;
  error.dataset.fields = (res.body?.fields ?? []).join(' ');
  error.textContent = {
    'invalid-config': (res.body?.fields ?? []).map((f) => FIELD_PROBLEM[f] ?? f).join(' '),
    'invalid-game-data': 'The game file (docs/game-questions.json) has problems, so nothing was saved:',
    'game-active': 'The game is in progress, so it cannot be changed.',
    network: 'Could not save. Check the connection and try again.',
  }[code] ?? 'Something went wrong. Please try again.';
  error.hidden = false;
  if (res.body?.problems) {
    problems.replaceChildren(...res.body.problems.map((p) => el('li', {}, p)));
    problems.hidden = false;
  }
});

$('export-link').addEventListener('click', () => { downloaded = true; renderDeleteSection(); });
$('delete-confirm').addEventListener('input', renderDeleteSection);
$('delete-button').addEventListener('click', async () => {
  const result = $('delete-result');
  $('delete-button').disabled = true;
  const res = await postJson('/api/admin/delete-all', { confirm: 'delete' });
  result.hidden = false;
  result.className = res.ok ? 'text-success mt-2 mb-0' : 'text-danger mt-2 mb-0';
  result.dataset.error = res.ok ? '' : (res.body?.error ?? 'unknown');
  result.textContent = res.ok ? 'All player data deleted. The next game starts clean.' : 'Nothing was deleted. Please try again.';
  if (res.ok) { downloaded = false; $('delete-confirm').value = ''; }
  await refresh();
  renderDeleteSection();
});

refresh();
setInterval(refresh, refreshInterval());
document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });
