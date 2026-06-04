import { test, expect } from '@playwright/test';

test.describe('Ribbon Bar Interactions', () => {
  
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

  test('Adjusting Font Size via number input spinner in sidebar is stable for ribbon', async ({ page }) => {
    // Double click to enter text mode
    const firstBox = page.locator('svg.overlay-svg rect[data-box-id]').first();
    await firstBox.dblclick();
    
    // Target the pt input in the SIDEBAR
    const sidebarSizeInput = page.locator('scribus-input[data-property-key="font-size"] input[type="number"]');
    await expect(sidebarSizeInput).toBeVisible();
    
    // Get a handle to a ribbon element (scribus-font-selector) to detect re-renders
    const ribbonItem = page.locator('.ribbon-controls scribus-font-selector').first();
    await expect(ribbonItem).toBeVisible();
    
    const initialVal = await sidebarSizeInput.inputValue();
    console.log(`Initial Sidebar Size: ${initialVal}`);
    
    // Click the up button on the spinner
    const box = await sidebarSizeInput.boundingBox();
    if (box) {
      await page.mouse.click(box.x + box.width - 5, box.y + 5);
      
      const newVal = await sidebarSizeInput.inputValue();
      console.log(`New Sidebar Size: ${newVal}`);
      
      // Ribbon should NOT have re-rendered (preserved connection)
      const isConnected = await ribbonItem.evaluate(el => el.isConnected);
      console.log(`Ribbon item still connected after sidebar spinner click: ${isConnected}`);
      expect(isConnected).toBe(true);
    }
  });
});
