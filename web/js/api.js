// Calls to the backend (same address, under /api). Never throws: a network failure is { ok: false, status: 0 }.
async function request(path, options) {
  try {
    const res = await fetch(path, { credentials: 'same-origin', ...options });
    const body = await res.json().catch(() => null);
    return { ok: res.ok, status: res.status, body };
  } catch {
    return { ok: false, status: 0, body: null };
  }
}

export const getJson = (path) => request(path);

export const postJson = (path, data) =>
  request(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(data) });

export const putJson = (path, data) =>
  request(path, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(data) });

export const deleteJson = (path) => request(path, { method: 'DELETE' });
