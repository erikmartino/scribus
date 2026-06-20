import { test, expect } from '@playwright/test';

test.describe('Spread Editor', () => {
  test('should load without console errors', async ({ page }) => {
    const errors = [];
    page.on('console', msg => {
      console.log(`[BROWSER CONSOLE] ${msg.type()}: ${msg.text()}`);
      if (msg.type() === 'error') {
        errors.push(msg.text());
      }
    });

    page.on('requestfailed', request => {
      console.error(`[REQUEST FAILED] ${request.url()}: ${request.failure()?.errorText || 'Unknown error'}`);
      errors.push(`${request.url()} failed: ${request.failure()?.errorText}`);
    });

    await page.goto('/spread-editor/index.html');

    // Wait for the status element to show "Ready"
    const statusEl = page.locator('#status');
    await expect(statusEl).toBeVisible({ timeout: 15000 });
    await expect(statusEl).toHaveText(/Ready/, { timeout: 20000 });

    const statusText = await statusEl.innerText();
    console.log(`Final Spread Editor Status: ${statusText}`);

    // If it's an error, it will show up in the console.
    expect(errors).toHaveLength(0);
  });

  test('should apply font size to all selected paragraphs and preserve selection', async ({ page }) => {
    // Forward browser logs for diagnostics (from rule)
    page.on('console', msg => {
      console.log(`BROWSER [${msg.type()}]: ${msg.text()}`);
    });
    page.on('pageerror', err => {
      console.error(`BROWSER [error]: ${err.message}`);
    });

    await page.goto('/spread-editor/index.html');

    // Wait for the status element to show "Ready"
    const statusEl = page.locator('#status');
    await expect(statusEl).toBeVisible({ timeout: 15000 });
    await expect(statusEl).toHaveText(/Ready/, { timeout: 20000 });

    // Click the first text box to enter text mode
    const firstBox = page.locator('svg.overlay-svg rect.box-rect').first();
    await firstBox.click();

    // Check that we are in text mode
    await expect(page.locator('scribus-app-shell')).toHaveAttribute('data-mode', 'text');

    // Select all text
    await page.keyboard.press('ControlOrMeta+a');
    await page.waitForTimeout(200);

    // Verify selection exists
    const selectionGroup = page.locator('#svg-container svg.content-svg #text-selection rect');
    await expect(selectionGroup.first()).toBeVisible();
    const beforeCount = await selectionGroup.count();
    expect(beforeCount).toBeGreaterThan(0);

    // Find the font size input in the properties panel
    const fontSizeInput = page.locator('scribus-input[data-property-key="font-size"] input');
    await fontSizeInput.fill('35');
    await fontSizeInput.press('Enter');
    await page.waitForTimeout(500);

    // Verify selection STILL exists (not reset)
    const afterCount = await selectionGroup.count();
    expect(afterCount).toBeGreaterThan(0);

    // Verify all tspans have the updated font size
    const tspans = page.locator('#svg-container svg.content-svg text tspan');
    const tspanCount = await tspans.count();
    expect(tspanCount).toBeGreaterThan(0);

    for (let i = 0; i < tspanCount; i++) {
      const fsAttr = await tspans.nth(i).getAttribute('font-size');
      expect(fsAttr).toBe('35');
    }
  });
});
