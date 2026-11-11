// The /game-events/ admin page: the events stored in the private bucket (list, download, delete) and uploading one: the
// chosen folder is checked, the maps are made smaller in this browser, and everything goes through the admin API one piece
// at a time (the questions first, which the server checks before storing anything). Behind the admin passcode
// (web/js/admin-auth.js). Everything from the server or the files is put on the page as text, never markup.
import { getJson, putJson, deleteJson } from './api.js';
import { $, el, refreshInterval } from './dom.js';
import { guardAdminPage, isLocked } from './admin-auth.js';
import { renderAdminNav } from './admin-nav.js';

import { wireHelp } from './help.js';
import { planUpload, suggestName } from './event-files.js';
import { shrinkImage } from './image-shrink.js';

const EVENT_NAME = /^[a-z0-9][a-z0-9-]{0,39}$/;
const THUMB = { width: 320, quality: 0.75 }; // thumbnail for the zone tile, picture for the full-size view
const FULL = { width: 1400, quality: 0.8 };

let chosen = []; // the files the admin picked
let confirming = null; // the event whose deletion awaits a confirmation
let shown = null; // what the list shows now (it is only rebuilt when this changes)
let busy = false; // an upload is running: the list is left alone

wireHelp(); // the ? buttons beside the fields
const form = $('upload-form');
const nameInput = $('event-name');

function setChosen(files) {
  chosen = [...files];
  if (!nameInput.value.trim()) nameInput.value = suggestName(chosen);
}
$('event-folder').addEventListener('change', (e) => setChosen(e.target.files));
$('event-files').addEventListener('change', (e) => setChosen(e.target.files));

// ------------------------------------------------------------------ the list
function describe(event) {
  const parts = [];
  if (event.gameName) parts.push(event.gameName);
  if (event.day) parts.push(event.day);
  parts.push(`${event.zoneCount} zone${event.zoneCount === 1 ? '' : 's'}, ${event.questionCount} question${event.questionCount === 1 ? '' : 's'}`);
  parts.push(event.hasInstructions ? 'with instructions' : 'no instructions');
  return parts.join(' · ');
}

function renderList({ events, active }) {
  const key = JSON.stringify([events, active, confirming]);
  if (key === shown) return;
  shown = key;
  $('no-events').hidden = events.length > 0;
  $('events-list').replaceChildren(...events.map((event) => {
    const item = el('li', { class: 'list-group-item', 'data-testid': 'event', 'data-event': event.name, 'data-state': event.complete ? 'complete' : 'incomplete', 'data-active': String(active === event.name) });
    const top = el('div', { class: 'd-flex flex-wrap align-items-center gap-2' });
    top.append(el('strong', { 'data-testid': 'event-title' }, event.name));
    if (active === event.name) top.append(el('span', { class: 'badge text-bg-success', 'data-testid': 'event-active' }, 'Active'));
    top.append(el('span', { class: `badge text-bg-${event.complete ? 'secondary' : 'warning'}`, 'data-testid': 'event-status' }, event.complete ? 'Ready' : 'Incomplete'));
    item.append(top, el('div', { class: 'small text-muted team-name', 'data-testid': 'event-detail' }, describe(event)));
    if (!event.complete) {
      const what = [...event.problems.slice(0, 3), ...(event.missingMaps.length ? [`maps missing: ${event.missingMaps.join(', ')}`] : [])];
      item.append(el('div', { class: 'small text-danger team-name', 'data-testid': 'event-needs' }, what.join(' · ')));
    }
    const actions = el('div', { class: 'd-flex flex-wrap gap-2 mt-2' });
    const replace = el('button', { type: 'button', class: 'btn btn-outline-primary btn-sm', 'data-testid': 'event-replace' }, 'Replace');
    replace.addEventListener('click', () => { nameInput.value = event.name; $('upload-heading').scrollIntoView(); nameInput.focus(); });
    const download = el('a', { class: 'btn btn-outline-secondary btn-sm', href: `/api/admin/events/${encodeURIComponent(event.name)}/download`, 'data-testid': 'event-download' }, 'Download');
    actions.append(replace, download);
    if (confirming === event.name) {
      const yes = el('button', { type: 'button', class: 'btn btn-danger btn-sm', 'data-testid': 'event-delete-yes' }, 'Yes, delete it');
      const no = el('button', { type: 'button', class: 'btn btn-outline-secondary btn-sm', 'data-testid': 'event-delete-no' }, 'No');
      yes.addEventListener('click', async () => {
        confirming = null;
        const res = await deleteJson(`/api/admin/events/${encodeURIComponent(event.name)}`);
        const message = $('upload-result');
        message.hidden = false;
        message.dataset.state = res.ok ? 'ok' : 'error';
        message.dataset.error = res.ok ? '' : (res.body?.error ?? 'unknown');
        message.textContent = res.ok ? `Deleted ${event.name}.` : res.body?.error === 'event-active' ? `${event.name} is the live game's event, so it cannot be deleted.` : 'Could not delete it. Please try again.';
        shown = null;
        await refresh();
      });
      no.addEventListener('click', () => { confirming = null; refresh(); });
      actions.append(el('span', { class: 'small align-self-center' }, 'Delete this event and its files?'), yes, no);
    } else if (active !== event.name) { // the event the live game was loaded from cannot be deleted
      const del = el('button', { type: 'button', class: 'btn btn-outline-danger btn-sm', 'data-testid': 'event-delete' }, 'Delete');
      del.addEventListener('click', () => { confirming = event.name; refresh(); });
      actions.append(del);
    }
    item.append(actions);
    return item;
  }));
}

async function refresh() {
  if (isLocked() || busy) return;
  const res = await getJson('/api/admin/events');
  $('load-error').hidden = res.ok;
  if (!res.ok) return;
  $('unavailable-notice').hidden = res.body.available;
  renderList(res.body);
}

// ------------------------------------------------------------------ uploading
const steps = $('upload-progress');
function step(text) {
  const item = el('li', { 'data-testid': 'upload-step', 'data-state': 'running' }, text);
  steps.append(item);
  return {
    done: (extra = '') => { item.dataset.state = 'done'; item.textContent = `${text}${extra}`; },
    fail: (note) => { item.dataset.state = 'failed'; item.textContent = `${text}: ${note}`; },
  };
}
function finish(ok, text, problems = [], code = '') {
  const result = $('upload-result');
  result.hidden = false;
  result.dataset.state = ok ? 'ok' : 'error';
  result.dataset.error = code;
  result.className = `mt-2 mb-0 ${ok ? 'text-success' : 'text-danger'}`;
  result.textContent = text;
  const list = $('upload-problems');
  list.replaceChildren(...problems.map((p) => el('li', {}, p)));
  list.hidden = problems.length === 0;
}
const readText = (file) => file.text();

async function upload() {
  steps.replaceChildren();
  finish(true, '');
  $('upload-result').hidden = true;
  const name = nameInput.value.trim();
  if (!EVENT_NAME.test(name)) return finish(false, 'Give the event a name: lower case letters, digits and hyphens, up to 40 characters.', [], 'invalid-event-name');
  if (chosen.length === 0) return finish(false, 'Choose the event folder (or its files) first.', [], 'nothing-chosen');

  let game;
  const probe = planUpload(chosen, null);
  if (!probe.questions) return finish(false, 'The folder has no game-questions.json.', [], 'no-questions');
  try { game = JSON.parse(await readText(probe.questions)); } catch { return finish(false, 'game-questions.json is not valid JSON.', [], 'bad-json'); }
  const plan = planUpload(chosen, game);
  if (plan.missingMaps.length) return finish(false, 'Some map images named in the game file were not chosen:', plan.missingMaps, 'maps-missing'); // nothing has been uploaded yet

  busy = true;
  $('upload-button').disabled = true;
  const base = `/api/admin/events/${encodeURIComponent(name)}`;
  try {
    let s = step('Questions');
    let res = await putJson(`${base}/questions`, game);
    if (!res.ok) { s.fail(res.body?.error ?? 'network'); return finish(false, 'The questions were not accepted, so nothing else was uploaded:', res.body?.problems ?? [], res.body?.error ?? 'network'); }
    s.done();

    if (plan.instructions) {
      s = step('Instructions');
      res = await putJson(`${base}/instructions`, { text: await readText(plan.instructions) });
      if (!res.ok) { s.fail(res.body?.error ?? 'network'); return finish(false, 'The instructions were not accepted.', [], res.body?.error ?? 'network'); }
      s.done();
    }
    for (const zone of plan.zones) {
      s = step(`Map for ${zone.key}`);
      let body;
      try {
        body = { thumb: await shrinkImage(zone.file, THUMB), full: await shrinkImage(zone.file, FULL) };
      } catch {
        s.fail('this image could not be read');
        return finish(false, `The map image ${zone.mapName} could not be read as a picture. The event is incomplete until its maps are uploaded.`, [], 'unreadable-image');
      }
      res = await putJson(`${base}/maps/${zone.mapId}`, body);
      if (!res.ok) { s.fail(res.body?.error ?? 'network'); return finish(false, `The map for ${zone.key} was not accepted. The event is incomplete until its maps are uploaded.`, [], res.body?.error ?? 'network'); }
      s.done();
    }
    if (plan.config) {
      s = step('Settings');
      let values = null;
      try { values = JSON.parse(await readText(plan.config)); } catch { /* reported below */ }
      res = values ? await putJson(`${base}/config`, values) : { ok: false, body: { error: 'bad-json' } };
      if (!res.ok) s.fail(res.body?.error === 'invalid-config' ? `check ${(res.body.fields ?? []).join(', ')}` : (res.body?.error ?? 'network'));
      else s.done();
    }
    finish(true, `Uploaded ${name}.`);
    chosen = [];
    $('event-folder').value = '';
    $('event-files').value = '';
  } finally {
    busy = false;
    $('upload-button').disabled = false;
    shown = null;
    await refresh();
  }
}
form.addEventListener('submit', (event) => { event.preventDefault(); upload(); });

renderAdminNav();
guardAdminPage({
  start: () => {
    refresh();
    setInterval(refresh, refreshInterval());
    document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });
  },
  refresh,
});
