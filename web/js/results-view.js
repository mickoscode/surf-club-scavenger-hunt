// A team's results: the heading with its place (and medal), the total, and a card for every question and photo challenge with
// the official answers. Shared by the player's /results/ page and the admin's view of a team (/game-teams/), so the admin sees
// exactly what the player will see. Everything from the server is put on the page as text.
import { el } from './dom.js';
import { formatScore } from './format.js';
import { medalFor, placeHeading, joinAnswers, outcomeOf, photoState, photoMark, pointsText } from './results-format.js';

const OUTCOME = {
  correct: { icon: '✓', text: 'Correct', classes: 'text-success' },
  wrong: { icon: '✗', text: 'Wrong', classes: 'text-danger' },
  unanswered: { icon: '–', text: 'Not answered', classes: 'text-muted' },
};

const PHOTO_TONE = { full: 'text-success', half: 'text-orange', none: 'text-danger' };
const GLYPH = { tick: '✓', cross: '✗' };

// The one line that ends every card: the icon and what happened, then the points ("✓ Correct 10 of 10 points"). The icon and the words
// say it, never colour alone; the points are in purple (a colour used for nothing else), and wrap below on a very narrow screen.
function statusLine(mark, pointsTestId, earned, points) {
  const line = el('div', { class: 'd-flex flex-wrap align-items-baseline column-gap-3', 'data-testid': 'result-status' });
  line.append(mark, el('div', { class: 'points-earned', 'data-testid': pointsTestId }, pointsText(earned, points)));
  return line;
}

function questionCard(question) {
  const outcome = outcomeOf(question);
  const card = el('div', { class: 'list-group-item', 'data-testid': 'result-question', 'data-question': question.id, 'data-outcome': outcome, 'data-earned': String(question.earned), 'data-points': String(question.points) });
  const mark = el('div', { class: `fw-semibold text-nowrap ${OUTCOME[outcome].classes}`, 'data-testid': 'outcome' });
  mark.append(el('span', { 'aria-hidden': 'true' }, `${OUTCOME[outcome].icon} `), document.createTextNode(OUTCOME[outcome].text));
  card.append(el('div', { class: 'fw-semibold team-name' }, question.text));
  // The answers share a line (it wraps on a narrow screen). Someone else's results (from the scoreboard) come without any answers:
  // only what a team's own results carry is shown.
  const answers = el('div', { class: 'd-flex flex-wrap column-gap-3' });
  if (question.answered && 'yourAnswer' in question) answers.append(el('div', { class: 'team-name', 'data-testid': 'your-answer' }, `Your answer: ${question.yourAnswer}`));
  if (question.officialAnswers) answers.append(el('div', { class: 'small text-muted team-name', 'data-testid': 'official-answer' }, `Official answer: ${joinAnswers(question.officialAnswers)}`));
  if (answers.children.length) card.append(answers);
  card.append(statusLine(mark, 'question-points', question.earned, question.points));
  return card;
}

function photoCard(photo) {
  const state = photoState(photo);
  const card = el('div', { class: 'list-group-item', 'data-testid': 'result-photo', 'data-state': state, 'data-percent': photo.percent === null ? '' : String(photo.percent) });
  const { tone, icon, text } = photoMark(photo);
  const mark = el('div', { class: `fw-semibold ${PHOTO_TONE[tone]}`, 'data-testid': 'photo-mark', 'data-tone': tone, 'data-icon': icon });
  mark.append(el('span', { 'aria-hidden': 'true', class: tone === 'half' ? 'icon-orange' : '' }, `${GLYPH[icon]} `), document.createTextNode(text));
  card.append(el('div', { class: 'fw-semibold' }, 'Photo challenge'), el('div', { class: 'small text-muted team-name' }, photo.challenge), statusLine(mark, 'photo-result', photo.earned, photo.points));
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
