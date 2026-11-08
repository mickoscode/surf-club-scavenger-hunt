'use strict';
// The WhatsApp group link in the game configuration. Only a group INVITE link on WhatsApp's own address is accepted
// (https://chat.whatsapp.com/<code>), so the setting can never point teams at anywhere else. The accepted link is
// stored in its plain form: any tracking query string WhatsApp adds when you copy a link ("?mode=...") is dropped.
// Rules: docs/requirements.md, "WhatsApp group link".

// -> { ok: true, url: string | null } (null for an empty setting) or { ok: false }.
function normaliseWhatsappUrl(input) {
  if (input === undefined || input === null) return { ok: true, url: null };
  if (typeof input !== 'string') return { ok: false };
  const text = input.trim();
  if (text === '') return { ok: true, url: null };
  if (/\s/.test(text)) return { ok: false };
  let url;
  try {
    url = new URL(text);
  } catch {
    return { ok: false };
  }
  // The host must be exactly WhatsApp's: not a look-alike (chat.whatsapp.com.evil.example), not a user:password@ trick.
  if (url.protocol !== 'https:' || url.hostname !== 'chat.whatsapp.com' || url.port || url.username || url.password) return { ok: false };
  const code = /^\/([A-Za-z0-9_-]{10,60})\/?$/.exec(url.pathname);
  if (!code) return { ok: false };
  return { ok: true, url: `https://chat.whatsapp.com/${code[1]}` };
}

module.exports = { normaliseWhatsappUrl };
