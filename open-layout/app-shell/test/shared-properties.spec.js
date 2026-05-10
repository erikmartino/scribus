import { test, expect } from '@playwright/test';

test.describe('Shared Properties Panel', () => {
  
  test.beforeEach(async ({ page }) => {
    page.on('console', msg => {
      console.log(`BROWSER [${msg.type()}]: ${msg.text()}`);
    });
    page.on('pageerror', err => {
      console.error(`BROWSER [error]: ${err.message}`);
    });
  });

  test('Story Editor shows text properties', async ({ page }) => {
    // Story editor demo
    await page.goto('/story-editor/index.html');
    
    // Open Properties tab (should be open by default, but we click to be sure)
    const tab = page.locator('button.panel-tab:has-text("Properties")');
    await tab.waitFor({ state: 'visible' });
    await tab.click();
    
    // Verify Typography group exists
    const typography = page.locator('.property-group-heading:has-text("Typography")');
    await expect(typography).toBeVisible();
    
    // Verify Paragraph group exists
    const paragraph = page.locator('.property-group-heading:has-text("Paragraph")');
    await expect(paragraph).toBeVisible();
    
    // Change Font Size via input
    const sizeInput = page.locator('.property-row[data-property-key="font-size"] input');
    await sizeInput.fill('30');
    await sizeInput.press('Enter');
    
    // In story editor, font size change should trigger a re-layout.
    // Check if the input value stuck (bidirectional sync check)
    await expect(sizeInput).toHaveValue('30');
  });

  test('Spread Editor shows box properties then text properties', async ({ page }) => {
    await page.goto('/spread-editor/index.html');
    
    // Open Properties tab
    await page.click('button[data-panel="properties"]');
    
    // By default, no box is selected (or Spread Info is shown)
    const spreadInfo = page.locator('.property-group-heading:has-text("Spread Info")');
    await expect(spreadInfo).toBeVisible();
    
    // Select p1-c2 to trigger a fresh update
    // We use evaluate to be 100% sure the selection happens regardless of SVG clickability
    await page.evaluate(() => {
      const item = window.shell.doc.get('p1-c2');
      window.shell.selection.select(item);
    });
    
    // Should show Text Frame group or Text Mode
    const heading = page.locator('.property-group-heading:has-text("Text Frame"), .property-group-heading:has-text("Text Mode")').first();
    await expect(heading).toBeVisible();
    
    // Verify X/Y properties
    const xInput = page.locator('.property-row[data-property-key="x"] input');
    await expect(xInput).toBeVisible();
    
    // Change X
    await xInput.fill('100');
    await xInput.press('Enter');
    
    // Double click to enter text mode
    await page.dblclick('#svg-container svg.overlay-svg [data-id="box-1"]');
    
    // Properties should now show Typography/Paragraph
    const typography = page.locator('.property-group-heading:has-text("Typography")');
    await expect(typography).toBeVisible();
  });
});
