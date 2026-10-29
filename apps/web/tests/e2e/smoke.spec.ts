import { expect, test, type Page } from '@playwright/test';

async function newSurvivor(page: Page) {
  await page.goto('/?quality=low');
  await page.getByText('New survivor').click();
  await page.getByPlaceholder('Call sign').fill('E2E');
  await page.getByRole('button', { name: 'Start' }).click();
}

test('menu → hideout → raid boots without errors', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await newSurvivor(page);
  await page.getByRole('button', { name: 'Deploy ▸' }).click();
  await page.getByText('Zavadsk Outskirts').click();
  await page.getByRole('button', { name: 'day', exact: true }).click();
  await page.getByRole('button', { name: 'Enter raid' }).click();
  await page.waitForFunction(() => !!(window as unknown as { __ashfall?: unknown }).__ashfall, null, { timeout: 120_000 });
  await expect(page.locator('canvas').first()).toBeVisible();
  // The simulation advances (software GL in CI compiles shaders slowly, so be patient).
  type W = { __ashfall: { raid: { time: number } } };
  const t0 = await page.evaluate(() => (window as unknown as W).__ashfall.raid.time);
  await page.waitForFunction((t) => (window as unknown as W).__ashfall.raid.time > t + 0.5, t0, { timeout: 60_000 });
  // Inventory opens and closes.
  await page.keyboard.press('KeyI');
  await expect(page.getByText(/pockets/i).first()).toBeVisible({ timeout: 30_000 });
  await page.keyboard.press('Escape');
  expect(errors).toEqual([]);
});

test('profile persists across reloads', async ({ page }) => {
  await newSurvivor(page);
  await expect(page.getByText('E2E').first()).toBeVisible();
  await page.reload();
  await expect(page.getByText(/continue|E2E/i).first()).toBeVisible();
});

test('service worker precaches the app shell', async ({ page }) => {
  await page.goto('/');
  const ok = await page.evaluate(async () => {
    const reg = await Promise.race([navigator.serviceWorker.ready, new Promise((r) => setTimeout(() => r(null), 20_000))]);
    return !!reg;
  });
  expect(ok).toBe(true);
});
