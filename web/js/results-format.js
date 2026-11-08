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

const PHOTO_LABEL = { full: 'Full', half: 'Half', zero: 'Zero' };

// How a photo challenge is described: { state: 'not-submitted' | 'not-scored' | 'scored', text }.
export function describePhoto(photo) {
  const of = `${formatScore(photo.earned)} of ${formatScore(photo.points)} points`;
  if (!photo.submitted) return { state: 'not-submitted', text: 'No photo submitted' };
  if (!photo.scored) return { state: 'not-scored', text: `Photo sent, but not scored: 0% - ${of}` };
  return { state: 'scored', text: `${PHOTO_LABEL[photo.decision]}: ${photo.percent}% - ${of}` };
}
