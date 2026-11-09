'use strict';
// Small HTTP helpers shared by the routes. A response is { status, headers, cookies, body } (body is an object).

const MAX_BODY_BYTES = 4096;
const COOKIE_NAME = 'hunt';
const ADMIN_COOKIE_NAME = 'hunt_admin';
const COOKIE_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;

class HttpError extends Error {
  constructor(status, code, extra = {}) {
    super(code);
    this.status = status;
    this.code = code;
    this.extra = extra;
  }
}

const respond = (status, body, headers = {}, cookies = []) => ({
  status,
  headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers },
  cookies,
  body,
});

function parseCookies(header) {
  const cookies = {};
  for (const part of String(header ?? '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) cookies[part.slice(0, i).trim()] = part.slice(i + 1).trim();
  }
  return cookies;
}

// HttpOnly: scripts cannot read it. SameSite=Strict: other sites cannot make the browser send it. Path=/api:
// only API calls carry it. It lasts 30 days, so closing the browser does not end a team's session.
function sessionCookie(value, { secure = true } = {}) {
  return `${COOKIE_NAME}=${value}; Path=/api; HttpOnly; SameSite=Strict; Max-Age=${COOKIE_MAX_AGE_SECONDS}${secure ? '; Secure' : ''}`;
}

// The admin's session: the same protections, but only sent to the admin API (Path=/api/admin) and lasting maxAgeSeconds.
// Max-Age=0 (an empty value) ends it.
function adminCookie(value, { secure = true, maxAgeSeconds } = {}) {
  return `${ADMIN_COOKIE_NAME}=${value}; Path=/api/admin; HttpOnly; SameSite=Strict; Max-Age=${maxAgeSeconds}${secure ? '; Secure' : ''}`;
}

// POST bodies must be JSON sent as application/json, which a plain HTML form on another site cannot send.
// maxBytes: the usual small limit, or more for the few routes that upload a file (the questions, a map).
function readJson(request, maxBytes = MAX_BODY_BYTES) {
  const type = String(request.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase();
  if (type !== 'application/json') throw new HttpError(415, 'unsupported-media-type');
  const text = request.body ?? '';
  if (Buffer.byteLength(text) > maxBytes) throw new HttpError(413, 'body-too-large');
  let parsed;
  try { parsed = JSON.parse(text); } catch { throw new HttpError(400, 'bad-json'); }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) throw new HttpError(400, 'bad-json');
  return parsed;
}

module.exports = { HttpError, respond, parseCookies, sessionCookie, adminCookie, readJson, COOKIE_NAME, ADMIN_COOKIE_NAME, MAX_BODY_BYTES };
