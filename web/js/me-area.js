// The area above the scoreboard on /view/: a Join button (with the one-field form) for someone who has not joined, or
// the Play button for someone who has (a Results button from the moment the game is over, published or not). It is only rebuilt when what it shows changes, so a refresh
// never wipes a team name that is half typed.
import { postJson } from './api.js';
import { el } from './dom.js';

const ERROR_TEXT = {
  empty: 'Please enter a team name.',
  'too-long': 'Team names can be up to 30 characters.',
  'invalid-characters': 'That name has characters we can’t use.',
  'name-taken': 'That team name is already taken. Please choose another.',
  'not-allowed': 'Please choose a different team name.',
  'wrong-code': 'That code is not right. Ask the organisers for the code to join.',
  'not-joinable': 'Joining is closed.',
};
const GENERIC_ERROR = 'Something went wrong. Please try again.';

export function createMeArea({ container, onJoined }) {
  let shown = null;

  // teamNames: whether teams have names; codeRequired: whether the admin set a code to join (both game settings). With neither
  // there is nothing to type, so the Join button joins.
  function buildJoin(teamNames, codeRequired) {
    const button = el('button', { type: 'button', class: 'btn btn-primary btn-lg w-100', 'data-testid': 'join-button' }, 'Join');

    const form = el('form', { class: 'mt-3', 'data-testid': 'join-form', novalidate: '' });
    form.hidden = true;
    // The join code (when there is one) comes first, then the team name (when teams have names).
    if (codeRequired) {
      form.append(
        el('label', { for: 'join-code', class: 'form-label fw-semibold' }, 'Join Code:'),
        el('input', { id: 'join-code', name: 'joinCode', type: 'text', maxlength: '30', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false', class: 'form-control form-control-lg', 'data-testid': 'join-code-input' }),
      );
    }
    if (teamNames) {
      form.append(
        el('label', { for: 'team-name', class: `form-label fw-semibold${codeRequired ? ' mt-3' : ''}` }, 'Name for Your Team:'),
        el('input', { id: 'team-name', name: 'teamName', type: 'text', maxlength: '30', autocomplete: 'off', class: 'form-control form-control-lg', 'data-testid': 'team-name-input' }),
      );
    }
    const submit = el('button', { type: 'submit', class: 'btn btn-success btn-lg w-100 mt-3', 'data-testid': 'join-submit' }, 'Join game');
    const error = el('p', { class: 'text-danger mt-2 mb-0', role: 'alert', 'data-testid': 'join-error' });
    error.hidden = true;
    form.append(submit, error);

    const send = async () => {
      submit.disabled = true;
      error.hidden = true;
      const res = await postJson('/api/join', { name: form.querySelector('[name="teamName"]')?.value ?? '', code: form.querySelector('[name="joinCode"]')?.value ?? '' });
      if (res.ok) {
        await onJoined();
        return;
      }
      const code = res.body?.error ?? 'unknown';
      error.dataset.error = code;
      error.textContent = ERROR_TEXT[code] ?? GENERIC_ERROR;
      error.hidden = false;
      submit.disabled = false;
      button.disabled = false;
    };

    button.addEventListener('click', () => {
      if (!teamNames && !codeRequired) { // nothing to fill in: join straight away (an error then shows in the form below the button)
        button.disabled = true;
        form.hidden = false;
        submit.hidden = true;
        send();
        return;
      }
      form.hidden = false;
      button.hidden = true;
      form.querySelector('input').focus(); // the first field
    });
    form.addEventListener('submit', (event) => { event.preventDefault(); send(); });

    return [button, form];
  }

  function buildLink(gameOver) {
    const link = gameOver
      ? el('a', { href: '/results/', class: 'btn btn-primary btn-lg w-100', 'data-testid': 'results-link' }, 'Results')
      : el('a', { href: '/play/', class: 'btn btn-primary btn-lg w-100', 'data-testid': 'play-link' }, 'Play');
    return [link]; // the team's own name is not repeated here: its row in the scoreboard is highlighted
  }

  return {
    // team: { number, name } or null; canJoin: whether joining is open right now; teamNames: whether teams have names.
    render({ team, canJoin, gameOver = false, teamNames = true, joinCodeRequired = false }) {
      const next = team ? (gameOver ? 'results' : 'play') : canJoin ? `join-${teamNames}-${joinCodeRequired}` : 'none';
      if (next === shown) return;
      shown = next;
      container.replaceChildren(...(team ? buildLink(gameOver) : canJoin ? buildJoin(teamNames, joinCodeRequired) : []));
    },
  };
}
