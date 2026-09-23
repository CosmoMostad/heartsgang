import { expect, type Browser, type Page } from '@playwright/test';

export async function createGame(page: Page, name: string, mode = 'street', clicks: string[] = []): Promise<string> {
  await page.goto('/');
  await page.fill('#name', name);
  await page.click('#create-btn');
  await page.click(`#mode-${mode}`);
  for (const id of clicks) await page.click(id);
  await page.click('#create-table-btn');
  const code = (await page.locator('#table-code').textContent())!.replace(/\D/g, '');
  expect(code).toMatch(/^\d{6}$/);
  return code;
}

export async function newPlayer(browser: Browser, viewport = { width: 1366, height: 820 }): Promise<Page> {
  const ctx = await browser.newContext({ viewport });
  return ctx.newPage();
}

export async function joinByLink(browser: Browser, code: string, name: string, viewport?: { width: number; height: number }): Promise<Page> {
  const page = await newPlayer(browser, viewport);
  await page.goto(`/${code}`);
  await page.fill('#name', name);
  await page.click('#join-btn');
  await expect(page.locator('#table-code')).toBeVisible();
  return page;
}

export async function handCards(page: Page): Promise<string[]> {
  return page.locator('.hand-card [data-card]').evaluateAll((els) => els.map((e) => e.getAttribute('data-card')!));
}

/** Act for this page's seat if it has something to do: pick and pass, or pick and play. Returns true if it acted. */
export async function actIfAsked(page: Page): Promise<boolean> {
  const pass = page.locator('#pass-btn');
  if (await pass.count()) {
    const raised = await page.locator('.hand-card.raised').count();
    const need = Number((await pass.textContent())!.match(/\d/)![0]);
    if (raised < need) {
      await page.locator('.hand-card:not(.raised)').last().click();
      await expect(page.locator('.hand-card.raised')).toHaveCount(raised + 1).catch(() => {});
      return true;
    }
    if (await pass.isEnabled()) { await pass.click(); return true; }
    return false;
  }
  const play = page.locator('#play-btn');
  if (await play.count()) {
    if (!(await play.isEnabled())) {
      const legal = page.locator('.hand-card:not(.illegal)');
      if (await legal.count()) {
        await legal.first().click();
        await expect(play).toBeEnabled({ timeout: 3000 }).catch(() => {});
      }
      return true;
    }
    await play.click();
    return true;
  }
  return false;
}
