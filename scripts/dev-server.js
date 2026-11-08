#!/usr/bin/env node
// Serves the site and the API on one local address with the in-memory store: no AWS needed. Used for development
// (`npm run dev`) and by the tests that need a real HTTP server (the smoke test, the browser tests).
//
// It mimics CloudFront closely enough for the tests to mean something:
//   - /api/admin/* goes to the admin app and the rest of /api/* to the public app
//   - pages go through the real terraform/rewrite.js (so /view/ serves /view/index.html)
//   - every file is sent with the real Content-Security-Policy read from terraform/cloudfront.tf
//   - a missing file is the 404 page with status 404
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const vm = require('node:vm');
const { createApp } = require('../api/app/app');
const { createMemoryStore } = require('../api/store/memory');
const { loadGameData } = require('../api/app/game-file');

const ROOT = path.join(__dirname, '..');
const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.json': 'application/json',
};

function createApiHandler({ store = createMemoryStore(), now = Date.now, loadGame = loadGameData, cookieSecure = false, intercept, adminPasscodeHash = process.env.ADMIN_PASSCODE_HASH ?? '' } = {}) {
  const shared = { store, now, loadGameData: loadGame, cookieSecure };
  const publicApp = createApp({ ...shared, role: 'public' });
  const adminApp = createApp({ ...shared, role: 'admin', adminPasscodeHash });

  return async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const request = {
      method: req.method,
      path: new URL(req.url, 'http://localhost').pathname,
      headers: req.headers,
      body: chunks.length ? Buffer.concat(chunks).toString('utf8') : null,
    };
    // `intercept` lets a test replace a response (to simulate a broken deploy or a failing API).
    const response = (await intercept?.(request)) ?? await (request.path.startsWith('/api/admin/') ? adminApp : publicApp).handle(request);
    const headers = { ...response.headers };
    if (response.cookies.length) headers['set-cookie'] = response.cookies;
    res.writeHead(response.status, headers).end(JSON.stringify(response.body));
  };
}

// The policy CloudFront sends, read from the Terraform so the tests can never drift from it.
function readContentSecurityPolicy() {
  const tf = fs.readFileSync(path.join(ROOT, 'terraform', 'cloudfront.tf'), 'utf8');
  const block = /content_security_policy = join\("; ", \[([\s\S]*?)\]\)/.exec(tf);
  if (!block) throw new Error('content_security_policy not found in terraform/cloudfront.tf');
  return [...block[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]).join('; ');
}

function loadRewrite() {
  const sandbox = {};
  vm.runInNewContext(fs.readFileSync(path.join(ROOT, 'terraform', 'rewrite.js'), 'utf8'), sandbox);
  return sandbox.handler;
}

function createSiteHandler({ distDir = path.join(ROOT, 'dist'), ...apiOptions } = {}) {
  const api = createApiHandler(apiOptions);
  const rewrite = loadRewrite();
  const csp = readContentSecurityPolicy();
  const baseHeaders = { 'content-security-policy': csp, 'x-content-type-options': 'nosniff', 'cache-control': 'no-cache' };

  function sendFile(res, status, file) {
    res.writeHead(status, { ...baseHeaders, 'content-type': MIME[path.extname(file)] ?? 'application/octet-stream' }).end(fs.readFileSync(file));
  }

  return async (req, res) => {
    const pathname = new URL(req.url, 'http://localhost').pathname;
    if (pathname.startsWith('/api/')) return api(req, res);

    const rewritten = rewrite({ request: { uri: pathname, method: req.method, headers: {} } });
    if (rewritten.statusCode) return void res.writeHead(rewritten.statusCode, { location: rewritten.headers.location.value }).end();

    const file = path.join(distDir, decodeURIComponent(rewritten.uri));
    if (file.startsWith(distDir + path.sep) && fs.existsSync(file) && fs.statSync(file).isFile()) return sendFile(res, 200, file);
    return sendFile(res, 404, path.join(distDir, '404.html'));
  };
}

const createApiServer = (options) => http.createServer(createApiHandler(options));
const createSiteServer = (options) => http.createServer(createSiteHandler(options));

module.exports = { createApiHandler, createSiteHandler, createApiServer, createSiteServer, readContentSecurityPolicy };

if (require.main === module) {
  const port = Number(process.env.PORT) || 8787;
  if (!fs.existsSync(path.join(ROOT, 'dist', 'index.html'))) {
    console.error('dist/ is missing: run "npm run build" first (or use "npm run dev", which does)');
    process.exit(1);
  }
  createSiteServer().listen(port, () => console.log(`Site and API (in-memory store) on http://localhost:${port}/`));
}
