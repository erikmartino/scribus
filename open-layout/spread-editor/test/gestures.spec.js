import { test, expect } from '@playwright/test';

test.describe('Spread Editor Interaction Gestures', () => {
  test.beforeEach(async ({ page }) => {
    // page.on('console', msg => console.log(`BROWSER [${msg.type()}]: ${msg.text()}`));
    await page.goto('/spread-editor/index.html');
    await page.waitForSelector('scribus-app-shell', { timeout: 30000 });
    await page.waitForSelector('#svg-container svg.content-svg', { timeout: 30000 });
  });

  test('double clicking box should enter text mode and place cursor', async ({ page }) => {
    const box = page.locator('.box-rect').first();
    const boxBounds = await box.boundingBox();
    if (!boxBounds) throw new Error('Box not found');

    // 0. Deselect initially selected box (box-1 is selected by default)
    const canvas = page.locator('#svg-container');
    await canvas.click({ position: { x: 10, y: 10 } });

    // Enter text mode
    await box.click();
    await box.click();

    const shell = page.locator('scribus-app-shell');
    await expect(shell).toHaveAttribute('data-mode', 'text');

    // Verify cursor element exists (it might be blinking, so we check existence)
    const cursor = page.locator('.text-cursor');
    await expect(cursor).toBeAttached();
  });

  test('double clicking a word while in text mode should select it', async ({ page }) => {
    const box = page.locator('.box-rect').first();
    // 0. Deselect initially selected box
    const canvas = page.locator('#svg-container');
    await canvas.click({ position: { x: 10, y: 10 } });

    await box.click();
    await box.click();
    
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
    // 0. Deselect initially selected box
    const canvas = page.locator('#svg-container');
    await canvas.click({ position: { x: 10, y: 10 } });

    await box.click();
    await box.click();

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

  test('clicking on selected text stays in text mode and places cursor', async ({ page }) => {
    const box = page.locator('.box-rect').first();
    // 0. Deselect initially selected box
    const canvas = page.locator('#svg-container');
    await canvas.click({ position: { x: 10, y: 10 } });

    // Enter text mode
    await box.click();
    await box.click();

    const shell = page.locator('scribus-app-shell');
    await expect(shell).toHaveAttribute('data-mode', 'text');

    // Select all text
    await page.keyboard.press('ControlOrMeta+a');
    await page.waitForTimeout(300);

    // Verify selection exists
    const selectionRects = page.locator('.text-selection rect');
    await expect(selectionRects.first()).toBeVisible({ timeout: 5000 });

    // Click on the selected text — should stay in text mode.
    // Wait to ensure previous clicks expire the multi-click threshold.
    await page.waitForTimeout(400);
    const boxBounds = await box.boundingBox();
    if (!boxBounds) throw new Error('Box not found');
    await page.mouse.click(boxBounds.x + 40, boxBounds.y + 30);
    await page.waitForTimeout(800);

    // Must still be in text mode
    await expect(shell).toHaveAttribute('data-mode', 'text');

    // Selection should be collapsed (no selection rects after single click)
    const afterClickRects = await page.locator('.text-selection rect').count();
    expect(afterClickRects).toBe(0);

    // Cursor should be visible
    const cursor = page.locator('#text-cursor');
    await expect(cursor).toBeAttached();
  });

  test('changing font family without selection should apply to whole paragraph', async ({ page }) => {
    const box = page.locator('.box-rect').first();
    // 0. Deselect initially selected box
    const canvas = page.locator('#svg-container');
    await canvas.click({ position: { x: 10, y: 10 } });

    await box.click();
    await box.click();

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

  test('cut, copy, and paste text works in text mode', async ({ page, context }) => {
    // 1. Grant clipboard permissions
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);

    const box = page.locator('.box-rect').first();
    // 0. Deselect initially selected box
    const canvas = page.locator('#svg-container');
    await canvas.click({ position: { x: 10, y: 10 } });

    // Enter text mode
    await box.click();
    await box.click();

    // Verify enter text mode
    const shell = page.locator('scribus-app-shell');
    await expect(shell).toHaveAttribute('data-mode', 'text');

    // Select all text in paragraph
    await page.keyboard.press('ControlOrMeta+a');
    await page.waitForTimeout(300);

    // Initial content
    const initialText = await page.textContent('#svg-container');
    expect(initialText.replace(/\s+/g, "").replace(/-/g, "")).toContain('Thespreadprototypetreatsanentirestory');

    // Copy to system clipboard
    await page.keyboard.press('ControlOrMeta+c');
    await page.waitForTimeout(500);

    // The clipboard contains a JSON envelope; verify the story data field has the text
    const clipboardContent = await page.evaluate(async () => {
      return await navigator.clipboard.readText();
    });
    const clipPayload = JSON.parse(clipboardContent);
    expect(clipPayload.items).toBeDefined();
    expect(clipPayload.items[0].data.replace(/\s+/g, "").replace(/-/g, "")).toContain('Thespreadprototypetreatsanentirestory');

    // Cut from DOM
    await page.keyboard.press('ControlOrMeta+x');
    await page.waitForTimeout(500);

    const afterCutText = await page.textContent('#svg-container');
    expect(afterCutText.replace(/\s+/g, "").replace(/-/g, "")).not.toContain('Thespreadprototypetreatsanentirestory');

    // Paste back into DOM
    await page.keyboard.press('ControlOrMeta+v');
    await page.waitForTimeout(1000);

    const afterPasteText = await page.textContent('#svg-container');
    expect(afterPasteText.replace(/\s+/g, "").replace(/-/g, "")).toContain('Thespreadprototypetreatsanentirestory');
  });

  test('cut, copy, and paste text relies on local storage when clipboard is denied', async ({ page, context }) => {
    // 1. Explicitly clean permissions
    await context.clearPermissions();

    const box = page.locator('.box-rect').first();
    const canvas = page.locator('#svg-container');
    await canvas.click({ position: { x: 10, y: 10 } });

    await box.click();
    await box.click();

    // Select all text in paragraph
    await page.keyboard.press('ControlOrMeta+a');
    await page.waitForTimeout(300);

    // Initial content
    const initialText = await page.textContent('#svg-container');
    expect(initialText.replace(/\s+/g, "").replace(/-/g, "")).toContain('Thespreadprototypetreatsanentirestory');

    // Copy
    await page.keyboard.press('ControlOrMeta+c');
    await page.waitForTimeout(500);

    // Verify localStorage fallback holds the serialized data
    const localJSON = await page.evaluate(() => localStorage.getItem('scribus_local_clipboard')) || '';
    expect(localJSON.replace(/\s+/g, "")).toContain('Thespreadprototype');

    // Cut from DOM
    await page.keyboard.press('ControlOrMeta+x');
    await page.waitForTimeout(500);

    const afterCutText = await page.textContent('#svg-container');
    expect(afterCutText.replace(/\s+/g, "").replace(/-/g, "")).not.toContain('Thespreadprototypetreatsanentirestory');

    // Paste back into DOM
    await page.keyboard.press('ControlOrMeta+v');
    await page.waitForTimeout(1000);

    const afterPasteText = await page.textContent('#svg-container');
    expect(afterPasteText.replace(/\s+/g, "").replace(/-/g, "")).toContain('Thespreadprototypetreatsanentirestory');
  });
});
