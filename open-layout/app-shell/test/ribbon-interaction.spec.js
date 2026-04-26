import { test, expect } from '@playwright/test';

test.describe('Ribbon Bar Interactions', () => {
  
  test.beforeEach(async ({ page }) => {
    page.on('console', msg => {
      console.log(`BROWSER [${msg.type()}]: ${msg.text()}`);
    });
    page.on('pageerror', err => {
      console.error(`BROWSER [error]: ${err.message}`);
    });
  });

  test('Changing Font Size slider in Spread Editor is stable and connected', async ({ page }) => {
    await page.goto('/spread-editor/index.html');
    
    // Double click the text frame to enter text mode
    // We'll use a coordinate that hits the Typography Sampler box
    await page.mouse.dblclick(200, 300);
    
    // Wait for the ribbon slider to appear
    const sizeSlider = page.locator('scribus-input#font-size input[type="range"]');
    await expect(sizeSlider).toBeVisible();
    
    const initialValue = await sizeSlider.inputValue();
    console.log(`Initial Font Size: ${initialValue}`);
    
    // Check attachment status during drag
    const box = await sizeSlider.boundingBox();
    if (!box) throw new Error('Could not find slider bounding box');

    const startX = box.x + box.width / 2;
    const centerY = box.y + box.height / 2;

    await page.mouse.move(startX, centerY);
    await page.mouse.down();
    
    // Move to trigger updates
    await page.mouse.move(startX + 50, centerY);
    
    // The key test: is the element still connected? 
    // If it was destroyed and recreated, isConnected would be false (for the original handle we had)
    // or the drag would have been interrupted.
    const isConnected = await sizeSlider.evaluate(el => el.isConnected);
    console.log(`Slider isConnected during drag: ${isConnected}`);
    
    await page.mouse.up();
    
    const finalValue = await sizeSlider.inputValue();
    console.log(`Final Font Size: ${finalValue}`);
    
    expect(isConnected).toBe(true);
    expect(Number(finalValue)).toBeGreaterThan(Number(initialValue));
  });

  test('Font Size label has fixed width prevent jumping', async ({ page }) => {
    await page.goto('/spread-editor/index.html');
    await page.mouse.dblclick(200, 300);
    
    const valDisplay = page.locator('scribus-input#font-size .val');
    await expect(valDisplay).toBeVisible();
    
    const styles = await valDisplay.evaluate(el => {
      const s = window.getComputedStyle(el);
      return {
        minWidth: s.minWidth,
        display: s.display,
        textAlign: s.textAlign
      };
    });
    
    console.log('Val display styles:', styles);
    expect(styles.minWidth).not.toBe('0px');
    expect(styles.display).toMatch(/block|inline-block/);
  });

  test('Adjusting Font Size via number input spinner in sidebar is stable for ribbon', async ({ page }) => {
    await page.goto('/spread-editor/index.html');
    
    // Double click to enter text mode
    const firstBox = page.locator('svg.overlay-svg rect[data-box-id]').first();
    await firstBox.dblclick();
    
    // Target the pt input in the SIDEBAR
    const sidebarSizeInput = page.locator('scribus-input[data-property-key="font-size"] input[type="number"]');
    await expect(sidebarSizeInput).toBeVisible();
    
    // Get a handle to a ribbon element to detect re-renders
    const ribbonItem = page.locator('.ribbon-controls scribus-input').first();
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
