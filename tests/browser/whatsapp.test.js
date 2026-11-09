// The WhatsApp group link in real Chromium: set on the config page, linked from the play page and the scoring page, given only to
// a team with a session. Fixture game with a photo challenge that mentions WhatsApp (zone 1) and one that does not (zone 2).
const assert = require('node:assert/strict');
const { browserSuite, signIn, GAME, START } = require('./helpers.js');

const { withPage } = browserSuite();

const LINK = 'https://chat.whatsapp.com/AbCdEfGhIjKlMnOpQrStUv';
const $ = (testId) => `[data-testid="${testId}"]`;
const overflow = (page) => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);

const game = structuredClone(GAME);
game['zone 1'].questions.find((q) => q.type === 'photo').Q4 = 'Take a team photo and upload it to WhatsApp, not by email';
const withGame = { site: { game } };

// A team that has joined, this browser signed in as it, the play page open on a zone.
async function playing({ site, page, context }, config = {}, zone = 'zone 1') {
  await site.api.configure(config);
  const team = await site.api.join('Sea Dogs');
  await signIn(context, site.url, team);
  await page.goto(`${site.url}/play/?refresh=500`);
  await page.click(`${$('zone-tile')}[data-zone="${zone}"]`);
  await page.waitForSelector(`${$('zone-panel')}[data-zone="${zone}"]:not([hidden])`);
}
const panel = (zone) => `${$('zone-panel')}[data-zone="${zone}"]`;
const links = (page, selector) => page.locator(`${selector} a[data-whatsapp-link]`).evaluateAll((as) => as.map((a) => ({ text: a.textContent, href: a.getAttribute('href'), target: a.target, rel: a.rel })));

// ---------------------------------------------------------------------------------------------- the play page

withPage('with a link set, each photo challenge links to the group: the word WhatsApp, and an Open WhatsApp group button', withGame, async (ctx) => {
  await playing(ctx, { whatsappUrl: LINK });
  const { page } = ctx;
  await page.waitForSelector(`${panel('zone 1')} ${$('whatsapp-open')}:not([hidden])`);

  const inText = await links(page, `${panel('zone 1')} ${$('photo-challenge')}`);
  assert.equal(inText.length, 1);
  assert.deepEqual([inText[0].text, inText[0].href, inText[0].target], ['WhatsApp', LINK, '_blank']);
  assert.match(inText[0].rel, /noopener/);
  const button = page.locator(`${panel('zone 1')} ${$('whatsapp-open')}`);
  assert.deepEqual(await button.evaluate((a) => [a.tagName, a.getAttribute('href'), a.target, a.rel.includes('noopener')]), ['A', LINK, '_blank', true]);

  // The text of the challenge is otherwise untouched.
  assert.equal(await page.locator(`${panel('zone 1')} ${$('photo-challenge')}`).innerText(), 'Take a team photo and upload it to WhatsApp, not by email');
});

withPage('a challenge that does not mention WhatsApp still gets the button, and the submit button is not a link and still works', withGame, async (ctx) => {
  await playing(ctx, { whatsappUrl: LINK }, 'zone 2');
  const { page } = ctx;
  await page.waitForSelector(`${panel('zone 2')} ${$('whatsapp-open')}:not([hidden])`);
  assert.equal((await links(page, `${panel('zone 2')} ${$('photo-challenge')}`)).length, 0);
  const submit = page.locator(`${panel('zone 2')} ${$('photo-submit')}`);
  assert.equal(await submit.evaluate((e) => e.tagName), 'BUTTON'); // "Photo sent to WhatsApp" records the submission: it is not a link
  await submit.click();
  await page.waitForSelector(`${panel('zone 2')} ${$('photo')}[data-state="done"]`);
});

withPage('with a link set, the mentions of WhatsApp in the instructions are links too', withGame, async (ctx) => {
  await playing(ctx, { whatsappUrl: LINK });
  const { page } = ctx;
  await page.goto(`${ctx.site.url}/play/?refresh=500`);
  await page.waitForSelector(`${$('instructions')} a[data-whatsapp-link]`, { state: 'attached' });
  const found = await links(page, $('instructions'));
  assert.ok(found.length > 0);
  for (const link of found) assert.deepEqual([link.href, link.target, /whatsapp/i.test(link.text)], [LINK, '_blank', true]);
});

withPage('with no link set, everything stays plain text and there is no button', withGame, async (ctx) => {
  await playing(ctx);
  const { page } = ctx;
  await new Promise((resolve) => setTimeout(resolve, 1200)); // let the page ask the server and settle
  assert.equal(await page.locator('a[data-whatsapp-link]').count(), 0);
  assert.equal(await page.locator(`${panel('zone 1')} ${$('whatsapp-open')}`).isHidden(), true);
  assert.match(await page.locator(`${panel('zone 1')} ${$('photo-challenge')}`).innerText(), /WhatsApp/); // the word is still there
  assert.match(await page.locator(`${$('instructions')} .instructions`).evaluate((e) => e.textContent), /whatsapp/i);
});

withPage('a link that is not a WhatsApp group invite is ignored by the page, whatever the server says', withGame, async (ctx) => {
  const { page, context, site } = ctx;
  await site.api.configure({ whatsappUrl: LINK });
  const team = await site.api.join('Sea Dogs');
  await signIn(context, site.url, team);
  let hostile = 'javascript:alert(1)';
  await page.route('**/api/me', async (route) => {
    const response = await route.fetch();
    await route.fulfill({ response, json: { ...(await response.json()), whatsappUrl: hostile } });
  });
  for (hostile of ['javascript:alert(1)', 'https://example.org/phish', 'http://chat.whatsapp.com/AbCdEfGhIjKlMnOpQrStUv']) {
    await page.goto(`${site.url}/play/?refresh=500`);
    await page.click(`${$('zone-tile')}[data-zone="zone 1"]`);
    await new Promise((resolve) => setTimeout(resolve, 1000));
    assert.equal(await page.locator('a[data-whatsapp-link]').count(), 0, hostile);
    assert.equal(await page.locator(`${$('whatsapp-open')}:not([hidden])`).count(), 0, hostile);
  }
});

withPage('on a phone the link, the button and a long challenge fit the screen, with no errors', { ...withGame, page: { viewport: { width: 360, height: 640 } } }, async (ctx) => {
  await playing(ctx, { whatsappUrl: LINK });
  const { page, problems, cspViolations } = ctx;
  await page.waitForSelector(`${panel('zone 1')} ${$('whatsapp-open')}:not([hidden])`);
  assert.ok((await overflow(page)) <= 0, 'the zone is wider than the screen');
  assert.deepEqual(problems, []);
  assert.deepEqual(await cspViolations(), []);
});

// ---------------------------------------------------------------------------------------------- who does not get it

withPage('spectators and the public pages never get the link, and neither does a team on the scoreboard or results pages', withGame, async ({ site, page, context, browser }) => {
  await site.api.configure({ whatsappUrl: LINK });
  const team = await site.api.join('Sea Dogs');

  const spectator = await browser.newContext(); // no session
  const spectatorPage = await spectator.newPage();
  await signIn(context, site.url, team);
  for (const [who, p] of [['spectator', spectatorPage], ['team', page]]) {
    for (const path of ['/view/', '/results/']) {
      await p.goto(`${site.url}${path}?refresh=500`);
      await new Promise((resolve) => setTimeout(resolve, 1200));
      assert.ok(!(await p.content()).includes('chat.whatsapp.com'), `${who} ${path}`);
      assert.equal(await p.locator('a[href*="whatsapp"]').count(), 0, `${who} ${path}`);
    }
  }
  const body = await (await spectatorPage.request.get(`${site.url}/api/me`)).text();
  assert.ok(!body.includes('whatsapp'));
  await spectator.close();
});

// ---------------------------------------------------------------------------------------------- the admin pages

withPage('the config page sets, checks and clears the link, and refuses a wrong one', { site: { now: START - 3_600_000, game } }, async ({ site, page }) => {
  await page.goto(`${site.url}/game-config/?refresh=500`);
  await page.waitForSelector(`${$('game-status')}:not([data-status="loading"])`);
  const field = $('config-whatsapp');
  assert.equal(await page.inputValue(field), '');
  assert.equal(await page.locator($('whatsapp-test')).isHidden(), true);

  await page.fill($('config-day'), '2026-11-14');
  await page.fill($('config-start'), '10:00');
  await page.fill($('config-end'), '12:00');

  await page.fill(field, 'https://example.org/not-whatsapp'); // a wrong one is refused by name, and nothing is saved
  await page.click($('config-save'));
  await page.waitForSelector(`${$('config-error')}:not([hidden])`);
  assert.ok((await page.locator($('config-error')).getAttribute('data-fields')).includes('whatsappUrl'));
  assert.equal((await site.api.config()).config, null);

  await page.fill(field, `${LINK}?mode=ems_copy_t`); // a good one: the Test link appears, and it is saved in its plain form
  await page.waitForSelector(`${$('whatsapp-test')}:not([hidden])`);
  assert.deepEqual(await page.locator($('whatsapp-test')).evaluate((a) => [a.getAttribute('href'), a.target]), [`${LINK}?mode=ems_copy_t`, '_blank']);
  await page.click($('config-save'));
  await page.waitForSelector(`${$('config-success')}:not([hidden])`);
  assert.equal((await site.api.config()).config.whatsappUrl, LINK);

  await page.reload();
  await page.waitForSelector(`${$('game-status')}[data-status="pre"]`);
  assert.equal(await page.inputValue(field), LINK);

  await page.fill(field, ''); // and clearing it removes it
  await page.click($('config-save'));
  await page.waitForSelector(`${$('config-success')}:not([hidden])`);
  assert.equal('whatsappUrl' in (await site.api.config()).config, false);
});

withPage('the link cannot be edited while the game is in progress', {}, async ({ site, page }) => {
  await site.api.configure({ whatsappUrl: LINK });
  await page.goto(`${site.url}/game-config/?refresh=500`);
  await page.waitForSelector(`${$('game-status')}[data-status="active"]`);
  assert.equal(await page.locator($('config-whatsapp')).isDisabled(), true);
  assert.equal(await page.inputValue($('config-whatsapp')), LINK);
});

withPage('the scoring page links every mention of WhatsApp in its help text when a link is set', {}, async ({ site, page }) => {
  await site.api.configure({ whatsappUrl: LINK });
  await page.goto(`${site.url}/game-score/?refresh=500`);
  await page.waitForSelector(`${$('scoring-help')} a[data-whatsapp-link]`, { state: 'attached' });
  const found = await links(page, $('scoring-help'));
  const mentions = (await page.locator($('scoring-help')).innerText()).match(/whatsapp/gi).length;
  assert.ok(found.length >= 1 && found.length === mentions, `${found.length} links for ${mentions} mentions`);
  for (const link of found) assert.deepEqual([link.href, link.target], [LINK, '_blank']);
});

withPage('the scoring page leaves the mention as plain text when no link is set', {}, async ({ site, page, problems, cspViolations }) => {
  await site.api.configure();
  await page.goto(`${site.url}/game-score/?refresh=500`);
  await page.waitForSelector(`${$('scoring-notice')}`, { state: 'attached' });
  await new Promise((resolve) => setTimeout(resolve, 1000));
  assert.equal(await page.locator('a[data-whatsapp-link]').count(), 0);
  assert.match(await page.locator($('scoring-help')).innerText(), /WhatsApp/);
  assert.deepEqual(problems, []);
  assert.deepEqual(await cspViolations(), []);
});
