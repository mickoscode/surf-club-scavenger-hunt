// Wording and symbols for the results page. Pure, so they are tested in Node (tests/unit/frontend.test.js).
import { formatScore } from './format.js';

// 1st, 2nd, 3rd, 4th ... 11th, 12th, 13th, 21st, 22nd ...
export function ordinal(n) {
  const lastTwo = n % 100;
  if (lastTwo >= 11 && lastTwo <= 13) return `${n}th`;
  return `${n}${{ 1: 'st', 2: 'nd', 3: 'rd' }[n % 10] ?? 'th'}`;
}

const MEDALS = {
  1: { symbol: '\u{1F947}', label: 'Gold medal' },
  2: { symbol: '\u{1F948}', label: 'Silver medal' },
  3: { symbol: '\u{1F949}', label: 'Bronze medal' },
};

// A gold, silver or bronze medal for 1st, 2nd and 3rd place (teams that tie share the place and its medal); nothing after that.
export const medalFor = (place) => MEDALS[place] ?? null;

// "You finished 3rd of 12"
export const placeHeading = (place, teamCount) => `You finished ${ordinal(place)} of ${teamCount}`;

// All the accepted answers, e.g. "bike or bicycle".
export const joinAnswers = (answers) => answers.join(' or ');

// 'correct', 'wrong' or 'unanswered' for one question of the results.
export const outcomeOf = (question) => (!question.answered ? 'unanswered' : question.correct ? 'correct' : 'wrong');

// "10 of 20 points": what a question or photo challenge earned, in the one place it is said.
export const pointsText = (earned, points) => `${formatScore(earned)} of ${formatScore(points)} points`;

// The icon and colour of a photo challenge, like the tick and cross of a question: a green tick for Full, an orange tick for Half, a red
// cross for Zero, for a photo never scored (0% until it is) and for no photo sent. { tone, icon, text }.
export function photoMark(photo) {
  if (!photo.submitted) return { tone: 'none', icon: 'cross', text: 'No photo submitted' };
  if (!photo.scored) return { tone: 'none', icon: 'cross', text: 'Not scored yet' };
  if (photo.decision === 'full') return { tone: 'full', icon: 'tick', text: 'Full' };
  if (photo.decision === 'half') return { tone: 'half', icon: 'tick', text: 'Half' };
  return { tone: 'none', icon: 'cross', text: 'Zero' };
}

// 'not-submitted', 'not-scored' (sent, 0% until scored) or 'scored'.
export const photoState = (photo) => (!photo.submitted ? 'not-submitted' : !photo.scored ? 'not-scored' : 'scored');
