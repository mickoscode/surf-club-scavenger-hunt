#!/usr/bin/env node
// Build step: turns docs/player-instructions.md into HTML and puts it in dist/play/index.html where the page has the
// marker <!--instructions-->. The instructions are therefore part of the page (no extra request, no script needed) and
// change by editing the Markdown file in a PR. Raw HTML written inside the Markdown is shown as text, never run.
const fs = require('node:fs');
const path = require('node:path');
const { Marked } = require('marked');

const ROOT = path.join(__dirname, '..');
const MARKER = '<!--instructions-->';

const escapeHtml = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function renderInstructions(markdown) {
  const marked = new Marked({
    renderer: {
      html: ({ text }) => escapeHtml(text),
      // The page already has its own h1, so instruction headings are small section headings.
      heading(token) {
        return `<h2 class="h6 fw-bold mt-3">${this.parser.parseInline(token.tokens)}</h2>\n`;
      },
    },
  });
  return marked.parse(markdown);
}

module.exports = { renderInstructions };

if (require.main === module) {
  const source = path.join(ROOT, 'docs', 'player-instructions.md');
  const page = path.join(ROOT, 'dist', 'play', 'index.html');
  const markdown = fs.readFileSync(source, 'utf8');
  if (markdown.trim() === '') throw new Error('docs/player-instructions.md is empty');
  const html = fs.readFileSync(page, 'utf8');
  if (!html.includes(MARKER)) throw new Error(`${MARKER} not found in dist/play/index.html`);
  fs.writeFileSync(page, html.replace(MARKER, renderInstructions(markdown)));
  console.log('Instructions rendered into dist/play/index.html');
}
