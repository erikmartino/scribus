
import { test, expect } from '@playwright/test';

test.describe('Reproduction: Property Panel Sync', () => {
  
  test('Property group labels and row labels update when switching selection', async ({ page }) => {
    page.on('console', msg => console.log(`BROWSER [${msg.type()}]: ${msg.text()}`));
    await page.goto('/spread-editor/index.html');
    
    // Open Properties tab
    await page.click('button[data-panel-id="properties"]');
    
    // Verify initial state
    const firstHeading = page.locator('.property-group-heading').first();
    await expect(firstHeading).toHaveText('Spread Info');
    
    // 1. Select a text frame (p1-c1)
    const box1 = page.locator('#svg-container svg.overlay-svg [data-box-id="p1-c1"][data-handle="body"]');
    await box1.click();
    
    // Should change to something else (Text Frame or Text Mode)
    // We wait for it to NOT be "Spread Info"
    await expect(firstHeading).not.toHaveText('Spread Info');
    
    const text = await firstHeading.textContent();
    console.log('Heading after click:', text);
    
    // 2. Double click to enter text mode (if not already)
    if (text !== 'Text Mode') {
      await box1.dblclick();
      await expect(firstHeading).toHaveText('Text Mode');
    }

    // 3. Exit text mode back to object mode
    await page.keyboard.press('Escape');
    // It should go back to "Text Frame" (or "Spread Info" if selection cleared, but Escape usually just exits mode)
    await expect(firstHeading).not.toHaveText('Text Mode');
  });
});
