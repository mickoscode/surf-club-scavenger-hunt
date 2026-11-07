// The instructions are the Markdown file docs/player-instructions.md, rendered into the play page at build time. These
// tests use their own Markdown, never the real file or its wording. The important rule: HTML written in the Markdown
// is shown as text and never becomes markup.
const test = require('node:test');
const assert = require('node:assert/strict');
const { renderInstructions } = require('../../scripts/render-instructions.js');

test('headings, lists (nested) and bold text are rendered', () => {
  const html = renderInstructions('# Rules\n- one\n  - nested **bold**\n- two\n\n# Hints\n- three');
  assert.equal((html.match(/<h2/g) ?? []).length, 2); // the page has its own h1, so headings are h2
  assert.doesNotMatch(html, /<h1/);
  assert.equal((html.match(/<li>/g) ?? []).length, 4);
  assert.match(html, /<ul>[\s\S]*<ul>[\s\S]*<strong>bold<\/strong>/);
});

test('raw HTML in the Markdown is shown as text, never run', () => {
  const html = renderInstructions('- <script>alert(1)</script>\n- <img src=x onerror=alert(1)>\n\n<iframe src="x"></iframe>');
  assert.doesNotMatch(html, /<script|<img|<iframe/);
  assert.match(html, /&lt;script&gt;/);
});
