// The "?" buttons on the admin forms: each one shows and hides its explanation when tapped, so the forms stay short. A button
// names its explanation with data-help-for (the element's id); the explanation starts hidden. Nothing else is needed on a page
// beyond calling wireHelp() once.
export function wireHelp() {
  for (const button of document.querySelectorAll('button[data-help-for]')) {
    const text = document.getElementById(button.dataset.helpFor);
    if (!text) continue;
    button.addEventListener('click', () => {
      text.hidden = !text.hidden;
      button.setAttribute('aria-expanded', String(!text.hidden));
    });
  }
}
