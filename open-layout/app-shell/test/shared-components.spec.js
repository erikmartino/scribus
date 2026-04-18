import { test, expect } from '@playwright/test';

/**
 * Tests for the shared UI components: <scribus-status-bar> and <scribus-dialog>.
 * Also verifies that the .info-card CSS from shell.css applies correctly.
 */

function setupConsoleLogging(page) {
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

// -- Status bar across all demos --

test.describe('scribus-status-bar', () => {
  test('spread-editor status bar renders and shows Ready', async ({ page }) => {
    const errors = setupConsoleLogging(page);
    await page.goto('/spread-editor/index.html');

    const status = page.locator('scribus-status-bar#status');
    await expect(status).toBeVisible({ timeout: 15000 });
    await expect(status).toHaveText(/Ready/, { timeout: 20000 });

    expect(errors).toHaveLength(0);
  });

  test('document-browser status bar renders', async ({ page }) => {
    const errors = setupConsoleLogging(page);
    await page.goto('/document-browser/index.html');

    const status = page.locator('scribus-status-bar#status');
    await expect(status).toBeVisible({ timeout: 10000 });
    // May show "Ready" or "Error" depending on whether the store server is running
    await expect(status).not.toBeEmpty();

    // Filter out expected fetch failures (store may not be running)
    const realErrors = errors.filter(e => !e.includes('Failed to fetch') && !e.includes('/store/'));
    expect(realErrors).toHaveLength(0);
  });

  test('story-editor status bar renders', async ({ page }) => {
    const errors = setupConsoleLogging(page);
    await page.goto('/story-editor/index.html');

    const status = page.locator('scribus-status-bar#status');
    await expect(status).toBeVisible({ timeout: 15000 });
    await expect(status).toHaveText(/Ready|Loading/, { timeout: 20000 });

    expect(errors).toHaveLength(0);
  });
});

// -- Dialog component --

test.describe('scribus-dialog', () => {
  test('document-browser clone dialog opens and closes', async ({ page }) => {
    const errors = setupConsoleLogging(page);
    await page.goto('/document-browser/index.html');

    // Wait for the page to load and render template cards
    await page.waitForSelector('scribus-app-shell:defined', { timeout: 10000 });

    // The dialog should start hidden (no open attribute)
    const dialog = page.locator('scribus-dialog#clone-dialog');
    await expect(dialog).not.toHaveAttribute('open');

    // If there is a "Use Template" button, click it to open the dialog
    const useTemplateBtn = page.locator('button.primary:has-text("Use Template")').first();
    const hasBtns = await useTemplateBtn.count();
    if (hasBtns > 0) {
      await useTemplateBtn.click();

      // Dialog should now be open
      await expect(dialog).toHaveAttribute('open', '');

      // Should contain an input field
      const nameInput = page.locator('#clone-name-input');
      await expect(nameInput).toBeVisible();

      // Close via Escape
      await page.keyboard.press('Escape');
      await expect(dialog).not.toHaveAttribute('open');
    }

    const realErrors = errors.filter(e => !e.includes('Failed to fetch') && !e.includes('/store/'));
    expect(realErrors).toHaveLength(0);
  });
});

// -- Info card CSS --

test.describe('info-card shared CSS', () => {
  test('spread-editor info cards have correct styling from shell.css', async ({ page }) => {
    const errors = setupConsoleLogging(page);
    await page.goto('/spread-editor/index.html');

    await page.waitForSelector('scribus-app-shell:defined', { timeout: 10000 });

    const card = page.locator('.info-card').first();
    // Card may be in the side panel; check it exists
    const count = await card.count();
    if (count > 0) {
      const border = await card.evaluate(el => getComputedStyle(el).borderStyle);
      expect(border).toBe('solid');

      const bg = await card.evaluate(el => getComputedStyle(el).backgroundColor);
      // Should have the transparent glass background from shell.css
      expect(bg).toContain('rgba');
    }

    expect(errors).toHaveLength(0);
  });
});

// -- App shell demo (no status bar) loads cleanly --

test.describe('app-shell demo', () => {
  test('loads without console errors', async ({ page }) => {
    const errors = setupConsoleLogging(page);
    await page.goto('/app-shell/index.html');

    await page.waitForSelector('scribus-app-shell:defined', { timeout: 10000 });
    await page.waitForSelector('.selectable', { timeout: 5000 });

    expect(errors).toHaveLength(0);
  });
});
