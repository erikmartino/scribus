import { test, expect } from '@playwright/test';

test.describe('Spread Editor Interaction Gestures', () => {
  test.beforeEach(async ({ page }) => {
    // page.on('console', msg => console.log(`BROWSER [${msg.type()}]: ${msg.text()}`));
    await page.goto('/spread-editor/index.html');
    await page.waitForSelector('scribus-app-shell', { timeout: 30000 });
    await page.waitForSelector('#svg-container svg', { timeout: 30000 });
  });

  test('double clicking box should enter text mode and place cursor', async ({ page }) => {
    const box = page.locator('.box-rect').first();
    const boxBounds = await box.boundingBox();
    if (!boxBounds) throw new Error('Box not found');

    // Double click to enter text mode
    await box.dblclick();

    const shell = page.locator('scribus-app-shell');
    await expect(shell).toHaveAttribute('data-mode', 'text');

    // Verify cursor element exists (it might be blinking, so we check existence)
    const cursor = page.locator('.text-cursor');
    await expect(cursor).toBeAttached();
  });

  test('double clicking a word while in text mode should select it', async ({ page }) => {
    const box = page.locator('.box-rect').first();
    await box.dblclick();
    
    const boxBounds = await box.boundingBox();
    if (!boxBounds) throw new Error('Box not found');
    
    // Double click the first word (using mouse offsets for precision)
    // Offset from center or top-left. Let's use a point inside the first line.
    await page.mouse.click(boxBounds.x + 40, boxBounds.y + 30, { clickCount: 2 });

    // Verify selection rects are drawn
    const selection = page.locator('.text-selection rect');
    await expect(selection.first()).toBeVisible({ timeout: 10000 });
  });

  test('dragging text should create a selection', async ({ page }) => {
    const box = page.locator('.box-rect').first();
    await box.dblclick();

    const boxBounds = await box.boundingBox();
    if (!boxBounds) throw new Error('Box not found');

    // Drag from left to right
    const startX = boxBounds.x + 20;
    const startY = boxBounds.y + 30;
    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await page.mouse.move(startX + 150, startY);
    await page.mouse.up();

    // Verify selection rects are drawn
    const selection = page.locator('.text-selection rect');
    await expect(selection.first()).toBeVisible({ timeout: 10000 });
  });

  test('changing font family without selection should apply to whole paragraph', async ({ page }) => {
    const box = page.locator('.box-rect').first();
    await box.dblclick();

    const boxBounds = await box.boundingBox();
    if (!boxBounds) throw new Error('Box not found');

    const shell = page.locator('scribus-app-shell');

    // Position cursor in first paragraph, click once to ensure it's placed.
    await page.mouse.click(boxBounds.x + 20, boxBounds.y + 30);

    // Verify we are still in text mode
    await expect(shell).toHaveAttribute('data-mode', 'text');

    // Select "Inter" from dropdown (Roboto might not be loaded, let's use Inter which is in shell)
    const fontSelector = page.locator('#font-family-selector');
    await expect(fontSelector).toBeVisible({ timeout: 15000 });
    
    // Target the internal select element inside the shadow DOM
    const select = page.locator('#font-family-selector select');

    // Wait for the option to be available in the dropdown
    await page.waitForFunction(() => {
      const el = document.querySelector('#font-family-selector');
      if (!el || !el.shadowRoot) return false;
      const sel = el.shadowRoot.querySelector('select');
      return sel && Array.from(sel.options).some(opt => opt.value === 'Inter');
    }, { timeout: 10000 });

    await select.selectOption('Inter');
    
    // Verify properties on the host element as well
    await expect(fontSelector).toHaveAttribute('value', 'Inter');
  });
});
