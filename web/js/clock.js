// The game phase and countdown as shown on a page. It keeps the latest game summary from the server and the offset
// between the server's clock and this device's, so the countdown does not trust the phone's clock.
import { $ } from './dom.js';
import { phaseOf, countdownTarget, secondsUntil, formatCountdown } from './time.js';

const STATUS_TEXT = { loading: ' ', unconfigured: 'Coming soon', pre: 'Game starts in', active: 'Time left', post: 'Game over' };

export function createClock() {
  let game = null;
  let skewMs = 0;

  const serverNow = () => Date.now() + skewMs;
  const phase = () => (game ? phaseOf(game, serverNow()) : 'loading');

  return {
    update(summary) {
      game = summary;
      skewMs = summary.serverNowMs - Date.now();
    },
    phase,
    published: () => game?.published === true, // the admin has published the final results
    // Fills the status line, the game name and the countdown (data-testid "status", "game-name", "countdown").
    render() {
      const current = phase();
      const status = $('status');
      status.dataset.phase = current;
      status.textContent = STATUS_TEXT[current];
      if (game?.name) $('game-name').textContent = game.name;

      const countdown = $('countdown');
      countdown.dataset.phase = current;
      const target = game ? countdownTarget(game, current) : null;
      if (target === null) {
        countdown.hidden = true;
        delete countdown.dataset.seconds;
      } else {
        const seconds = secondsUntil(target, serverNow());
        countdown.hidden = false;
        countdown.dataset.seconds = String(seconds);
        countdown.textContent = formatCountdown(seconds);
      }
    },
  };
}
