// The /game-config/ admin page: the game's configuration, the teams (remove one), and the player data (download, delete).
// Behind the admin passcode (web/js/admin-auth.js). Names and messages are set as text only.
import { getJson, putJson, postJson, deleteJson } from './api.js';
import { $, el, refreshInterval } from './dom.js';
import { formatScore } from './format.js';
import { safeWhatsAppUrl } from './whatsapp.js';
import { guardAdminPage, isLocked } from './admin-auth.js';

const STATUS_TEXT = { loading: 'loading', unconfigured: 'no game set up yet', pre: 'before the game', active: 'game in progress', post: 'game finished' };
const EVENT_PROBLEM = {
  'players-exist': 'Another event cannot replace a game that has teams. Download and delete the player data first, then try again.',
  'event-incomplete': 'That event is missing map images. Upload it again on the Events page.',
  'unknown-event': 'That event no longer exists.',
  'events-unavailable': 'Events are not available on this site yet.',
};
const FIELD_PROBLEM = {
  name: 'The game name must be 1 to 80 characters.',
  timeZone: 'Choose a time zone.',
  day: 'Enter the game day.',
  start: 'Enter a start time.',
  end: 'Enter an end time.',
  'end-before-start': 'The end must be after the start.',
  joinCode: 'The code needs 5 to 12 letters and digits (or leave it empty for no code).',
  whatsappUrl: 'Use the group\'s invite link, which starts with https://chat.whatsapp.com/ (or leave it empty).',
};

let status = 'loading';
let downloaded = false; // the data must be downloaded before it can be deleted
let confirming = null; // the number of the team whose removal is awaiting confirmation
let formLoaded = false;
let shownTeams = null;

const form = $('config-form');
const fields = { name: $('config-name'), timeZone: $('config-timezone'), day: $('config-day'), start: $('config-start'), end: $('config-end'), whatsappUrl: $('config-whatsapp'), joinCode: $('config-join-code') };
const teamNamesBox = $('config-team-names'); // a checkbox: whether teams have names
const eventSelect = $('config-event'); // which stored event the live game is loaded from
let events = []; // the stored events, from /api/admin/events
let eventsKey = null;
let eventChosen = false; // the first load picks the live game's event; after that the admin's choice is left alone

function fillForm({ config, defaults, timeZones }) {
  fields.timeZone.replaceChildren(...timeZones.map((z) => el('option', { value: z.id }, z.label)));
  fields.name.value = config?.name ?? defaults.name;
  fields.timeZone.value = config?.timeZone ?? defaults.timeZone;
  fields.day.value = config?.day ?? '';
  fields.start.value = config?.start ?? '';
  fields.end.value = config?.end ?? '';
  fields.whatsappUrl.value = config?.whatsappUrl ?? '';
  fields.joinCode.value = config?.joinCode ?? '';
  teamNamesBox.checked = config?.teamNames !== false; // on unless the saved configuration says false
  updateTestLink();
}

// The saved values of an event's settings go into the form when that event is chosen (the admin can still change them).
function fillFromEvent(config) {
  if (!config) return;
  for (const name of ['name', 'timeZone', 'day', 'start', 'end', 'whatsappUrl', 'joinCode']) fields[name].value = config[name] ?? (name === 'name' ? fields.name.value : '');
  teamNamesBox.checked = config.teamNames !== false;
  updateTestLink();
}
eventSelect.addEventListener('change', () => fillFromEvent(events.find((e) => e.name === eventSelect.value)?.config));

// The list of stored events: rebuilt only when it changes, so a choice the admin has made is never lost on a refresh.
function renderEvents(list, active) {
  const key = JSON.stringify([list.events, list.available]);
  if (key === eventsKey) return;
  eventsKey = key;
  events = list.events;
  const chosen = eventChosen ? eventSelect.value : (active ?? '');
  eventSelect.replaceChildren(
    el('option', { value: '' }, 'Game file in the repository (the older way)'),
    ...events.map((e) => { const o = el('option', { value: e.name }, `${e.name}${e.complete ? '' : ' (incomplete: see the Events page)'}`); if (!e.complete) o.disabled = true; return o; }),
  );
  eventSelect.value = events.some((e) => e.name === chosen && e.complete) ? chosen : '';
  eventChosen = true;
}

// "Test link" opens what is typed in the field (when it looks like a group link) so the admin can check it before saving.
function updateTestLink() {
  const link = safeWhatsAppUrl(fields.whatsappUrl.value.trim());
  const test = $('whatsapp-test');
  test.hidden = !link;
  if (link) test.href = link;
}
fields.whatsappUrl.addEventListener('input', updateTestLink);

function renderStatus(info, teamCount) {
  status = info.status;
  const badge = $('game-status');
  badge.dataset.status = status;
  badge.textContent = STATUS_TEXT[status];
  const zones = info.zoneCount > 0 ? `${info.zoneCount} zone${info.zoneCount === 1 ? '' : 's'} loaded` : 'no zones loaded';
  $('status-detail').textContent = `${zones} · ${teamCount} team${teamCount === 1 ? '' : 's'}${info.event ? ` · event ${info.event}` : ''}`;
  $('status-detail').dataset.event = info.event ?? '';
  const active = status === 'active';
  $('active-notice').hidden = !active;
  for (const input of [...Object.values(fields), teamNamesBox, eventSelect, $('config-save')]) input.disabled = active;
  results = { published: info.results.published, unscored: info.unscoredPhotos };
  renderPublish();
  renderDeleteSection();
}

// The final-results form: only possible once the game is over, and only after ticking that all scores have been applied.
let results = { published: false, unscored: 0 };
function renderPublish() {
  const over = status === 'post';
  const { published, unscored } = results;
  const state = $('results-state');
  state.dataset.published = String(published);
  state.textContent = published ? 'final (published)' : 'provisional';
  state.className = `badge ${published ? 'text-bg-success' : 'text-bg-secondary'}`;
  $('results-notice').textContent = published
    ? 'Players can see their results, and scores are locked. Return to provisional to change a score.'
    : over ? 'The game is over. Publishing shows each team its results and the official answers.' : 'Available when the game is over.';
  const note = $('unscored-note');
  note.hidden = published || !over || unscored === 0;
  note.textContent = `${unscored} photo${unscored === 1 ? ' has' : 's have'} not been scored yet and will count as 0%.`;
  const confirm = $('publish-confirm');
  confirm.disabled = !over || published;
  if (published) confirm.checked = false;
  $('publish-button').hidden = published;
  $('publish-button').disabled = !over || published || !confirm.checked;
  $('unpublish-button').hidden = !published;
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
  if (isLocked()) return; // not logged in (yet, or any more)
  const [info, teams, list] = await Promise.all([getJson('/api/admin/config'), getJson('/api/admin/teams'), getJson('/api/admin/events')]);
  $('load-error').hidden = info.ok && teams.ok;
  if (!info.ok || !teams.ok) return;
  if (list.ok) renderEvents(list.body, info.body.event);
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
  const res = await putJson('/api/admin/config', { ...Object.fromEntries(Object.entries(fields).map(([name, input]) => [name, input.value])), teamNames: teamNamesBox.checked, event: eventSelect.value });
  if (res.ok) {
    success.textContent = `Saved. ${res.body.zoneCount} zone${res.body.zoneCount === 1 ? '' : 's'} loaded from ${res.body.event ? `the event ${res.body.event}` : 'the game file'}.`;
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
    'invalid-event': 'The questions of that event have problems, so nothing was saved:',
    ...EVENT_PROBLEM,
    'game-active': 'The game is in progress, so it cannot be changed.',
    network: 'Could not save. Check the connection and try again.',
  }[code] ?? 'Something went wrong. Please try again.';
  error.hidden = false;
  if (res.body?.problems) {
    problems.replaceChildren(...res.body.problems.map((p) => el('li', {}, p)));
    problems.hidden = false;
  }
});

$('publish-confirm').addEventListener('change', renderPublish);
$('publish-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const error = $('publish-error');
  error.hidden = true;
  $('publish-button').disabled = true;
  const res = await postJson('/api/admin/results/publish', { confirm: $('publish-confirm').checked });
  if (!res.ok) {
    const code = res.status === 0 ? 'network' : (res.body?.error ?? 'unknown');
    error.dataset.error = code;
    error.textContent = { 'game-not-over': 'The game is not over yet.', 'confirmation-required': 'Tick the box to confirm every score has been applied.', network: 'Could not publish. Check the connection and try again.' }[code] ?? 'Something went wrong. Please try again.';
    error.hidden = false;
  }
  await refresh();
});
$('unpublish-button').addEventListener('click', async () => {
  $('unpublish-button').disabled = true;
  await postJson('/api/admin/results/unpublish', {});
  $('unpublish-button').disabled = false;
  await refresh();
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

guardAdminPage({
  start: () => { // the admin is allowed in: load the page and keep it fresh
    refresh();
    setInterval(refresh, refreshInterval());
    document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });
  },
  refresh,
});
