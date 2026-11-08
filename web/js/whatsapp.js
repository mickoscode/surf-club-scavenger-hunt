// Turning the word "WhatsApp" into a link to the group, when the admin has set one. Rules: docs/requirements.md,
// "WhatsApp group link". Every occurrence of the word, in any capitalisation, inside the element you give it becomes a link
// (except inside buttons, links and the like). With no link, the words stay plain text.
const PREFIX = 'https://chat.whatsapp.com/';

// The only kind of address a page ever links to. The server already refuses anything else; this is a second lock, so a
// wrong or hostile value (javascript:, another site) can never become a link on a page.
export const safeWhatsAppUrl = (url) => (typeof url === 'string' && url.startsWith(PREFIX) && !/\s/.test(url) ? url : null);

// "upload to WhatsApp, not whatsapp" -> [{ text: 'upload to ', link: false }, { text: 'WhatsApp', link: true }, ...]
export function splitOnWhatsApp(text) {
  const parts = [];
  let last = 0;
  for (const match of text.matchAll(/whatsapp/gi)) {
    if (match.index > last) parts.push({ text: text.slice(last, match.index), link: false });
    parts.push({ text: match[0], link: true });
    last = match.index + match[0].length;
  }
  if (last < text.length) parts.push({ text: text.slice(last), link: false });
  return parts;
}

const SKIP = 'a, button, script, style, textarea, input, select';

// Makes the mentions of WhatsApp inside `root` links to `url` (or plain text again when `url` is missing or unsafe).
// Safe to call as often as you like: it undoes its own links first.
export function applyWhatsAppLinks(root, url) {
  for (const link of root.querySelectorAll('a[data-whatsapp-link]')) link.replaceWith(document.createTextNode(link.textContent));
  root.normalize();
  const safe = safeWhatsAppUrl(url);
  if (!safe) return;

  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: (node) => (/whatsapp/i.test(node.nodeValue) && !node.parentElement.closest(SKIP) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT),
  });
  const nodes = [];
  while (walker.nextNode()) nodes.push(walker.currentNode);
  for (const node of nodes) {
    const pieces = splitOnWhatsApp(node.nodeValue).map((part) => {
      if (!part.link) return document.createTextNode(part.text);
      const a = document.createElement('a');
      a.href = safe;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      a.dataset.whatsappLink = '';
      a.textContent = part.text;
      return a;
    });
    node.replaceWith(...pieces);
  }
}
