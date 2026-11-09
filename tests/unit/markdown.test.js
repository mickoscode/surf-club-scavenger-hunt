// The instructions renderer: what Markdown it understands, and that nothing else is ever markup. parseMarkdown is a pure
// function (the page builds elements from its result with textContent), so it is tested in Node. The real example file in
// docs/ is used only to prove the renderer copes with a realistic file, not for its wording.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const load = () => import(pathToFileURL(path.join(__dirname, '..', '..', 'web', 'js', 'markdown.js')).href);
const plain = (inline) => inline.map((p) => p.text).join('');

test('headings, paragraphs, bullets (nested) and numbered lists', async () => {
  const { parseMarkdown } = await load();
  const blocks = parseMarkdown('# Rules\nFirst line\nsecond line\n\n- one\n  - inside\n- two\n\n1. a\n2. b\n\n## Hints');
  assert.deepEqual(blocks.map((b) => b.type), ['heading', 'paragraph', 'list', 'list', 'heading']);
  assert.equal(blocks[0].level, 1);
  assert.equal(plain(blocks[1].inline), 'First line second line'); // lines of a paragraph join
  const list = blocks[2];
  assert.deepEqual([list.ordered, list.items.map((i) => plain(i.inline))], [false, ['one', 'two']]);
  assert.deepEqual(list.items[0].children[0].items.map((i) => plain(i.inline)), ['inside']);
  assert.equal(blocks[3].ordered, true);
});

test('bold and italic are understood, and everything else is plain text', async () => {
  const { parseInline } = await load();
  assert.deepEqual(parseInline('a **b** and *c* and __d__ and _e_'), [
    { text: 'a ' }, { text: 'b', bold: true }, { text: ' and ' }, { text: 'c', italic: true }, { text: ' and ' }, { text: 'd', bold: true }, { text: ' and ' }, { text: 'e', italic: true },
  ]);
  for (const text of ['<script>alert(1)</script>', '<img src=x onerror=alert(1)>', '[a link](https://example.org)', '![pic](x.png)', 'a * b * c', 'snake_case_name']) {
    assert.equal(plain(parseInline(text)), text, text); // shown exactly as written
  }
});

test('raw HTML in the file stays text in every kind of block', async () => {
  const { parseMarkdown } = await load();
  const text = '# <b>Head</b>\n<div onclick=x>para</div>\n\n- <i>item</i>';
  const [heading, paragraph, list] = parseMarkdown(text);
  assert.equal(plain(heading.inline), '<b>Head</b>');
  assert.equal(plain(paragraph.inline), '<div onclick=x>para</div>');
  assert.equal(plain(list.items[0].inline), '<i>item</i>');
});

test('empty and odd input does no harm', async () => {
  const { parseMarkdown } = await load();
  for (const empty of ['', '   ', '\n\n', null, undefined]) assert.deepEqual(parseMarkdown(empty), []);
  assert.doesNotThrow(() => parseMarkdown('- \n  - \n#\n####### seven\n\t- tabbed'));
});

test('the example instructions in docs/ render into sensible blocks', async () => {
  const { parseMarkdown } = await load();
  const blocks = parseMarkdown(fs.readFileSync(path.join(__dirname, '..', '..', 'docs', 'player-instructions.md'), 'utf8'));
  assert.ok(blocks.some((b) => b.type === 'heading') && blocks.some((b) => b.type === 'list'));
  assert.ok(blocks.filter((b) => b.type === 'list').every((l) => l.items.length > 0));
});
