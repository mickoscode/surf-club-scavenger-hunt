// The /game-score/ admin page: the photo challenges teams say they sent to WhatsApp, to be scored by hand.
// Not yet scored first, in the order sent; scored ones after. Choosing a score and pressing Apply records it; applying
// again replaces the previous decision (the server never counts a photo twice). There is no login (docs/requirements.md).
import { getJson, postJson } from './api.js';
import { $, el, refreshInterval } from './dom.js';
import { formatScore } from './format.js';

const DECISIONS = ['full', 'half', 'zero'];
const LABEL = { full: 'Full', half: 'Half', zero: 'Zero' };
const FRACTION = { full: 1, half: 0.5, zero: 0 };

const rows = new Map(); // "team|zone" -> list item. Kept between refreshes so what the admin has chosen is never lost.
let canScore = false;

const selected = (row) => row.querySelector('input[type="radio"]:checked')?.value ?? null;

// Apply is only possible when scoring is open and a choice differs from what is already recorded.
function updateApply(row) {
  const choice = selected(row);
  row.querySelector('[data-testid="apply"]').disabled = !canScore || choice === null || choice === row.dataset.decision;
}

function buildRow(photo) {
  const key = `${photo.teamNumber}|${photo.zone}`;
  const row = el('li', { class: 'list-group-item', 'data-testid': 'photo-row', 'data-team-number': String(photo.teamNumber), 'data-zone': photo.zone, 'data-state': 'pending', 'data-decision': '' });
  const form = el('form', { class: 'd-flex flex-wrap align-items-center gap-2', novalidate: '' });
  // The team is identified to the server by this hidden field, never by anything the admin types.
  form.append(
    el('input', { type: 'hidden', name: 'teamNumber', value: String(photo.teamNumber), 'data-testid': 'team-field' }),
    el('input', { type: 'hidden', name: 'zone', value: photo.zone, 'data-testid': 'zone-field' }),
    el('strong', { 'data-testid': 'row-team' }, `Team ${photo.teamNumber}`),
    el('span', { class: 'flex-grow-1 team-name', 'data-testid': 'row-zone' }, photo.zoneName),
  );
  const choices = el('div', { class: 'btn-group', role: 'group', 'aria-label': 'Score' });
  for (const decision of DECISIONS) {
    const id = `d-${photo.teamNumber}-${photo.zone.replace(/\W/g, '-')}-${decision}`;
    const radio = el('input', { type: 'radio', class: 'btn-check', name: `decision-${key}`, id, value: decision, 'data-testid': `decision-${decision}` });
    radio.addEventListener('change', () => updateApply(row));
    choices.append(radio, el('label', { class: 'btn btn-outline-primary btn-sm', for: id }, `${LABEL[decision]} (${formatScore(photo.photoScore * FRACTION[decision])})`));
  }
  const apply = el('button', { type: 'submit', class: 'btn btn-primary btn-sm', 'data-testid': 'apply', disabled: '' }, 'Apply');
  const badge = el('span', { class: 'badge text-bg-success', 'data-testid': 'applied-badge' });
  badge.hidden = true;
  form.append(choices, apply, badge);
  row.append(form);

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const decision = selected(row);
    if (!decision) return;
    apply.disabled = true;
    const error = $('apply-error');
    error.hidden = true;
    const res = await postJson('/api/admin/photos/apply', { teamNumber: photo.teamNumber, zone: photo.zone, decision });
    if (!res.ok) {
      const code = res.status === 0 ? 'network' : (res.body?.error ?? 'unknown');
      error.dataset.error = code;
      error.textContent = code === 'not-scoring' ? 'Scoring opens when the game starts.' : 'That score was not recorded. Please try again.';
      error.hidden = false;
      updateApply(row);
      return;
    }
    await refresh();
  });
  return row;
}

// Brings an existing row up to date with the server, keeping a choice the admin has made but not applied.
function updateRow(row, photo) {
  const recorded = photo.decision ?? '';
  if (row.dataset.decision !== recorded) { // changed on the server (applied here, or from another tab)
    row.dataset.decision = recorded;
    row.dataset.state = recorded ? 'applied' : 'pending';
    for (const radio of row.querySelectorAll('input[type="radio"]')) radio.checked = radio.value === recorded;
    const badge = row.querySelector('[data-testid="applied-badge"]');
    badge.hidden = !recorded;
    badge.textContent = recorded ? `Applied: ${LABEL[recorded]}` : '';
  }
  updateApply(row);
}

async function refresh() {
  const [info, list] = await Promise.all([getJson('/api/admin/config'), getJson('/api/admin/photos')]);
  $('load-error').hidden = info.ok && list.ok;
  if (!info.ok || !list.ok) return;
  canScore = ['active', 'post'].includes(info.body.status);
  const notice = $('scoring-notice');
  notice.hidden = canScore;
  notice.dataset.status = info.body.status;

  const photos = list.body.photos;
  const keys = new Set(photos.map((p) => `${p.teamNumber}|${p.zone}`));
  for (const [key, row] of rows) if (!keys.has(key)) { row.remove(); rows.delete(key); } // e.g. the team was removed
  for (const photo of photos) { // appending moves an existing row, so the server's order is shown without rebuilding
    const key = `${photo.teamNumber}|${photo.zone}`;
    if (!rows.has(key)) rows.set(key, buildRow(photo));
    const row = rows.get(key);
    updateRow(row, photo);
    $('photo-list').append(row);
  }
  $('no-photos').hidden = photos.length > 0;
}

refresh();
setInterval(refresh, refreshInterval());
document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });
