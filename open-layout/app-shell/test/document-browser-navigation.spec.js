import { test, expect } from '@playwright/test';

function attachConsoleLogging(page) {
  const errors = [];
  page.on('console', msg => {
    console.log(`BROWSER [${msg.type()}]: ${msg.text()}`);
    if (msg.type() === 'error') errors.push(msg.text());
  });
  page.on('pageerror', err => {
    console.error(`BROWSER [error]: ${err.message}`);
    errors.push(err.message);
  });
  return errors;
}

const appRoutes = [
  '/spread-editor/index.html',
  '/document-store/index.html',
  '/story-editor/index.html',
];

test.describe('global document browser navigation', () => {
  for (const route of appRoutes) {
    test(`app-shell page ${route} provides a working document browser link`, async ({ page }) => {
      const errors = attachConsoleLogging(page);
      await page.goto(route);
      await page.waitForSelector('scribus-app-shell:defined', { timeout: 20000 });

      const browserLink = page.locator('#document-browser-link');
      await expect(browserLink).toBeVisible();
      await expect(browserLink).toHaveAttribute('href', '/document-browser/');

      await browserLink.click();
      await expect(page).toHaveURL(/\/document-browser\/(?:index\.html)?$/);
      await expect(page.locator('#template-grid')).toBeVisible({ timeout: 20000 });
      await expect(page.locator('scribus-dialog#clone-dialog')).toHaveCount(1);

      const realErrors = errors.filter(error => !error.includes('Failed to fetch') && !error.includes('/store/'));
      expect(realErrors).toHaveLength(0);
    });
  }
});
