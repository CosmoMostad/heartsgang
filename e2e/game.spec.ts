import { expect, test } from '@playwright/test';
import { actIfAsked, createGame, handCards, joinByLink, newPlayer } from './helpers';

test('home page offers create and join', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: /Hearts\s+Gang/ })).toBeVisible();
  await expect(page.locator('#create-btn')).toBeVisible();
  await expect(page.locator('#join-btn')).toBeDisabled();
  await page.click('#create-btn');
  await expect(page.locator('#name')).toBeFocused();
  await expect(page.getByText('Enter a name first.')).toBeVisible();
});

test('a wrong code explains itself', async ({ page }) => {
  await page.goto('/');
  await page.fill('#name', 'Lost');
  await page.locator('#code-0').pressSequentially('000000');
  await page.click('#join-btn');
  await expect(page.getByText(/No game with code 000000/)).toBeVisible();
});

test('friends join by code, team up in one seat, and play as a team', async ({ browser, page }) => {
  const code = await createGame(page, 'Olly', 'street');

  // Sam uses the invite link and joins Olly's seat; Kim types the code on the home page.
  const sam = await joinByLink(browser, code, 'Sam');
  await sam.click('[data-join-seat="0"]');
  await expect(page.locator('.seat-card').first()).toContainText('Sam');
  const kim = await newPlayer(browser);
  await kim.goto('/');
  await kim.fill('#name', 'Kim');
  await kim.locator('#code-0').pressSequentially(code);
  await expect(kim.locator('#table-code')).toHaveText(new RegExp(code.slice(0, 3)));
  await expect(page.locator('.seat-card').nth(1)).toContainText('Kim');

  // Start needs every seat filled.
  await expect(page.locator('#start-btn')).toBeDisabled();
  await page.getByRole('button', { name: 'or add bots' }).click();
  await page.click('#start-btn');
  await expect(page.locator('.hand-card')).toHaveCount(13);
  await expect(sam.locator('.hand-card')).toHaveCount(13);

  // Teammates see the same hand; opponents see their own.
  const oursOlly = await handCards(page);
  expect(await handCards(sam)).toEqual(oursOlly);
  expect((await handCards(kim)).some((c) => oursOlly.includes(c))).toBe(false);

  // Olly highlights a card: it lifts on Sam's screen with Olly's marker. Kim sees nothing.
  await page.locator('.hand-card').last().click();
  await expect(sam.locator('.hand-card.raised .marker')).toHaveText('O');
  await expect(kim.locator('.hand-card.raised')).toHaveCount(0);

  // Team chat reaches the teammate only.
  await page.getByRole('tab', { name: /Team/ }).click();
  await page.fill('#chat-input', 'pass the ace?');
  await page.keyboard.press('Enter');
  await sam.getByRole('tab', { name: /Team/ }).click();
  await expect(sam.locator('.messages')).toContainText('pass the ace?');
  await expect(kim.getByRole('tab', { name: /Team/ })).toHaveCount(0);
  await expect(kim.locator('.messages')).not.toContainText('pass the ace?');

  // Sam finishes the pick and presses Pass for the team.
  await sam.locator('.hand-card:not(.raised)').nth(0).click();
  await expect(sam.locator('#pass-btn')).toBeDisabled();
  await sam.locator('.hand-card:not(.raised)').nth(0).click();
  await expect(sam.locator('#pass-btn')).toBeEnabled();
  const passed = await sam.locator('.hand-card.raised [data-card]').evaluateAll((els) => els.map((e) => e.getAttribute('data-card')));
  await sam.click('#pass-btn');
  await expect(page.getByText(/Passed\. Waiting for/)).toBeVisible();

  // Kim passes; cards change hands and the received ones are tagged.
  for (let i = 0; i < 3; i++) await kim.locator('.hand-card:not(.raised)').first().click();
  await kim.click('#pass-btn');
  await expect(page.locator('.new-tag')).toHaveCount(3);
  const after = await handCards(page);
  for (const c of passed) expect(after).not.toContain(c);

  // Play a few tricks for the humans; cards land on the table.
  for (let i = 0; i < 40 && (await page.locator('.hand-card').count()) > 10; i++) {
    await actIfAsked(page);
    await actIfAsked(kim);
    await page.waitForTimeout(120);
  }
  expect(await page.locator('.hand-card').count()).toBeLessThanOrEqual(10);
  await expect(page.locator('.seat .plate-score .total').first()).toBeVisible();

  // Emotes pop over the sender's seat for everyone.
  await kim.getByRole('button', { name: 'Send 🔥' }).click();
  await expect(page.locator('.emote-bubble')).toContainText('🔥');
});

test('a whole game with bots runs to the winner screen, then plays again', async ({ page }) => {
  test.setTimeout(240_000);
  await createGame(page, 'Solo', 'classic', ['#rule-target-50', '#rule-play-timer-0', '#rule-pass-timer-0']);
  await page.getByRole('button', { name: 'or add bots' }).click();
  await page.click('#start-btn');
  await expect(page.locator('.hand-card')).toHaveCount(13);
  let sawSummary = false;
  const deadline = Date.now() + 220_000;
  while (Date.now() < deadline) {
    if (await page.locator('.panel.gameover').count()) break;
    if (await page.locator('.panel.summary').count()) sawSummary = true;
    await actIfAsked(page);
    await page.waitForTimeout(60);
  }
  await expect(page.locator('.panel.gameover')).toBeVisible();
  await expect(page.locator('.panel.gameover h3')).toContainText(/win/);
  expect(sawSummary).toBe(true);
  await page.getByRole('button', { name: 'Play again' }).click();
  await expect(page.locator('.chip.strong')).toHaveText('Hand 1');
  await expect(page.locator('.plate-score .total').first()).toHaveText('0');
});

test('reloading the page puts you back in your seat with your hand', async ({ page }) => {
  await createGame(page, 'Reloader', 'classic', ['#rule-play-timer-0', '#rule-pass-timer-0']);
  await page.getByRole('button', { name: 'or add bots' }).click();
  await page.click('#start-btn');
  await expect(page.locator('.hand-card')).toHaveCount(13);
  const before = await handCards(page);
  await page.reload();
  await expect(page.locator('.hand-card')).toHaveCount(13);
  expect(await handCards(page)).toEqual(before);
});

test('the six-seat table fits a phone screen', async ({ browser }) => {
  const phone = await newPlayer(browser, { width: 390, height: 844 });
  await createGame(phone, 'Phone', 'six', ['#rule-play-timer-0']);
  await phone.getByRole('button', { name: 'or add bots' }).click();
  await phone.click('#start-btn');
  await expect(phone.locator('.hand-card')).toHaveCount(8);
  const fits = await phone.evaluate(() => {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const cards = [...document.querySelectorAll('.hand-card')].map((e) => e.getBoundingClientRect());
    const seats = [...document.querySelectorAll('.seat .plate')].map((e) => e.getBoundingClientRect());
    return {
      noSideScroll: document.documentElement.scrollWidth <= vw + 1,
      cardsOnScreen: cards.every((r) => r.left >= -2 && r.right <= vw + 2 && r.bottom <= vh + 2),
      seatsOnScreen: seats.every((r) => r.left >= -2 && r.right <= vw + 2 && r.top >= -2),
      seats: seats.length,
    };
  });
  expect(fits).toEqual({ noSideScroll: true, cardsOnScreen: true, seatsOnScreen: true, seats: 6 });
  await expect(phone.locator('#pass-btn')).toBeVisible();
});
