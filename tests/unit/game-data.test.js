// The validator guards the content-edit workflow (admin edits docs/game-questions.json in a PR), so these
// tests use their own fixture, never the real file or its wording.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { validateGameData } = require('../../scripts/validate-game-data.js');

const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'game-data-'));
fs.writeFileSync(path.join(rootDir, 'map.png'), '');
test.after(() => fs.rmSync(rootDir, { recursive: true, force: true }));

const question = (n, over = {}) => ({ [`Q${n}`]: 'a question', type: 'string', answer: 'yes', score: 10, ...over });
const photo = (n, over = {}) => ({ [`Q${n}`]: 'a photo challenge', type: 'photo', score: 30, ...over });
const zone = (name, over = {}) => ({
  'zone-name': name,
  'zone-map': 'map.png',
  questions: [question(1), photo(2)],
  ...over,
});
const valid = () => ({ 'zone 1': zone('One'), 'zone 2': zone('Two') });
const problemsFor = (mutate) => {
  const data = valid();
  mutate(data);
  return validateGameData(data, { rootDir });
};

test('a valid file has no problems', () => {
  assert.deepEqual(validateGameData(valid(), { rootDir }), []);
});

test('any number of zones and questions is fine, with every answer type and alternate answers', () => {
  const data = { 'zone 1': zone('Only', { questions: [
    question(1), question(2, { answer: ['a', 'b'] }),
    question(3, { type: 'whole-number', answer: '42' }), question(4, { type: 'decimal', answer: '2.5' }),
    question(5, { score: 0 }), question(6), question(7), question(8),
  ] }) };
  assert.deepEqual(validateGameData(data, { rootDir }), []);
});

test('structural mistakes are reported', () => {
  const broken = {
    'not an object': (d) => { d['zone 1'] = 'x'; },
    'bad zone key': (d) => { d.north = d['zone 1']; delete d['zone 1']; },
    'duplicate zone name': (d) => { d['zone 2']['zone-name'] = ' ONE '; },
    'missing zone map file': (d) => { d['zone 1']['zone-map'] = 'nope.png'; },
    'map is not an image': (d) => { d['zone 1']['zone-map'] = 'map.gif'; },
    'photo score not a number': (d) => { d['zone 1'].questions[1].score = '30'; },
    'photo with an answer': (d) => { d['zone 1'].questions[1].answer = 'x'; },
    'photo with no description': (d) => { d['zone 1'].questions[1] = { type: 'photo', score: 30 }; },
    'photo id used twice': (d) => { d['zone 1'].questions.push(photo(2)); },
    'the old single photo fields': (d) => { d['zone 1']['photo-challenge'] = 'x'; d['zone 1']['photo-score'] = 5; },
    'the separate photos list': (d) => { d['zone 1'].photos = [{ P1: 'x', score: 5 }]; },
    'negative score': (d) => { d['zone 1'].questions[0].score = -1; },
    'no questions': (d) => { d['zone 1'].questions = []; },
    'duplicate question id': (d) => { d['zone 1'].questions.push(question(1)); },
    'unknown question type': (d) => { d['zone 1'].questions[0].type = 'number'; },
    'unknown field': (d) => { d['zone 1'].questions[0].hint = 'x'; },
    'upper case answer': (d) => { d['zone 1'].questions[0].answer = 'Paris'; },
    'empty alternate list': (d) => { d['zone 1'].questions[0].answer = []; },
    'whole number with a decimal point': (d) => { d['zone 1'].questions[0] = question(1, { type: 'whole-number', answer: '4.5' }); },
    'number answer not written as text': (d) => { d['zone 1'].questions[0] = question(1, { type: 'whole-number', answer: 4 }); },
    'negative decimal': (d) => { d['zone 1'].questions[0] = question(1, { type: 'decimal', answer: '-2.5' }); },
    'alternate list on a numeric question': (d) => { d['zone 1'].questions[0] = question(1, { type: 'whole-number', answer: ['4'] }); },
  };
  for (const [name, mutate] of Object.entries(broken)) {
    assert.ok(problemsFor(mutate).length > 0, `expected a problem for: ${name}`);
  }
});

test('map files are only checked when asked to (the backend has no images)', () => {
  const data = valid();
  data['zone 1']['zone-map'] = 'missing.png';
  assert.ok(validateGameData(data, { rootDir }).length > 0);
  assert.deepEqual(validateGameData(data, { rootDir, checkMaps: false }), []);
});

test('an empty file or a non-object is rejected', () => {
  assert.ok(validateGameData({}, { rootDir }).length > 0);
  assert.ok(validateGameData([], { rootDir }).length > 0);
  assert.ok(validateGameData(null, { rootDir }).length > 0);
});

test('a zone may have no photo challenge, one, or several (a photo challenge is a question of type photo)', () => {
  for (const photos of [[], [photo(2)], [photo(2), photo(3, { score: 0 })]]) {
    const data = valid();
    data['zone 1'].questions = [question(1), ...photos];
    assert.deepEqual(validateGameData(data, { rootDir }), [], `${photos.length} photo challenges`);
  }
  const onlyPhotos = valid();
  onlyPhotos['zone 1'].questions = [photo(1)];
  assert.deepEqual(validateGameData(onlyPhotos, { rootDir }), []); // a zone of only photo challenges is fine
});
