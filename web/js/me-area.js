// The area above the scoreboard on /view/: a Join button (with the one-field form) for someone who has not joined, or
// the Play button for someone who has. It is only rebuilt when what it shows changes, so a refresh
// never wipes a team name that is half typed.
import { postJson } from './api.js';
import { el } from './dom.js';

const ERROR_TEXT = {
  empty: 'Please enter a team name.',
  'too-long': 'Team names can be up to 30 characters.',
  'invalid-characters': 'That name has characters we can’t use.',
  'name-taken': 'That team name is already taken. Please choose another.',
  'not-allowed': 'Please choose a different team name.',
  'not-joinable': 'Joining is closed.',
};
const GENERIC_ERROR = 'Something went wrong. Please try again.';

export function createMeArea({ container, onJoined }) {
  let shown = null;

  function buildJoin() {
    const button = el('button', { type: 'button', class: 'btn btn-primary btn-lg w-100', 'data-testid': 'join-button' }, 'Join');

    const form = el('form', { class: 'mt-3', 'data-testid': 'join-form', novalidate: '' });
    form.hidden = true;
    form.append(
      el('label', { for: 'team-name', class: 'form-label fw-semibold' }, 'Enter Team Name:'),
      el('input', { id: 'team-name', name: 'teamName', type: 'text', maxlength: '30', autocomplete: 'off', class: 'form-control form-control-lg', 'data-testid': 'team-name-input' }),
    );
    const submit = el('button', { type: 'submit', class: 'btn btn-success btn-lg w-100 mt-3', 'data-testid': 'join-submit' }, 'Join game');
    const error = el('p', { class: 'text-danger mt-2 mb-0', role: 'alert', 'data-testid': 'join-error' });
    error.hidden = true;
    form.append(submit, error);

    button.addEventListener('click', () => {
      form.hidden = false;
      button.hidden = true;
      form.querySelector('input').focus();
    });

    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      submit.disabled = true;
      error.hidden = true;
      const res = await postJson('/api/join', { name: form.querySelector('input').value });
      if (res.ok) {
        await onJoined();
        return;
      }
      const code = res.body?.error ?? 'unknown';
      error.dataset.error = code;
      error.textContent = ERROR_TEXT[code] ?? GENERIC_ERROR;
      error.hidden = false;
      submit.disabled = false;
    });

    return [button, form];
  }

  function buildPlay() {
    const play = el('a', { href: '/play/', class: 'btn btn-primary btn-lg w-100', 'data-testid': 'play-link' }, 'Play');
    return [play]; // the team's own name is not repeated here: its row in the scoreboard is highlighted
  }

  return {
    // team: { number, name } or null; canJoin: whether joining is open right now.
    render({ team, canJoin }) {
      const next = team ? 'play' : canJoin ? 'join' : 'none';
      if (next === shown) return;
      shown = next;
      container.replaceChildren(...(team ? buildPlay() : canJoin ? buildJoin() : []));
    },
  };
}
