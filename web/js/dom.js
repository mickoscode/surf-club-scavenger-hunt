// Tiny DOM helpers. Pages find elements by data-testid (the same hooks the tests use) and only ever set text with
// textContent, never innerHTML.
export const $ = (testId) => document.querySelector(`[data-testid="${testId}"]`);

// Creates an element with attributes and text: el('button', { type: 'button', class: 'btn' }, 'Join').
export function el(tag, attributes = {}, text = '') {
  const node = document.createElement(tag);
  for (const [name, value] of Object.entries(attributes)) node.setAttribute(name, value);
  node.textContent = text;
  return node;
}

// ?refresh=500 shortens the refresh interval (the browser tests use it); anything outside 0.5 to 60 seconds is ignored.
export function refreshInterval(defaultMs = 5000) {
  const asked = Number(new URLSearchParams(location.search).get('refresh'));
  return asked >= 500 && asked <= 60000 ? asked : defaultMs;
}
