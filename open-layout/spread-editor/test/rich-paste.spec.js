import { test, expect } from '@playwright/test';

function forwardBrowserLogs(page) {
  page.on('console', msg => console.log(`BROWSER [${msg.type()}]: ${msg.text()}`));
  page.on('pageerror', err => console.error(`BROWSER [error]: ${err.message}`));
}

test.describe('Spread Editor Rich Paste', () => {
  test.beforeEach(async ({ page, context }) => {
    forwardBrowserLogs(page);
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await page.goto('/spread-editor/index.html');
    await page.waitForSelector('scribus-app-shell', { timeout: 30000 });
    await page.waitForSelector('#svg-container svg', { timeout: 30000 });
  });

  test('pasting HTML with bold/italic in text mode preserves styling', async ({ page }) => {
    // Enter text mode
    const box = page.locator('.box-rect').first();
    const canvas = page.locator('#svg-container');
    await canvas.click({ position: { x: 10, y: 10 } });
    await box.click();
    await box.click();
    const shell = page.locator('scribus-app-shell');
    await expect(shell).toHaveAttribute('data-mode', 'text');

    // Place cursor at end
    await page.keyboard.press('ControlOrMeta+End');
    await page.waitForTimeout(300);

    // Write rich HTML to the clipboard
    await page.evaluate(async () => {
      const html = '<p>Rich <b>bold</b> and <i>italic</i> text</p>';
      const blob = new Blob([html], { type: 'text/html' });
      const plainBlob = new Blob(['Rich bold and italic text'], { type: 'text/plain' });
      const item = new ClipboardItem({
        'text/html': blob,
        'text/plain': plainBlob,
      });
      await navigator.clipboard.write([item]);
    });

    await page.keyboard.press('ControlOrMeta+v');
    await page.waitForTimeout(1000);

    // Check that the SVG contains bold and italic tspans
    const tspanInfo = await page.evaluate(() => {
      const svg = document.querySelector('#svg-container svg');
      const tspans = svg.querySelectorAll('tspan');
      return Array.from(tspans).map(ts => ({
        text: ts.textContent,
        fontWeight: ts.getAttribute('font-weight'),
        fontStyle: ts.getAttribute('font-style'),
      }));
    });

    const boldSpans = tspanInfo.filter(t => t.fontWeight === 'bold');
    const italicSpans = tspanInfo.filter(t => t.fontStyle === 'italic');
    expect(boldSpans.length).toBeGreaterThan(0);
    expect(italicSpans.length).toBeGreaterThan(0);
  });

  test('pasting image in object mode creates SVG image element with resize handles', async ({ page }) => {
    const shell = page.locator('scribus-app-shell');

    // Click background to ensure we're in object mode
    const canvas = page.locator('#svg-container');
    await canvas.click({ position: { x: 10, y: 10 } });
    await expect(shell).toHaveAttribute('data-mode', 'object');

    // Write a small PNG to the clipboard (50x50 red pixel)
    await page.evaluate(async () => {
      const c = document.createElement('canvas');
      c.width = 50; c.height = 50;
      const ctx = c.getContext('2d');
      ctx.fillStyle = 'red';
      ctx.fillRect(0, 0, 50, 50);
      const blob = await new Promise(r => c.toBlob(r, 'image/png'));
      const item = new ClipboardItem({ 'image/png': blob });
      await navigator.clipboard.write([item]);
    });

    await page.keyboard.press('ControlOrMeta+v');
    await page.waitForTimeout(1500);

    // Check for an SVG <image> element
    const imgCount = await page.evaluate(() => {
      const svg = document.querySelector('#svg-container svg');
      return svg.querySelectorAll('image[data-image-box]').length;
    });
    expect(imgCount).toBeGreaterThan(0);

    // Verify resize handles are drawn for the image box
    const handleInfo = await page.evaluate(() => {
      const svg = document.querySelector('#svg-container svg');
      // Find the box-id of the image box overlay
      const imageBoxRect = svg.querySelector('[data-box-id^="image-"]');
      if (!imageBoxRect) return { boxId: null, handleCount: 0 };
      const boxId = imageBoxRect.dataset.boxId;
      const handles = svg.querySelectorAll(`[data-sublayer="handles"] [data-box-id="${boxId}"]`);
      return { boxId, handleCount: handles.length };
    });
    expect(handleInfo.boxId).toBeTruthy();
    expect(handleInfo.handleCount).toBe(8); // 8 resize handles (nw, n, ne, w, e, sw, s, se)
  });

  test('pasted image in object mode survives click interaction', async ({ page }) => {
    const shell = page.locator('scribus-app-shell');

    // Ensure object mode
    const canvas = page.locator('#svg-container');
    await canvas.click({ position: { x: 10, y: 10 } });
    await expect(shell).toHaveAttribute('data-mode', 'object');

    // Paste a 50x50 image
    await page.evaluate(async () => {
      const c = document.createElement('canvas');
      c.width = 50; c.height = 50;
      const ctx = c.getContext('2d');
      ctx.fillStyle = 'green';
      ctx.fillRect(0, 0, 50, 50);
      const blob = await new Promise(r => c.toBlob(r, 'image/png'));
      const item = new ClipboardItem({ 'image/png': blob });
      await navigator.clipboard.write([item]);
    });

    await page.keyboard.press('ControlOrMeta+v');
    await page.waitForTimeout(1500);

    // Confirm image exists
    let imgCount = await page.evaluate(() => {
      const svg = document.querySelector('#svg-container svg');
      return svg.querySelectorAll('image[data-image-box]').length;
    });
    expect(imgCount).toBe(1);

    // Click on the image box overlay (the box-rect with image- prefix id)
    const imageOverlay = page.locator('[data-box-id^="image-"][data-handle="body"]');
    await imageOverlay.click();
    await page.waitForTimeout(500);

    // Image should still exist after click
    imgCount = await page.evaluate(() => {
      const svg = document.querySelector('#svg-container svg');
      return svg.querySelectorAll('image[data-image-box]').length;
    });
    expect(imgCount).toBe(1);

    // Click on the background
    await canvas.click({ position: { x: 10, y: 10 } });
    await page.waitForTimeout(500);

    // Image should still exist after background click
    imgCount = await page.evaluate(() => {
      const svg = document.querySelector('#svg-container svg');
      return svg.querySelectorAll('image[data-image-box]').length;
    });
    expect(imgCount).toBe(1);
  });

  test('pasting image in text mode inserts inline image placeholder', async ({ page }) => {
    // Enter text mode
    const box = page.locator('.box-rect').first();
    const canvas = page.locator('#svg-container');
    await canvas.click({ position: { x: 10, y: 10 } });
    await box.click();
    await box.click();
    const shell = page.locator('scribus-app-shell');
    await expect(shell).toHaveAttribute('data-mode', 'text');

    // Write a small PNG to the clipboard
    await page.evaluate(async () => {
      const c = document.createElement('canvas');
      c.width = 30; c.height = 30;
      const ctx = c.getContext('2d');
      ctx.fillStyle = 'blue';
      ctx.fillRect(0, 0, 30, 30);
      const blob = await new Promise(r => c.toBlob(r, 'image/png'));
      const item = new ClipboardItem({ 'image/png': blob });
      await navigator.clipboard.write([item]);
    });

    await page.keyboard.press('ControlOrMeta+v');
    await page.waitForTimeout(1500);

    // Check for an SVG <image> element (inline image rendered by svg-renderer)
    const imgCount = await page.evaluate(() => {
      const svg = document.querySelector('#svg-container svg');
      return svg.querySelectorAll('image').length;
    });
    expect(imgCount).toBeGreaterThan(0);
  });
});
