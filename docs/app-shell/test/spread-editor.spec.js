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
});
