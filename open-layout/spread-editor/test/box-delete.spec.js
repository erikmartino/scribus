import { test, expect } from '@playwright/test';

test.describe('Text Frame Deletion', () => {
  test.beforeEach(async ({ page }) => {
    page.on('console', msg => {
      console.log(`BROWSER [${msg.type()}]: ${msg.text()}`);
    });
    page.on('pageerror', err => {
      console.error(`BROWSER [error]: ${err.message}`);
    });

    await page.goto('/spread-editor/index.html');
    await page.waitForSelector('scribus-app-shell:defined');
    const statusEl = page.locator('#status');
    await expect(statusEl).toHaveText(/Ready/, { timeout: 20000 });
  });

  test('Delete button is visible in the ribbon', async ({ page }) => {
    const deleteBtn = page.locator('scribus-button[label="Delete"]');
    await expect(deleteBtn).toBeVisible();
  });

  test('clicking Delete removes the selected text frame', async ({ page }) => {
    // Create a new text frame so we have a deletable box that is not a default
    const trigger = page.locator('scribus-create-menu button.trigger');
    await trigger.click();
    await page.locator('.scribus-create-menu-item', { hasText: 'Text Frame' }).click();
    await page.waitForTimeout(500);

    // Creating a text frame now enters text mode; press Escape to return
    // to object mode so the frame is selected and deletable.
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);

    const before = await page.evaluate(() => {
      const svg = document.querySelector('#svg-container svg');
      return svg.querySelectorAll('[data-handle="body"]').length;
    });

    // The newly created frame is selected; click Delete
    const deleteBtn = page.locator('scribus-button[label="Delete"]');
    await deleteBtn.click();
    await page.waitForTimeout(500);

    const after = await page.evaluate(() => {
      const svg = document.querySelector('#svg-container svg');
      return svg.querySelectorAll('[data-handle="body"]').length;
    });
    expect(after).toBe(before - 1);
  });

  test('Backspace key deletes selected frame in object mode', async ({ page }) => {
    // Create a new text frame
    const trigger = page.locator('scribus-create-menu button.trigger');
    await trigger.click();
    await page.locator('.scribus-create-menu-item', { hasText: 'Text Frame' }).click();
    await page.waitForTimeout(500);

    // Exit text mode so Backspace triggers frame deletion, not text editing
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);

    const before = await page.evaluate(() => {
      const svg = document.querySelector('#svg-container svg');
      return svg.querySelectorAll('[data-handle="body"]').length;
    });

    // Press Backspace in object mode
    await page.keyboard.press('Backspace');
    await page.waitForTimeout(500);

    const after = await page.evaluate(() => {
      const svg = document.querySelector('#svg-container svg');
      return svg.querySelectorAll('[data-handle="body"]').length;
    });
    expect(after).toBe(before - 1);
  });

  test('deleting a text frame also removes its story', async ({ page }) => {
    // Create a new text frame
    const trigger = page.locator('scribus-create-menu button.trigger');
    await trigger.click();
    await page.locator('.scribus-create-menu-item', { hasText: 'Text Frame' }).click();
    await page.waitForTimeout(500);

    // Exit text mode so Backspace triggers frame deletion
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);

    const before = await page.evaluate(() => {
      const app = window.scribusShell?.plugins?.find(p => p._stories !== undefined);
      return app?._stories.length;
    });
    expect(before).toBe(2);

    // Delete it
    await page.keyboard.press('Backspace');
    await page.waitForTimeout(500);

    const after = await page.evaluate(() => {
      const app = window.scribusShell?.plugins?.find(p => p._stories !== undefined);
      return app?._stories.length;
    });
    expect(after).toBe(1);
  });

  test('delete is undoable', async ({ page }) => {
    // Create a new text frame
    const trigger = page.locator('scribus-create-menu button.trigger');
    await trigger.click();
    await page.locator('.scribus-create-menu-item', { hasText: 'Text Frame' }).click();
    await page.waitForTimeout(500);

    const before = await page.evaluate(() => {
      const svg = document.querySelector('#svg-container svg');
      return svg.querySelectorAll('[data-handle="body"]').length;
    });

    // Delete it
    await page.keyboard.press('Backspace');
    await page.waitForTimeout(500);

    // Undo
    await page.keyboard.press('ControlOrMeta+KeyZ');
    await page.waitForTimeout(500);

    const afterUndo = await page.evaluate(() => {
      const svg = document.querySelector('#svg-container svg');
      return svg.querySelectorAll('[data-handle="body"]').length;
    });
    expect(afterUndo).toBe(before);
  });

  test('deleting an image frame removes it', async ({ page }) => {
    // Create an image frame
    const trigger = page.locator('scribus-create-menu button.trigger');
    await trigger.click();
    await page.locator('.scribus-create-menu-item', { hasText: 'Image Frame' }).click();
    await expect(page.locator('[data-image-box="true"]')).toHaveCount(1, { timeout: 5000 });

    // It should be selected; delete it
    await page.keyboard.press('Backspace');
    await page.waitForTimeout(500);

    await expect(page.locator('[data-image-box="true"]')).toHaveCount(0);
  });

  test('delete does nothing in text mode', async ({ page }) => {
    // Enter text mode on first box (click twice)
    const boxInfo = await page.evaluate(() => {
      const svg = document.querySelector('#svg-container svg');
      const body = svg.querySelector('[data-box-id="p1-c1"][data-handle="body"]');
      const rect = body.getBoundingClientRect();
      return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
    });

    await page.mouse.click(boxInfo.x, boxInfo.y);
    await page.waitForTimeout(200);
    await page.mouse.click(boxInfo.x, boxInfo.y);
    await page.waitForTimeout(300);

    const mode = await page.evaluate(() => {
      const app = window.scribusShell?.plugins?.find(p => p._stories !== undefined);
      return app?.mode;
    });
    expect(mode).toBe('text');

    const before = await page.evaluate(() => {
      const svg = document.querySelector('#svg-container svg');
      return svg.querySelectorAll('[data-handle="body"]').length;
    });

    // Backspace in text mode should NOT delete the frame
    // (it should be handled by the text editor instead)
    await page.keyboard.press('Backspace');
    await page.waitForTimeout(500);

    const after = await page.evaluate(() => {
      const svg = document.querySelector('#svg-container svg');
      return svg.querySelectorAll('[data-handle="body"]').length;
    });
    expect(after).toBe(before);
  });
});
