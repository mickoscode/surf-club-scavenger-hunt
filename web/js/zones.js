// The zones on /play/: tiles (map thumbnail, name, progress), a panel per zone with its map, one form per question and
// the photo challenges (questions of type photo: none, one or several), and a full-size map view. Everything a player types or sees is text set with textContent.
//
// Each question and photo can be submitted ONCE. A form is marked done only when the server has confirmed it, and from
// then on it shows "Done" and nothing else: never what was submitted, and never whether it was right.
import { postJson } from './api.js';
import { el } from './dom.js';
import { sanitizeAnswer } from './answer-input.js';
import { applyWhatsAppLinks, safeWhatsAppUrl } from './whatsapp.js';

const MESSAGES = {
  'invalid-answer': 'Please enter an answer in the right format.',
  'not-playing': 'The game has ended, so answers are closed.',
  network: 'Could not send. Check your connection and try again.',
};
const GENERIC_ERROR = 'Something went wrong. Please try again.';

// Each zone of an event has its map addresses (copied to the site under /event-maps/ when the event is made live).
const mapThumb = (zone) => zone.map.thumb;
const mapFull = (zone) => zone.map.full;
const answerKey = (zone, question) => `${zone.key}#${question.id}`; // a question's (or photo challenge's) key in /api/me's done lists

export function createZones({ container, onSubmitted }) {
  let zones = [];
  let renderedKey = null;
  const tiles = new Map(); // zone key -> tile element
  const panels = new Map(); // zone key -> panel element
  const done = { answers: new Set(), photos: new Set() };
  let whatsappUrl = null; // the group's invite link, once the server has given it to this team

  // ------------------------------------------------------------------ full-size map
  const overlay = el('div', { class: 'map-overlay', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Zone map', 'data-testid': 'map-overlay' });
  const overlayImage = el('img', { alt: 'Zone map, full size', 'data-testid': 'map-full' });
  const closeButton = el('button', { type: 'button', class: 'btn btn-light close', 'data-testid': 'map-close' }, 'Close');
  overlay.append(closeButton, overlayImage);
  overlay.hidden = true;
  let opener = null;

  function openMap(zone, from) {
    opener = from;
    overlayImage.src = mapFull(zone);
    overlay.hidden = false;
    closeButton.focus();
  }
  function closeMap() {
    overlay.hidden = true;
    overlayImage.removeAttribute('src');
    opener?.focus();
  }
  closeButton.addEventListener('click', closeMap);
  document.addEventListener('keydown', (event) => { if (event.key === 'Escape' && !overlay.hidden) closeMap(); });

  // ------------------------------------------------------------------ progress and done markers
  // Photo challenges are questions of type "photo" (a zone may have none, one or several), so they are counted with the rest.
  const isPhoto = (q) => q.type === 'photo';
  const isDone = (zone, q) => (isPhoto(q) ? done.photos : done.answers).has(answerKey(zone, q));
  const totalFor = (zone) => zone.questions.length;
  const doneFor = (zone) => zone.questions.filter((q) => isDone(zone, q)).length;

  function updateProgress(zone) {
    const [n, total] = [doneFor(zone), totalFor(zone)];
    const tile = tiles.get(zone.key);
    tile.dataset.done = String(n);
    tile.dataset.total = String(total);
    tile.querySelector('[data-testid="zone-progress"]').textContent = `${n}/${total} done`;
    const panel = panels.get(zone.key);
    panel.querySelector('[data-testid="panel-progress"]').textContent = `${n}/${total} done`;
  }

  function markDone(form, zone) {
    form.dataset.state = 'done';
    for (const control of form.querySelectorAll('input, button')) control.disabled = true;
    const input = form.querySelector('input');
    if (input) input.value = ''; // the submitted answer is not kept on the page
    form.querySelector('[data-testid="done-badge"]').hidden = false;
    form.querySelector('[data-testid="form-error"]').hidden = true;
    updateProgress(zone);
  }

  function applyDone(summary) {
    done.answers = new Set(summary.answers);
    done.photos = new Set(summary.photos);
    for (const zone of zones) {
      const panel = panels.get(zone.key);
      for (const q of zone.questions) {
        if (isDone(zone, q)) markDone(panel.querySelector(`[data-testid="${isPhoto(q) ? 'photo' : 'question'}"][data-question="${q.id}"]`), zone);
      }
      updateProgress(zone);
    }
  }

  // ------------------------------------------------------------------ submitting
  // kind is "answers" or "photos"; key is what /api/me lists as done for it.
  async function submit({ form, zone, path, data, kind, key }) {
    const error = form.querySelector('[data-testid="form-error"]');
    const button = form.querySelector('button[type="submit"]');
    button.disabled = true;
    error.hidden = true;
    const res = await postJson(path, data);
    if (res.ok || res.body?.error === 'already-submitted') { // already done (e.g. on another tab): same outcome
      done[kind].add(key);
      markDone(form, zone);
      onSubmitted();
      return;
    }
    if (res.body?.error === 'no-session') return location.replace('/view/');
    const code = res.status === 0 ? 'network' : (res.body?.error ?? 'unknown');
    error.dataset.error = code;
    error.textContent = MESSAGES[code] ?? GENERIC_ERROR;
    error.hidden = false;
    button.disabled = false;
  }

  // ------------------------------------------------------------------ building the page
  function buildQuestion(zone, q) {
    const form = el('form', { class: 'card card-body mb-3', novalidate: '', 'data-testid': 'question', 'data-question': q.id, 'data-state': 'open' });
    const inputId = `a-${zone.mapId}-${q.id}`;
    const input = el('input', {
      id: inputId, name: 'answer', type: 'text', maxlength: '200', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false',
      class: 'form-control form-control-lg mt-2', 'data-testid': 'answer-input', 'data-type': q.type,
      ...(q.type === 'whole-number' ? { inputmode: 'numeric' } : q.type === 'decimal' ? { inputmode: 'decimal' } : {}),
    });
    input.addEventListener('input', () => {
      const clean = sanitizeAnswer(q.type, input.value);
      if (clean !== input.value) input.value = clean; // numbers: only digits (and one point for decimals)
    });
    const submitButton = el('button', { type: 'submit', class: 'btn btn-primary mt-2', 'data-testid': 'answer-submit' }, 'Submit');
    const badge = el('span', { class: 'badge text-bg-success fs-6 mt-2', 'data-testid': 'done-badge' }, 'Done');
    badge.hidden = true;
    const error = el('p', { class: 'text-danger mt-2 mb-0', role: 'alert', 'data-testid': 'form-error' });
    error.hidden = true;
    const heading = el('div', { class: 'd-flex justify-content-between gap-2' });
    heading.append(el('label', { for: inputId, class: 'fw-semibold' }, q.text), el('span', { class: 'text-muted small text-nowrap' }, `${q.score} pts`));
    const actions = el('div', { class: 'd-flex align-items-center gap-2' });
    actions.append(submitButton, badge);
    form.append(heading, input, actions, error);

    form.addEventListener('submit', (event) => {
      event.preventDefault();
      submit({
        form, zone, path: '/api/answer', kind: 'answers', key: answerKey(zone, q),
        data: { zone: zone.key, question: q.id, answer: input.value },
      });
    });
    return form;
  }

  function buildPhoto(zone, photo, index) {
    const form = el('form', { class: 'card card-body mb-3 border-primary', novalidate: '', 'data-testid': 'photo', 'data-question': photo.id, 'data-state': 'open' });
    const submitButton = el('button', { type: 'submit', class: 'btn btn-primary', 'data-testid': 'photo-submit' }, 'Photo sent to WhatsApp');
    const badge = el('span', { class: 'badge text-bg-success fs-6', 'data-testid': 'done-badge' }, 'Done');
    badge.hidden = true;
    const error = el('p', { class: 'text-danger mt-2 mb-0', role: 'alert', 'data-testid': 'form-error' });
    error.hidden = true;
    const actions = el('div', { class: 'd-flex align-items-center gap-2' });
    actions.append(submitButton, badge);
    // Shown only when the admin has set a WhatsApp group link (see setWhatsApp). The submit button below is unchanged: it records
    // the submission, and is not a link.
    const openGroup = el('a', { class: 'btn btn-outline-success btn-sm mb-2 align-self-start', target: '_blank', rel: 'noopener noreferrer', 'data-testid': 'whatsapp-open' }, 'Open WhatsApp group');
    openGroup.hidden = true;
    form.append(
      el('div', { class: 'fw-semibold' }, `Photo challenge${zone.questions.filter(isPhoto).length > 1 ? ` ${index + 1}` : ''} (${photo.score} pts)`),
      el('p', { class: 'my-2', 'data-testid': 'photo-challenge' }, photo.text),
      openGroup, actions, error,
    );
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      submit({ form, zone, path: '/api/photo', kind: 'photos', key: answerKey(zone, photo), data: { zone: zone.key, question: photo.id } });
    });
    return form;
  }

  function buildTile(zone) {
    const tile = el('button', { type: 'button', class: 'card h-100 w-100 text-start p-0 zone-tile', 'data-testid': 'zone-tile', 'data-zone': zone.key });
    tile.append(el('img', { src: mapThumb(zone), alt: `Map of ${zone.name}`, class: 'card-img-top', loading: 'lazy' }));
    const body = el('div', { class: 'card-body p-2' });
    body.append(el('div', { class: 'fw-semibold team-name', 'data-testid': 'zone-name' }, zone.name), el('div', { class: 'small text-muted', 'data-testid': 'zone-progress' }));
    tile.append(body);
    tile.addEventListener('click', () => { location.hash = zone.mapId; });
    return tile;
  }

  function buildPanel(zone) {
    const panel = el('section', { 'data-testid': 'zone-panel', 'data-zone': zone.key });
    panel.hidden = true;
    const back = el('button', { type: 'button', class: 'btn btn-outline-primary btn-sm', 'data-testid': 'zone-back' }, '‹ All zones');
    back.addEventListener('click', () => { location.hash = ''; });

    const mapButton = el('button', { type: 'button', class: 'map-button p-0 border-0 bg-transparent w-100', 'data-testid': 'map-open' });
    mapButton.append(el('img', { src: mapThumb(zone), alt: `Map of ${zone.name}. Tap to enlarge.`, class: 'rounded border' }));
    mapButton.addEventListener('click', () => openMap(zone, mapButton));

    const header = el('div', { class: 'd-flex justify-content-between align-items-center mb-2' });
    header.append(back, el('span', { class: 'text-muted small', 'data-testid': 'panel-progress' }));
    panel.append(
      header,
      el('h2', { class: 'h4 team-name', 'data-testid': 'panel-name' }, zone.name),
      mapButton,
      el('p', { class: 'small text-muted mt-1 mb-3' }, 'Tap the map to enlarge it.'),
      ...zone.questions.map((q) => (isPhoto(q) ? buildPhoto(zone, q, zone.questions.filter(isPhoto).indexOf(q)) : buildQuestion(zone, q))),
    );
    return panel;
  }

  // Shows one zone's panel, or the tiles. The address (#zone-1) says which, so the browser's Back button and a reload work.
  function showFromHash() {
    const wanted = zones.find((z) => z.mapId === location.hash.slice(1));
    for (const [key, panel] of panels) panel.hidden = !(wanted && wanted.key === key);
    tilesView.hidden = Boolean(wanted);
    if (!wanted && !overlay.hidden) closeMap();
    if (wanted) window.scrollTo(0, 0);
  }
  const tilesView = el('div', { class: 'row row-cols-2 g-3', 'data-testid': 'zone-tiles' });
  window.addEventListener('hashchange', showFromHash);

  // The group link (or null): shows the Open WhatsApp group buttons and links the mentions of WhatsApp in the photo challenges.
  function setWhatsApp(url) {
    whatsappUrl = safeWhatsAppUrl(url);
    for (const panel of panels.values()) {
      for (const open of panel.querySelectorAll('[data-testid="whatsapp-open"]')) {
        open.hidden = !whatsappUrl;
        if (whatsappUrl) open.href = whatsappUrl;
        else open.removeAttribute('href');
      }
      for (const challenge of panel.querySelectorAll('[data-testid="photo-challenge"]')) applyWhatsAppLinks(challenge, whatsappUrl);
    }
  }

  return {
    setWhatsApp,
    // Builds the zones when they change (and only then, so typing is never wiped by a refresh).
    render(next) {
      const key = JSON.stringify(next);
      if (key === renderedKey) return;
      renderedKey = key;
      zones = next;
      tiles.clear();
      panels.clear();
      tilesView.replaceChildren();
      const panelNodes = [];
      for (const zone of zones) {
        const tile = buildTile(zone);
        tiles.set(zone.key, tile);
        const col = el('div', { class: 'col' });
        col.append(tile);
        tilesView.append(col);
        const panel = buildPanel(zone);
        panels.set(zone.key, panel);
        panelNodes.push(panel);
      }
      container.replaceChildren(tilesView, ...panelNodes, overlay);
      for (const zone of zones) updateProgress(zone);
      applyDone({ answers: [...done.answers], photos: [...done.photos] });
      setWhatsApp(whatsappUrl); // the zones were just rebuilt: put the link back
      showFromHash();
    },
    applyDone,
  };
}
