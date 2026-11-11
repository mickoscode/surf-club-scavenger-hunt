// A team's results: the heading with its place (and medal), the total, and a card for every question and photo challenge with
// the official answers. Shared by the player's /results/ page and the admin's view of a team (/game-teams/), so the admin sees
// exactly what the player will see. Everything from the server is put on the page as text.
import { el } from './dom.js';
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

// targets: { heading, total, zones } (elements). headingText: the words for the heading when it should not be the player's
// "You finished 3rd of 12" (the admin's view says whose it is).
export function renderResults({ heading, total, zones }, results, headingText = placeHeading(results.place, results.teamCount)) {
  heading.dataset.place = String(results.place);
  heading.dataset.teamCount = String(results.teamCount);
  heading.replaceChildren();
  const medal = medalFor(results.place);
  if (medal) heading.append(el('span', { role: 'img', 'aria-label': medal.label, class: 'me-2', 'data-testid': 'medal', 'data-medal': medal.label }, medal.symbol));
  heading.append(document.createTextNode(headingText));

  total.dataset.total = String(results.total);
  total.textContent = `Total: ${formatScore(results.total)} points`;

  zones.replaceChildren(...results.zones.map((zone) => {
    const section = el('section', { class: 'mb-4', 'data-testid': 'result-zone', 'data-zone': zone.key });
    const list = el('div', { class: 'list-group' });
    list.append(...zone.questions.map(questionCard), ...zone.photos.map(photoCard));
    section.append(el('h2', { class: 'h5 team-name' }, zone.name), list);
    return section;
  }));
}
