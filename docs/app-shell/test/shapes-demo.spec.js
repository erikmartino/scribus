import { test, expect } from '@playwright/test';

test.describe('Shapes Demo Integration', () => {
  test.beforeEach(async ({ page }) => {
    // Navigate to the app shell
    await page.goto('http://localhost:8000/app-shell/');
    // Wait for the shell and initial shapes to be ready
    await page.waitForSelector('scribus-app-shell:defined');
    await page.waitForSelector('.selectable');
  });

  test('selecting a shape updates the panels', async ({ page }) => {
    // Click the circle
    const circle = page.locator('.selectable.circle').first();
    await circle.click();
    
    // Check if it is visually selected
    await expect(circle).toHaveClass(/selected/);
    
    // Check properties panel input value
    const titleInput = page.locator('scribus-input[label="Title"] input');
    await expect(titleInput).toHaveValue('Circle');
  });

  test('marquee selection integrates with shell events', async ({ page }) => {
    // Get coordinates of the circle and square to ensure we encompass them
    const circleBox = await page.locator('.selectable.circle').boundingBox();
    const squareBox = await page.locator('.selectable.square').boundingBox();
    
    // Drag from well before the circle to well after the square
    await page.mouse.move(circleBox.x - 20, circleBox.y - 20);
    await page.mouse.down();
    await page.mouse.move(squareBox.x + squareBox.width + 20, squareBox.y + squareBox.height + 20);
    await page.mouse.up();
    
    // Check if at least one shape is selected
    const selectedCount = await page.locator('.selectable.selected').count();
    expect(selectedCount).toBeGreaterThanOrEqual(1);
  });

  test('copy and paste duplicates a shape', async ({ page }) => {
    const circle = page.locator('.selectable.circle').first();
    await circle.click();
    
    const countBefore = await page.locator('.selectable').count();
    
    // Perform copy and paste
    await page.keyboard.press('ControlOrMeta+KeyC');
    await page.keyboard.press('ControlOrMeta+KeyV');
    
    // Wait for the new shape to appear
    await expect(page.locator('.selectable')).toHaveCount(countBefore + 1);
  });

  test('delete and undo restores the shape', async ({ page }) => {
    const square = page.locator('.selectable.square').first();
    await square.click();
    
    // Use the Delete ribbon button
    const deleteBtn = page.locator('scribus-button[label="Delete"]');
    await deleteBtn.click();
    
    await expect(square).not.toBeAttached();
    
    // Use the Undo ribbon button
    const undoBtn = page.locator('scribus-button[label="Undo"]');
    await undoBtn.click();
    
    await expect(square).toBeAttached();
  });
});
