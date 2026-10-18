import { test, expect } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { checkoutJourney } from '../fixtures/checkout.journey.js';

const peleGlobal = fileURLToPath(import.meta.resolve('pele/global'));

// Replace with page.goto('/') once the app has a dev server.
test('mounts a journey diagram in the browser', async ({ page }) => {
  await page.setContent('<div id="diagram"></div>');
  await page.addScriptTag({ path: peleGlobal });
  await page.evaluate((src) => window.pele.mount(document.getElementById('diagram'), src), checkoutJourney);

  const svg = page.locator('#diagram svg.pele-journey');
  await expect(svg).toBeVisible();
  await expect(svg).toContainText('Find product');
  await expect(svg).toContainText('Enter card');
});
