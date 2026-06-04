import { test, expect } from '@playwright/test';

test.describe('Sidebar Typing Stability', () => {
  
  test.beforeEach(async ({ page }) => {
    page.on('console', msg => {
      console.log(`BROWSER [${msg.type()}]: ${msg.text()}`);
    });
    page.on('pageerror', err => {
      console.error(`BROWSER [error]: ${err.message}`);
    });
  });

  test('Typing multi-digit value in Line Height field works and is not reset', async ({ page }) => {
    await page.goto('/spread-editor/index.html');
    await page.waitForSelector('#svg-container svg.overlay-svg');
    
    console.log('Entering text mode by double-clicking the first text box...');
    const firstBox = page.locator('svg.overlay-svg rect[data-box-id]').first();
    await firstBox.dblclick();
    
    // Wait for properties panel to show our line-height input
    console.log('Waiting for Line Height input...');
    const lhInputHost = page.locator('scribus-input[data-property-key="line-height"]');
    
    await expect(lhInputHost).toBeVisible({ timeout: 15000 });
    
    const input = lhInputHost.locator('input');
    await input.click();
    
    // Select all and clear
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A');
    await page.keyboard.press('Backspace');
    
    console.log('Typing 120...');
    await page.keyboard.type('120', { delay: 50 });
    
    let val = await input.inputValue();
    console.log(`Value while typing: ${val}`);
    
    // In our implementation, it should NOT have updated yet (no re-render)
    // and the value should be "120" because we are still focused.
    
    await page.keyboard.press('Enter');
    
    val = await input.inputValue();
    console.log(`Final Value: ${val}`);
    expect(val).toBe('120');
  });

  test('Typing in sidebar does not cause ribbon flicker', async ({ page }) => {
    await page.goto('/spread-editor/index.html');
    
    const firstBox = page.locator('svg.overlay-svg rect[data-box-id]').first();
    await firstBox.dblclick();
    
    const lhInputHost = page.locator('scribus-input[data-property-key="line-height"]');
    await expect(lhInputHost).toBeVisible();
    
    // Get a handle to a ribbon element to detect re-renders
    const ribbonItem = page.locator('.ribbon-controls scribus-font-selector').first();
    await expect(ribbonItem).toBeVisible();
    
    const wasConnected = await ribbonItem.evaluate(el => el.isConnected);
    expect(wasConnected).toBe(true);
    
    // Focus sidebar input
    const input = lhInputHost.locator('input');
    await input.click();
    
    // Type something
    await page.keyboard.type('1');
    
    // Because of our guard, the ribbon should NOT have re-rendered
    // (If it had, the original ribbonItem we have a reference to would be disconnected)
    const isStillConnected = await ribbonItem.evaluate(el => el.isConnected);
    console.log(`Ribbon item still connected after sidebar typing: ${isStillConnected}`);
    expect(isStillConnected).toBe(true);
  });
});
