import { test, expect } from '@playwright/test';

test.describe('Spread Editor Create Menu', () => {
  test.beforeEach(async ({ page }) => {
    page.on('console', msg => {
      console.log(`BROWSER [${msg.type()}]: ${msg.text()}`);
    });
    page.on('pageerror', err => {
      console.error(`BROWSER [error]: ${err.message}`);
    });

    await page.goto('/spread-editor/index.html');
    await page.waitForSelector('scribus-app-shell:defined');
    // Wait until the engine has fully loaded
    const statusEl = page.locator('#status');
    await expect(statusEl).toHaveText(/Ready/, { timeout: 20000 });
  });

  test('create menu is visible in the ribbon', async ({ page }) => {
    const createMenu = page.locator('scribus-create-menu');
    await expect(createMenu).toBeVisible();
  });

  test('dropdown lists Text Frame and Image Frame', async ({ page }) => {
    const trigger = page.locator('scribus-create-menu button.trigger');
    await trigger.click();

    const dropdown = page.locator('.scribus-create-dropdown');
    await expect(dropdown).toBeVisible();

    const items = page.locator('.scribus-create-menu-item');
    await expect(items).toHaveCount(2);
    await expect(items.nth(0)).toContainText('Text Frame');
    await expect(items.nth(1)).toContainText('Image Frame');
  });

  test('creating a text frame adds a new box overlay', async ({ page }) => {
    // Count unique box IDs before
    const countBefore = await page.evaluate(() => {
      const svg = document.querySelector('#svg-container svg');
      if (!svg) return 0;
      const ids = new Set();
      svg.querySelectorAll('[data-box-id]').forEach(el => ids.add(el.dataset.boxId));
      return ids.size;
    });

    const trigger = page.locator('scribus-create-menu button.trigger');
    await trigger.click();

    const textFrameItem = page.locator('.scribus-create-menu-item', { hasText: 'Text Frame' });
    await textFrameItem.click();

    // Wait for update and verify a new unique box ID appeared
    await expect(async () => {
      const countAfter = await page.evaluate(() => {
        const svg = document.querySelector('#svg-container svg');
        if (!svg) return 0;
        const ids = new Set();
        svg.querySelectorAll('[data-box-id]').forEach(el => ids.add(el.dataset.boxId));
        return ids.size;
      });
      expect(countAfter).toBe(countBefore + 1);
    }).toPass({ timeout: 5000 });
  });

  test('creating a text frame is undoable', async ({ page }) => {
    const boxIdsBefore = await page.evaluate(() => {
      const overlays = document.querySelector('#svg-container svg');
      if (!overlays) return [];
      const ids = new Set();
      overlays.querySelectorAll('[data-box-id]').forEach(el => ids.add(el.dataset.boxId));
      return [...ids];
    });

    const trigger = page.locator('scribus-create-menu button.trigger');
    await trigger.click();
    const textFrameItem = page.locator('.scribus-create-menu-item', { hasText: 'Text Frame' });
    await textFrameItem.click();

    // Wait for the new box to appear
    await page.waitForTimeout(500);

    const boxIdsAfter = await page.evaluate(() => {
      const overlays = document.querySelector('#svg-container svg');
      if (!overlays) return [];
      const ids = new Set();
      overlays.querySelectorAll('[data-box-id]').forEach(el => ids.add(el.dataset.boxId));
      return [...ids];
    });

    expect(boxIdsAfter.length).toBe(boxIdsBefore.length + 1);

    // Undo
    await page.keyboard.press('ControlOrMeta+KeyZ');
    await page.waitForTimeout(500);

    const boxIdsUndo = await page.evaluate(() => {
      const overlays = document.querySelector('#svg-container svg');
      if (!overlays) return [];
      const ids = new Set();
      overlays.querySelectorAll('[data-box-id]').forEach(el => ids.add(el.dataset.boxId));
      return [...ids];
    });

    expect(boxIdsUndo.length).toBe(boxIdsBefore.length);
  });

  test('creating an image frame adds a new box with image', async ({ page }) => {
    const trigger = page.locator('scribus-create-menu button.trigger');
    await trigger.click();

    const imageFrameItem = page.locator('.scribus-create-menu-item', { hasText: 'Image Frame' });
    await imageFrameItem.click();

    // Wait for update - an image element should appear in the SVG
    await expect(page.locator('[data-image-box="true"]')).toHaveCount(1, { timeout: 5000 });
  });

  test('dropdown closes after creating a frame', async ({ page }) => {
    const trigger = page.locator('scribus-create-menu button.trigger');
    await trigger.click();

    const dropdown = page.locator('.scribus-create-dropdown');
    await expect(dropdown).toBeVisible();

    const textFrameItem = page.locator('.scribus-create-menu-item', { hasText: 'Text Frame' });
    await textFrameItem.click();

    await expect(dropdown).toBeHidden();
  });
});
