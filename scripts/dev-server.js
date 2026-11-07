#!/usr/bin/env node
// Serves the API over plain HTTP with the in-memory store: no AWS needed. Used for local development (`npm run dev:api`)
// and by the tests that need a real HTTP server (the smoke test now, the browser tests later).
// Like CloudFront in production, /api/admin/* goes to the admin app and the rest of /api/* to the public app.
const http = require('node:http');
const { createApp } = require('../api/app/app');
const { createMemoryStore } = require('../api/store/memory');
const { loadGameData } = require('../api/app/game-file');

function createApiHandler({ store = createMemoryStore(), now = Date.now, loadGame = loadGameData, cookieSecure = false, intercept } = {}) {
  const shared = { store, now, loadGameData: loadGame, cookieSecure };
  const publicApp = createApp({ ...shared, role: 'public' });
  const adminApp = createApp({ ...shared, role: 'admin' });

  return async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const request = {
      method: req.method,
      path: new URL(req.url, 'http://localhost').pathname,
      headers: req.headers,
      body: chunks.length ? Buffer.concat(chunks).toString('utf8') : null,
    };
    // `intercept` lets a test replace a response (to simulate a broken deploy).
    const response = (await intercept?.(request)) ?? await (request.path.startsWith('/api/admin/') ? adminApp : publicApp).handle(request);
    const headers = { ...response.headers };
    if (response.cookies.length) headers['set-cookie'] = response.cookies;
    res.writeHead(response.status, headers).end(JSON.stringify(response.body));
  };
}

const createApiServer = (options) => http.createServer(createApiHandler(options));

module.exports = { createApiHandler, createApiServer };

if (require.main === module) {
  const port = Number(process.env.PORT) || 8787;
  createApiServer().listen(port, () => console.log(`API (in-memory store) on http://localhost:${port}/api/health`));
}
