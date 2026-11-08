// The /results/ page. A player sees how they finished and a breakdown of every question and photo, once the admin has
// published the final results. Anybody else (a viewer, a removed team) sees only the link back to the scoreboard, and so
// does a player before the results are published (plus a note). Everything from the server is put on the page as text.
import { getJson } from './api.js';
import { $, el, refreshInterval } from './dom.js';
import { formatScore } from './format.js';
import { medalFor, placeHeading, joinAnswers, outcomeOf, describePhoto } from './results-format.js';

const OUTCOME = {
  correct: { icon: '✓', text: 'Correct', classes: 'text-success' },
  wrong: { icon: '✗', text: 'Wrong', classes: 'text-danger' },
  unanswered: { icon: '–', text: 'Not answered', classes: 'text-muted' },
};

function questionCard(question) {
  const outcome = outcomeOf(question);
  const card = el('div', { class: 'list-group-item', 'data-testid': 'result-question', 'data-question': question.id, 'data-outcome': outcome, 'data-earned': String(question.earned), 'data-points': String(question.points) });
  const head = el('div', { class: 'd-flex justify-content-between gap-2' });
  head.append(
    el('div', { class: 'fw-semibold team-name' }, question.text),
    el('div', { class: 'text-nowrap text-muted small' }, `${formatScore(question.earned)} of ${formatScore(question.points)} points`),
  );
  const mark = el('div', { class: `fw-semibold ${OUTCOME[outcome].classes}`, 'data-testid': 'outcome' });
  mark.append(el('span', { 'aria-hidden': 'true' }, `${OUTCOME[outcome].icon} `), document.createTextNode(OUTCOME[outcome].text)); // an icon and text, never colour alone
  card.append(head, mark);
  if (question.answered) card.append(el('div', { class: 'team-name', 'data-testid': 'your-answer' }, `Your answer: ${question.yourAnswer}`));
  card.append(el('div', { class: 'small text-muted team-name', 'data-testid': 'official-answer' }, `Official answer: ${joinAnswers(question.officialAnswers)}`));
  return card;
}

function photoCard(photo) {
  const { state, text } = describePhoto(photo);
  const card = el('div', { class: 'list-group-item', 'data-testid': 'result-photo', 'data-state': state, 'data-percent': photo.percent === null ? '' : String(photo.percent) });
  card.append(el('div', { class: 'fw-semibold' }, 'Photo challenge'), el('div', { class: 'small text-muted team-name' }, photo.challenge), el('div', { 'data-testid': 'photo-result' }, text));
  return card;
}

function render(data) {
  const { results } = data;
  const heading = $('place-heading');
  heading.dataset.place = String(results.place);
  heading.dataset.teamCount = String(results.teamCount);
  heading.replaceChildren();
  const medal = medalFor(results.place);
  if (medal) {
    const symbol = el('span', { role: 'img', 'aria-label': medal.label, class: 'me-2', 'data-testid': 'medal', 'data-medal': medal.label }, medal.symbol);
    heading.append(symbol);
  }
  heading.append(document.createTextNode(placeHeading(results.place, results.teamCount)));

  const total = $('total');
  total.dataset.total = String(results.total);
  total.textContent = `Total: ${formatScore(results.total)} points`;

  $('result-zones').replaceChildren(...results.zones.map((zone) => {
    const section = el('section', { class: 'mb-4', 'data-testid': 'result-zone', 'data-zone': zone.key });
    const list = el('div', { class: 'list-group' });
    list.append(...zone.questions.map(questionCard), photoCard(zone.photo));
    section.append(el('h2', { class: 'h5 team-name' }, zone.name), list);
    return section;
  }));
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
