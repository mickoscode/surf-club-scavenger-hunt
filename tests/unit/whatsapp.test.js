// The WhatsApp link setting must only ever accept a real group invite link on WhatsApp's own address.
const test = require('node:test');
const assert = require('node:assert/strict');
const { normaliseWhatsappUrl } = require('../../api/lib/whatsapp.js');
const { validateConfig } = require('../../api/lib/gamestate.js');

const CODE = 'AbCdEfGhIjKlMnOpQrStUv';

test('a group invite link is accepted and stored in its plain form', () => {
  const plain = { ok: true, url: `https://chat.whatsapp.com/${CODE}` };
  assert.deepEqual(normaliseWhatsappUrl(`https://chat.whatsapp.com/${CODE}`), plain);
  assert.deepEqual(normaliseWhatsappUrl(`  https://chat.whatsapp.com/${CODE}  `), plain); // spaces around it
  assert.deepEqual(normaliseWhatsappUrl(`https://chat.whatsapp.com/${CODE}/`), plain);
  assert.deepEqual(normaliseWhatsappUrl(`https://chat.whatsapp.com/${CODE}?mode=ems_copy_t`), plain); // tracking dropped
  assert.deepEqual(normaliseWhatsappUrl(`https://CHAT.WHATSAPP.COM/${CODE}#frag`), plain);
});

test('an empty setting means "no link", and is fine', () => {
  for (const empty of [undefined, null, '', '   ']) assert.deepEqual(normaliseWhatsappUrl(empty), { ok: true, url: null });
});

test('anything that is not a group invite link on WhatsApp\'s own address is refused', () => {
  const bad = [
    `http://chat.whatsapp.com/${CODE}`, // not https
    `https://chat.whatsapp.com.evil.example/${CODE}`, // a look-alike host
    `https://evilchat.whatsapp.com/${CODE}`,
    `https://whatsapp.com/${CODE}`,
    `https://wa.me/${CODE}`,
    `https://chat.whatsapp.com@evil.example/${CODE}`, // user@host trick
    `https://user:pass@chat.whatsapp.com/${CODE}`,
    `https://chat.whatsapp.com:8443/${CODE}`,
    `javascript:alert(1)`,
    `data:text/html,hi`,
    `https://chat.whatsapp.com/`, // no code
    'https://chat.whatsapp.com/short', // too short to be a code
    `https://chat.whatsapp.com/${CODE}/extra`,
    `https://chat.whatsapp.com/${CODE}%20x`,
    `https://chat.whatsapp.com/${CODE} and more`,
    'chat.whatsapp.com/' + CODE, // no scheme
    'not a link',
    42, {}, [],
  ];
  for (const link of bad) assert.deepEqual(normaliseWhatsappUrl(link), { ok: false }, String(link));
});

test('the game configuration accepts the link as optional and flags a bad one by name', () => {
  const config = { name: 'T', timeZone: 'Australia/Perth', day: '2026-11-14', start: '10:00', end: '12:00' };
  assert.deepEqual(validateConfig(config), []);
  assert.deepEqual(validateConfig({ ...config, whatsappUrl: `https://chat.whatsapp.com/${CODE}` }), []);
  assert.deepEqual(validateConfig({ ...config, whatsappUrl: 'https://example.org/x' }), ['whatsappUrl']);
});
