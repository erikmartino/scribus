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

test.describe('root index page', () => {
  test('loads and displays heading and document browser button', async ({ page }) => {
    const errors = attachConsoleLogging(page);
    await page.goto('/');

    await expect(page).toHaveTitle('Open Layout');
    await expect(page.locator('h1')).toHaveText('Open Layout');

    const btn = page.locator('#document-browser-btn');
    await expect(btn).toBeVisible();
    await expect(btn).toHaveAttribute('href', 'document-browser/');

    expect(errors).toHaveLength(0);
  });

  test('document browser button navigates to document browser', async ({ page }) => {
    const errors = attachConsoleLogging(page);
    await page.goto('/');

    const btn = page.locator('#document-browser-btn');
    await btn.click();
    await expect(page).toHaveURL(/\/document-browser\/(?:index\.html)?$/);
    await expect(page.locator('#template-grid')).toBeVisible({ timeout: 20000 });

    const realErrors = errors.filter(e => !e.includes('Failed to fetch') && !e.includes('/store/'));
    expect(realErrors).toHaveLength(0);
  });

  test('displays dynamic directory listing with key entries', async ({ page }) => {
    const errors = attachConsoleLogging(page);
    await page.goto('/');

    // Wait for the directory listing to populate
    const listing = page.locator('#dir-listing');
    await expect(listing.locator('li')).not.toHaveCount(0, { timeout: 5000 });

    // Verify key directories are listed
    await expect(page.locator('#dir-listing a[href="app-shell/"]')).toBeVisible();
    await expect(page.locator('#dir-listing a[href="spread-editor/"]')).toBeVisible();
    await expect(page.locator('#dir-listing a[href="story-editor/"]')).toBeVisible();
    await expect(page.locator('#dir-listing a[href="document-browser/"]')).toBeVisible();

    // Verify files are also listed
    await expect(page.locator('#dir-listing a[href="server.js"]')).toBeVisible();
    await expect(page.locator('#dir-listing a[href="package.json"]')).toBeVisible();

    expect(errors).toHaveLength(0);
  });
});
