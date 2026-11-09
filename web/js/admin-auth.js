// Login for the two admin pages. Once an admin passcode is set, a page shows ONLY a login box until the passcode has been
// entered (the pages are ordinary public files with nothing secret in them; the admin API is what is protected). It also
// copes with the session ending while a page is open (12 hours): the login box comes back and the page carries on after it.
// Until a passcode is set the pages open straight away. Rules: docs/requirements.md, "Admin passcode".
import { getJson, postJson, setUnauthorizedHandler } from './api.js';
import { $ } from './dom.js';

let locked = true;

// Pages skip their refreshes while locked, so a missing session does not cause a stream of refused requests.
export const isLocked = () => locked;

const MESSAGE = {
  'wrong-passcode': 'That passcode is not right.',
  'session-ended': 'Your session has ended. Please log in again.',
  network: 'Could not reach the server. Check the connection and try again.',
};

// start(): begins the page (its first load and its refresh timer): called once, as soon as the admin is allowed in.
// refresh(): called after a later login, so the page updates at once.
export async function guardAdminPage({ start, refresh }) {
  const panel = $('login-panel');
  const content = $('admin-content');
  const logout = $('logout-button');
  const form = $('login-form');
  const input = $('passcode-input');
  const error = $('login-error');
  let started = false;

  function showError(code, text) {
    error.dataset.error = code;
    error.textContent = text;
    error.hidden = false;
  }

  function lock(code) {
    locked = true;
    content.hidden = true;
    logout.hidden = true;
    panel.hidden = false;
    if (code) showError(code, MESSAGE[code]);
    else error.hidden = true;
  }

  function open(required) {
    locked = false;
    panel.hidden = true;
    content.hidden = false;
    logout.hidden = !required; // nothing to log out of until a passcode is set
    error.hidden = true;
    input.value = '';
    if (!started) {
      started = true;
      start();
    } else {
      refresh();
    }
  }

  setUnauthorizedHandler(() => { if (!locked) lock('session-ended'); });

  async function check() {
    const session = await getJson('/api/admin/session');
    if (!session.ok) {
      lock('network');
      setTimeout(check, 5000); // try again by itself
      return;
    }
    if (session.body.required && !session.body.authenticated) lock();
    else open(session.body.required);
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const button = $('login-button');
    button.disabled = true;
    error.hidden = true;
    const res = await postJson('/api/admin/login', { passcode: input.value });
    button.disabled = false;
    input.value = ''; // never left on the page
    if (res.ok) return open(res.body.required);
    const code = res.status === 0 ? 'network' : (res.body?.error ?? 'unknown');
    if (code === 'too-many-attempts') {
      const minutes = Math.max(1, Math.ceil((res.body?.retryAfterSeconds ?? 300) / 60));
      showError(code, `Too many wrong tries. Please wait about ${minutes} minute${minutes === 1 ? '' : 's'} and try again.`);
    } else {
      showError(code, MESSAGE[code] ?? 'Something went wrong. Please try again.');
    }
  });

  logout.addEventListener('click', async () => {
    await postJson('/api/admin/logout', {});
    lock();
  });

  await check();
}
