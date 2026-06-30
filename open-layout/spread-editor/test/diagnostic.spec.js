import { test } from '@playwright/test';

test('diagnose moby-dick page 5', async ({ page }) => {
  page.on('console', msg => console.log(`BROWSER [${msg.type()}]: ${msg.text()}`));
  page.on('pageerror', err => console.error(`BROWSER [error]: ${err.message}`));

  await page.goto('/spread-editor/index.html?doc=alice/moby-dick&page=5');
  await page.waitForTimeout(5000);
});
