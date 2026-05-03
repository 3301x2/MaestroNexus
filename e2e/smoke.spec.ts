import { test, expect } from '@playwright/test';
import fs from 'fs';
test('smoke: home loads', async ({ page }) => {
  const url = process.env.SMOKE_URL || 'http://localhost:3000';
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await expect(page).toHaveTitle(/.+/);
  fs.mkdirSync('e2e/artifacts', { recursive: true });
  await page.screenshot({ path: 'e2e/artifacts/smoke-home.png', fullPage: true });
});
