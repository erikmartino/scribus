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

  test('Typing multi-digit value in Size field works and is not reset', async ({ page }) => {
    await page.goto('/spread-editor/index.html');
    await page.waitForSelector('#svg-container svg.overlay-svg');
    
    console.log('Entering text mode by double-clicking the first text box...');
    const firstBox = page.locator('svg.overlay-svg rect[data-box-id]').first();
    await firstBox.dblclick();
    
    // Wait for properties panel to show 'Typography' or 'Paragraph' or precisely our font-size input
    console.log('Waiting for Font Size input...');
    const sizeInputHost = page.locator('scribus-input[data-property-key="font-size"]');
    
    // We might need to wait for the panel to update
    await expect(sizeInputHost).toBeVisible({ timeout: 15000 });
    
    const input = sizeInputHost.locator('input');
    await input.click();
    
    // Select all and clear
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A');
    await page.keyboard.press('Backspace');
    
    console.log('Typing 24...');
    await page.keyboard.type('24', { delay: 50 });
    
    let val = await input.inputValue();
    console.log(`Value while typing: ${val}`);
    
    // In our new implementation, it should NOT have updated yet (no re-render)
    // and the value should be "24" because we are still focused.
    
    await page.keyboard.press('Enter');
    
    val = await input.inputValue();
    console.log(`Final Value: ${val}`);
    expect(val).toBe('24');
    
    // VERIFY BI-DIRECTIONAL SYNC: The ribbon slider should also be 24 now
    console.log('Verifying ribbon sync...');
    const ribbonSlider = page.locator('scribus-input#font-size input[type="range"]');
    
    // Wait a bit for reconciliation to complete
    await page.waitForTimeout(200); 
    
    const sliderVal = await ribbonSlider.inputValue();
    console.log(`Current Ribbon Slider Value: ${sliderVal}`);
    
    await page.screenshot({ path: 'sync-debug.png' });
    
    await expect(ribbonSlider).toHaveValue('24', { timeout: 5000 });
    console.log(`Ribbon Slider accurately synced to: 24`);
  });

  test('Typing in sidebar does not cause ribbon flicker', async ({ page }) => {
    await page.goto('/spread-editor/index.html');
    
    const firstBox = page.locator('svg.overlay-svg rect[data-box-id]').first();
    await firstBox.dblclick();
    
    const sizeInputHost = page.locator('scribus-input[data-property-key="font-size"]');
    await expect(sizeInputHost).toBeVisible();
    
    // Get a handle to a ribbon element to detect re-renders
    const ribbonItem = page.locator('.ribbon-controls scribus-input').first();
    await expect(ribbonItem).toBeVisible();
    
    const wasConnected = await ribbonItem.evaluate(el => el.isConnected);
    expect(wasConnected).toBe(true);
    
    // Focus sidebar input
    const input = sizeInputHost.locator('input');
    await input.click();
    
    // Type something
    await page.keyboard.type('2');
    
    // Because of our guard, the ribbon should NOT have re-rendered
    // (If it had, the original ribbonItem we have a reference to would be disconnected)
    const isStillConnected = await ribbonItem.evaluate(el => el.isConnected);
    console.log(`Ribbon item still connected after sidebar typing: ${isStillConnected}`);
    expect(isStillConnected).toBe(true);
  });
});
