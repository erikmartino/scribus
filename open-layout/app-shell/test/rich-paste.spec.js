import { test, expect } from '@playwright/test';

function forwardBrowserLogs(page) {
  page.on('console', msg => console.log(`BROWSER [${msg.type()}]: ${msg.text()}`));
  page.on('pageerror', err => console.error(`BROWSER [error]: ${err.message}`));
}

test.describe('Rich Text Paste', () => {
  test.beforeEach(async ({ page, context }) => {
    forwardBrowserLogs(page);
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await page.goto('/story-editor/index.html');
    await page.waitForSelector('#svg-container', { timeout: 60000 });
    await page.waitForSelector('#svg-container svg text', { timeout: 60000 });
  });

  test('pasting HTML with bold preserves bold styling', async ({ page }) => {
    const editor = page.locator('#svg-container');
    await editor.focus();

    // Select all and delete to start fresh
    await page.keyboard.press('ControlOrMeta+a');
    await page.keyboard.press('Backspace');
    await page.waitForTimeout(500);

    // Simulate pasting HTML with bold text via the clipboard service
    // We inject HTML directly into the paste handler via dispatchEvent
    await page.evaluate(async () => {
      const html = '<p>Hello <b>bold world</b></p>';
      const blob = new Blob([html], { type: 'text/html' });
      const plainBlob = new Blob(['Hello bold world'], { type: 'text/plain' });
      const item = new ClipboardItem({
        'text/html': blob,
        'text/plain': plainBlob,
      });
      await navigator.clipboard.write([item]);
    });

    await page.keyboard.press('ControlOrMeta+v');
    await page.waitForTimeout(1000);

    // Check that the SVG contains text with both plain and bold tspans
    const tspanInfo = await page.evaluate(() => {
      const svg = document.querySelector('#svg-container svg');
      const tspans = svg.querySelectorAll('tspan');
      return Array.from(tspans).map(ts => ({
        text: ts.textContent,
        fontWeight: ts.getAttribute('font-weight'),
      }));
    });

    // Should have at least one bold tspan
    const boldSpans = tspanInfo.filter(t => t.fontWeight === 'bold');
    expect(boldSpans.length).toBeGreaterThan(0);

    // The bold tspan should contain "bold world" (or parts of it)
    const boldText = boldSpans.map(t => t.text).join('');
    expect(boldText).toContain('bold');
  });
});
