// terraform/rewrite.js runs on CloudFront in front of every page request, so a mistake breaks the whole site.
// The file is loaded the way CloudFront runs it: as a script that defines handler(event).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const sandbox = {};
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', '..', 'terraform', 'rewrite.js'), 'utf8'), sandbox);
const handle = (uri) => sandbox.handler({ request: { uri, method: 'GET', headers: {} } });

test('a directory address serves that directory\'s index page', () => {
  assert.equal(handle('/').uri, '/index.html');
  assert.equal(handle('/view/').uri, '/view/index.html');
  assert.equal(handle('/game-config/').uri, '/game-config/index.html');
});

test('an address without a trailing slash is redirected to the one with it', () => {
  for (const uri of ['/view', '/play', '/game-score']) {
    const res = handle(uri);
    assert.equal(res.statusCode, 301, uri);
    assert.equal(res.headers.location.value, `${uri}/`);
  }
});

test('files are served as they are', () => {
  for (const uri of ['/index.html', '/404.html', '/css/site.css', '/js/main.js', '/vendor/bootstrap/bootstrap.min.css', '/favicon.svg', '/maps/zone-1.webp']) {
    assert.equal(handle(uri).uri, uri);
  }
});
