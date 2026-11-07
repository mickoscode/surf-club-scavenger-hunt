'use strict';
// Converts between API Gateway HTTP API (payload format 2.0) events and the app's request/response.

function fromLambdaEvent(event) {
  const headers = Object.fromEntries(Object.entries(event.headers ?? {}).map(([k, v]) => [k.toLowerCase(), v]));
  if (event.cookies?.length) headers.cookie = event.cookies.join('; ');
  let body = event.body ?? null;
  if (body !== null && event.isBase64Encoded) body = Buffer.from(body, 'base64').toString('utf8');
  return { method: event.requestContext.http.method, path: event.rawPath, headers, body };
}

function toLambdaResponse(response) {
  const out = { statusCode: response.status, headers: response.headers, body: JSON.stringify(response.body) };
  if (response.cookies.length) out.cookies = response.cookies;
  return out;
}

module.exports = { fromLambdaEvent, toLambdaResponse };
