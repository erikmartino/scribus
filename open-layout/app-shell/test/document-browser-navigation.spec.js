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
    test(`app-shell page ${route} has app launcher with document browser link`, async ({ page }) => {
      const errors = attachConsoleLogging(page);
      await page.goto(route);
      await page.waitForSelector('scribus-app-shell:defined', { timeout: 20000 });

      const shell = page.locator('scribus-app-shell');

      // App launcher button should be visible
      const launcherBtn = shell.locator('#app-launcher-btn');
      await expect(launcherBtn).toBeVisible();

      // Menu should be hidden initially
      const menu = shell.locator('#app-launcher-menu');
      await expect(menu).not.toBeVisible();

      // Click launcher to open menu
      await launcherBtn.click();
      await expect(menu).toBeVisible();

      // Document Browser link should be present
      const browserLink = shell.locator('#document-browser-link');
      await expect(browserLink).toBeVisible();
      await expect(browserLink).toHaveAttribute('href', '/document-browser/');

      // Click the link to navigate
      await browserLink.click();
      await expect(page).toHaveURL(/\/document-browser\/(?:index\.html)?$/);
      await expect(page.locator('#template-grid')).toBeVisible({ timeout: 20000 });
      await expect(page.locator('scribus-dialog#clone-dialog')).toHaveCount(1);

      const realErrors = errors.filter(error => !error.includes('Failed to fetch') && !error.includes('/store/'));
      expect(realErrors).toHaveLength(0);
    });
  }

  test('app launcher menu closes on outside click', async ({ page }) => {
    const errors = attachConsoleLogging(page);
    await page.goto('/spread-editor/index.html');
    await page.waitForSelector('scribus-app-shell:defined', { timeout: 20000 });

    const shell = page.locator('scribus-app-shell');
    const launcherBtn = shell.locator('#app-launcher-btn');
    const menu = shell.locator('#app-launcher-menu');

    await launcherBtn.click();
    await expect(menu).toBeVisible();

    // Click outside the menu
    await page.mouse.click(400, 400);
    await expect(menu).not.toBeVisible();

    expect(errors).toHaveLength(0);
  });

  test('app launcher menu closes on Escape', async ({ page }) => {
    const errors = attachConsoleLogging(page);
    await page.goto('/spread-editor/index.html');
    await page.waitForSelector('scribus-app-shell:defined', { timeout: 20000 });

    const shell = page.locator('scribus-app-shell');
    const launcherBtn = shell.locator('#app-launcher-btn');
    const menu = shell.locator('#app-launcher-menu');

    await launcherBtn.click();
    await expect(menu).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(menu).not.toBeVisible();

    expect(errors).toHaveLength(0);
  });
});
