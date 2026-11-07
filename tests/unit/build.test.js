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

const pages = () => fs.readdirSync(dist).filter((f) => f.endsWith('.html'));

test('the site has a home page and a 404 page', () => {
  assert.ok(pages().includes('index.html'));
  assert.ok(pages().includes('404.html'));
});

test('every local stylesheet, script and icon a page references is in dist', () => {
  for (const page of pages()) {
    const html = fs.readFileSync(path.join(dist, page), 'utf8');
    for (const [, ref] of html.matchAll(/\b(?:href|src)="([^"]+)"/g)) {
      if (ref.startsWith('#') || ref.startsWith('mailto:')) continue;
      assert.ok(ref.startsWith('/'), `${page}: "${ref}" must be a site-absolute path (no CDN or external resources)`);
      const file = ref === '/' ? 'index.html' : ref.slice(1);
      assert.ok(fs.existsSync(path.join(dist, file)), `${page}: ${ref} is missing from dist`);
    }
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
