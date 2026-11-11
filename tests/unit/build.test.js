// Checks the assembled site (dist/) against what the CloudFront Content-Security-Policy in terraform/cloudfront.tf
// allows. A page that breaks the policy still deploys, but renders unstyled or with dead scripts.
const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..', '..');
const dist = path.join(root, 'dist');

test.before(() => {
  const r = spawnSync('bash', ['scripts/build.sh'], { cwd: root, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr || r.stdout);
});

const pages = () => fs.readdirSync(dist, { recursive: true }).filter((f) => f.endsWith('.html')); // including pages in folders

test('the site has a home page, a scoreboard page, a play page, a results page and a 404 page', () => {
  for (const page of ['index.html', 'view/index.html', 'play/index.html', 'results/index.html', '404.html']) assert.ok(pages().includes(page), page);
});

test('the play page has an Instructions panel that is hidden until an event gives it text', () => {
  const html = fs.readFileSync(path.join(dist, 'play', 'index.html'), 'utf8');
  assert.match(html, /<details[^>]*data-testid="instructions"[^>]*\shidden/);
  assert.match(html, /<div class="instructions[^"]*"><\/div>/); // empty: the page draws the event's instructions into it
});

test('every local stylesheet, script and icon a page references is in dist', () => {
  for (const page of pages()) {
    const html = fs.readFileSync(path.join(dist, page), 'utf8');
    for (const [, ref] of html.matchAll(/\b(?:href|src)="([^"]+)"/g)) {
      if (ref.startsWith('#') || ref.startsWith('mailto:')) continue;
      if (ref.startsWith('/api/')) continue; // served by the backend, not a file
      assert.ok(ref.startsWith('/'), `${page}: "${ref}" must be a site-absolute path (no CDN or external resources)`);
      const file = ref === '/' ? 'index.html' : ref.slice(1);
      assert.ok(fs.existsSync(path.join(dist, file)), `${page}: ${ref} is missing from dist`);
    }
  }
});

test('every module a script imports is in dist (a missing one is a blank page in the browser)', () => {
  const scripts = fs.readdirSync(path.join(dist, 'js'), { recursive: true }).filter((f) => f.endsWith('.js'));
  assert.ok(scripts.length > 0);
  for (const script of scripts) {
    const dir = path.dirname(path.join(dist, 'js', script));
    const code = fs.readFileSync(path.join(dist, 'js', script), 'utf8');
    for (const [, spec] of code.matchAll(/\bfrom\s+'(\.{1,2}\/[^']+)'/g)) {
      assert.ok(fs.existsSync(path.resolve(dir, spec)), `${script} imports ${spec}, which is not in dist`);
    }
  }
  assert.equal(fs.existsSync(path.join(dist, 'js', 'package.json')), false); // only for Node; not deployed
});

test('all four admin pages exist and tell search engines not to index them', () => {
  for (const page of ['game-config/index.html', 'game-score/index.html', 'game-events/index.html', 'game-teams/index.html']) {
    const html = fs.readFileSync(path.join(dist, page), 'utf8');
    assert.match(html, /<meta name="robots" content="[^"]*noindex/, page);
  }
});

test('pages use no inline script, style or event handler (blocked by the CSP)', () => {
  for (const page of pages()) {
    const html = fs.readFileSync(path.join(dist, page), 'utf8');
    assert.doesNotMatch(html, /<script(?![^>]*\bsrc=)/i, `${page}: inline <script>`);
    assert.doesNotMatch(html, /<style\b/i, `${page}: <style> block`);
    assert.doesNotMatch(html, /\sstyle=/i, `${page}: style attribute`);
    assert.doesNotMatch(html, /\son[a-z]+=/i, `${page}: inline event handler`);
  }
});
