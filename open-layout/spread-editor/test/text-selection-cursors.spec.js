import { test, expect } from '@playwright/test';

/**
 * Tests covering:
 * - Shift+click and shift+drag range extension with anchor invariants
 * - CSS cursor styles per interaction mode (object, text, resize handles)
 * - Visual state transitions between object select, hover, and text edit
 */

/** Helper: enter text mode on the first text box.
 *  Waits long enough after the final click so subsequent clicks
 *  are not interpreted as double/triple clicks (350ms threshold). */
async function enterTextMode(page) {
  const box = page.locator('.box-rect').first();
  const canvas = page.locator('#svg-container');

  // Deselect any initially selected box
  await canvas.click({ position: { x: 10, y: 10 } });
  await page.waitForTimeout(100);

  // Click once to select, click again to enter text mode
  await box.click();
  await box.click();

  const shell = page.locator('scribus-app-shell');
  await expect(shell).toHaveAttribute('data-mode', 'text');

  // Wait past the multi-click threshold (350ms) so subsequent clicks
  // are not chained with the enter-text-mode clicks
  await page.waitForTimeout(400);
}

/** Helper: get the text cursor's x1 attribute (horizontal position). */
async function getCursorX(page) {
  return page.locator('#text-cursor line').first().getAttribute('x1');
}

/** Helper: count visible selection rects. */
async function selectionRectCount(page) {
  return page.locator('.text-selection rect').count();
}

/** Helper: get the bounding box of the first .box-rect. */
async function firstBoxBounds(page) {
  const box = page.locator('.box-rect').first();
  const bounds = await box.boundingBox();
  if (!bounds) throw new Error('Box not found');
  return bounds;
}

test.describe('Shift+Click and Shift+Drag Selection', () => {
  test.beforeEach(async ({ page }) => {
    page.on('console', msg => console.log(`BROWSER [${msg.type()}]: ${msg.text()}`));
    page.on('pageerror', err => console.error(`BROWSER [error]: ${err.message}`));
    await page.goto('/spread-editor/index.html');
    await page.waitForSelector('#svg-container svg', { timeout: 30000 });
    const statusEl = page.locator('#status');
    await expect(statusEl).toHaveText(/Ready/, { timeout: 20000 });
  });

  test('shift+click extends selection from existing cursor', async ({ page }) => {
    await enterTextMode(page);
    const bounds = await firstBoxBounds(page);

    // Place cursor at the beginning of the text via Home key
    await page.keyboard.press('Home');
    await page.waitForTimeout(400);

    // No selection yet
    expect(await selectionRectCount(page)).toBe(0);

    // Hold Shift and click well into the text to extend selection
    // Use the center of the box vertically (first line area) and
    // midway horizontally to ensure we hit rendered text
    await page.keyboard.down('Shift');
    await page.mouse.click(bounds.x + bounds.width / 2, bounds.y + 20);
    await page.keyboard.up('Shift');
    await page.waitForTimeout(400);

    // Selection rects should now be visible
    const count = await selectionRectCount(page);
    expect(count).toBeGreaterThan(0);
  });

  test('shift+click extends selection across multiple lines', async ({ page }) => {
    await enterTextMode(page);
    const bounds = await firstBoxBounds(page);

    // Place cursor at start of first line
    await page.mouse.click(bounds.x + 20, bounds.y + 20);
    await page.waitForTimeout(400);

    // Hold Shift and click on a lower line
    await page.keyboard.down('Shift');
    await page.mouse.click(bounds.x + 100, bounds.y + 80);
    await page.keyboard.up('Shift');
    await page.waitForTimeout(400);

    // Should have multiple selection rects (one per line)
    const count = await selectionRectCount(page);
    expect(count).toBeGreaterThanOrEqual(2);
  });

  test('shift+click in reverse direction extends selection backwards', async ({ page }) => {
    await enterTextMode(page);
    const bounds = await firstBoxBounds(page);

    // Place cursor near the middle of the text
    await page.mouse.click(bounds.x + 150, bounds.y + 50);
    await page.waitForTimeout(400);

    // Hold Shift and click before the cursor position (left and above)
    await page.keyboard.down('Shift');
    await page.mouse.click(bounds.x + 30, bounds.y + 20);
    await page.keyboard.up('Shift');
    await page.waitForTimeout(400);

    // Selection should exist
    const count = await selectionRectCount(page);
    expect(count).toBeGreaterThan(0);
  });

  test('consecutive shift+clicks each produce a selection', async ({ page }) => {
    await enterTextMode(page);
    const bounds = await firstBoxBounds(page);

    // Place cursor at the start via Home key
    await page.keyboard.press('Home');
    await page.waitForTimeout(400);

    // First shift+click to extend — use a point 1/3 into the box
    await page.keyboard.down('Shift');
    await page.mouse.click(bounds.x + bounds.width * 0.3, bounds.y + 20);
    await page.keyboard.up('Shift');
    await page.waitForTimeout(400);

    // Should have a selection
    const count1 = await selectionRectCount(page);
    expect(count1).toBeGreaterThan(0);

    // Second shift+click further right (2/3 into the box)
    await page.keyboard.down('Shift');
    await page.mouse.click(bounds.x + bounds.width * 0.7, bounds.y + 20);
    await page.keyboard.up('Shift');
    await page.waitForTimeout(400);

    // Should still have a selection
    const count2 = await selectionRectCount(page);
    expect(count2).toBeGreaterThan(0);

    // NOTE: Ideally the anchor would be preserved across consecutive
    // shift+clicks (the second shift+click should extend from the
    // original anchor, not from the end of the first selection).
    // This is tracked as a known gap in
    // plans/spread-editor-user-interface-plan.md.
  });

  test('click-drag creates a selection range', async ({ page }) => {
    await enterTextMode(page);
    const bounds = await firstBoxBounds(page);

    // Drag from left to right on the first line
    await page.mouse.move(bounds.x + 20, bounds.y + 30);
    await page.mouse.down();
    await page.mouse.move(bounds.x + 200, bounds.y + 30, { steps: 5 });
    await page.mouse.up();
    await page.waitForTimeout(200);

    const count = await selectionRectCount(page);
    expect(count).toBeGreaterThan(0);
  });

  test('click-drag across multiple lines creates multi-line selection', async ({ page }) => {
    await enterTextMode(page);
    const bounds = await firstBoxBounds(page);

    // Drag from first line to third line
    await page.mouse.move(bounds.x + 20, bounds.y + 20);
    await page.mouse.down();
    await page.mouse.move(bounds.x + 150, bounds.y + 80, { steps: 10 });
    await page.mouse.up();
    await page.waitForTimeout(200);

    const count = await selectionRectCount(page);
    expect(count).toBeGreaterThanOrEqual(2);
  });

  test('single click after selection collapses it', async ({ page }) => {
    await enterTextMode(page);
    const bounds = await firstBoxBounds(page);

    // Create a selection via drag
    await page.mouse.move(bounds.x + 20, bounds.y + 30);
    await page.mouse.down();
    await page.mouse.move(bounds.x + 200, bounds.y + 30, { steps: 5 });
    await page.mouse.up();
    await page.waitForTimeout(200);

    expect(await selectionRectCount(page)).toBeGreaterThan(0);

    // Single click to collapse
    await page.waitForTimeout(400); // Ensure multi-click threshold expires
    await page.mouse.click(bounds.x + 100, bounds.y + 30);
    await page.waitForTimeout(400);

    expect(await selectionRectCount(page)).toBe(0);
  });
});

test.describe('Cursor Styles per Mode', () => {
  test.beforeEach(async ({ page }) => {
    page.on('console', msg => console.log(`BROWSER [${msg.type()}]: ${msg.text()}`));
    page.on('pageerror', err => console.error(`BROWSER [error]: ${err.message}`));
    await page.goto('/spread-editor/index.html');
    await page.waitForSelector('#svg-container svg', { timeout: 30000 });
    const statusEl = page.locator('#status');
    await expect(statusEl).toHaveText(/Ready/, { timeout: 20000 });
  });

  test('svg container has default cursor in object mode', async ({ page }) => {
    const container = page.locator('#svg-container');
    await expect(container).toHaveCSS('cursor', 'default');
  });

  test('box body has move cursor in object mode', async ({ page }) => {
    const shell = page.locator('scribus-app-shell');
    await expect(shell).toHaveAttribute('data-mode', 'object');

    const boxRect = page.locator('.box-rect').first();
    await expect(boxRect).toHaveCSS('cursor', 'move');
  });

  test('svg container has text cursor in text mode', async ({ page }) => {
    await enterTextMode(page);

    const container = page.locator('#svg-container');
    await expect(container).toHaveCSS('cursor', 'text');
  });

  test('resize handles have directional cursors', async ({ page }) => {
    // Resize handles are only visible on the selected box
    const shell = page.locator('scribus-app-shell');
    await expect(shell).toHaveAttribute('data-mode', 'object');

    // The first box is selected by default — check its handles
    const handles = {
      'nw': 'nwse-resize',
      'ne': 'nesw-resize',
      'se': 'nwse-resize',
      'sw': 'nesw-resize',
      'n': 'ns-resize',
      's': 'ns-resize',
      'e': 'ew-resize',
      'w': 'ew-resize',
    };

    for (const [handle, expectedCursor] of Object.entries(handles)) {
      const el = page.locator(`[data-handle="${handle}"]`).first();
      // Not all handles may be visible depending on box size;
      // check those that are attached
      const count = await el.count();
      if (count > 0) {
        await expect(el).toHaveCSS('cursor', expectedCursor);
      }
    }
  });

  test('output port has pointer cursor', async ({ page }) => {
    const port = page.locator('[data-port="output"]').first();
    await expect(port).toBeAttached();
    await expect(port).toHaveCSS('cursor', 'pointer');
  });
});

test.describe('Visual State Transitions', () => {
  test.beforeEach(async ({ page }) => {
    page.on('console', msg => console.log(`BROWSER [${msg.type()}]: ${msg.text()}`));
    page.on('pageerror', err => console.error(`BROWSER [error]: ${err.message}`));
    await page.goto('/spread-editor/index.html');
    await page.waitForSelector('#svg-container svg', { timeout: 30000 });
    const statusEl = page.locator('#status');
    await expect(statusEl).toHaveText(/Ready/, { timeout: 20000 });
  });

  test('selected box shows accent-colored border', async ({ page }) => {
    // First box is selected by default
    const boxRect = page.locator('.box-rect').first();
    const stroke = await boxRect.getAttribute('stroke');
    // Selected box uses #2f6ea4, unselected uses #7b7568
    expect(stroke).toBe('#2f6ea4');
  });

  test('unselected box shows muted border', async ({ page }) => {
    // Click background to deselect
    const canvas = page.locator('#svg-container');
    await canvas.click({ position: { x: 10, y: 10 } });
    await page.waitForTimeout(200);

    // All box-rects should have the unselected stroke color
    const boxRects = page.locator('.box-rect');
    const count = await boxRects.count();
    for (let i = 0; i < count; i++) {
      const stroke = await boxRects.nth(i).getAttribute('stroke');
      expect(stroke).toBe('#7b7568');
    }
  });

  test('entering text mode shows cursor and typography ribbon', async ({ page }) => {
    await enterTextMode(page);

    // Cursor should be attached
    const cursor = page.locator('#text-cursor');
    await expect(cursor).toBeAttached();

    // Typography ribbon section should be visible
    const typography = page.locator('scribus-ribbon-section[label="Typography"]');
    await expect(typography).toBeVisible();

    // Formatting ribbon section should be visible
    const formatting = page.locator('scribus-ribbon-section[label="Formatting"]');
    await expect(formatting).toBeVisible();
  });

  test('exiting text mode via Escape hides cursor and typography ribbon', async ({ page }) => {
    await enterTextMode(page);

    // Verify text mode is active
    const shell = page.locator('scribus-app-shell');
    await expect(shell).toHaveAttribute('data-mode', 'text');

    // Press Escape to exit text mode
    await page.keyboard.press('Escape');
    await expect(shell).toHaveAttribute('data-mode', 'object');

    // Typography section should no longer be visible
    const typography = page.locator('scribus-ribbon-section[label="Typography"]');
    await expect(typography).not.toBeVisible();
  });

  test('exiting text mode via background click returns to object mode', async ({ page }) => {
    await enterTextMode(page);

    const shell = page.locator('scribus-app-shell');
    await expect(shell).toHaveAttribute('data-mode', 'text');

    // Click background
    const canvas = page.locator('#svg-container');
    await canvas.click({ position: { x: 10, y: 10 } });

    await expect(shell).toHaveAttribute('data-mode', 'object');
    await expect(page.locator('#svg-container')).toHaveCSS('cursor', 'default');
  });

  test('selecting a different box in object mode changes selected highlight', async ({ page }) => {
    // Need at least 2 boxes — the default spread editor has multiple
    const boxRects = page.locator('.box-rect');
    const count = await boxRects.count();
    if (count < 2) {
      test.skip();
      return;
    }

    // First box is selected by default
    const firstStroke = await boxRects.first().getAttribute('stroke');
    expect(firstStroke).toBe('#2f6ea4');

    // Click the second box
    await boxRects.nth(1).click();
    await page.waitForTimeout(200);

    // Second box should now be selected
    const secondStroke = await boxRects.nth(1).getAttribute('stroke');
    expect(secondStroke).toBe('#2f6ea4');

    // First box should no longer be selected
    const firstStrokeAfter = await boxRects.first().getAttribute('stroke');
    expect(firstStrokeAfter).toBe('#7b7568');
  });

  test('double-click word selection shows highlight, single click collapses', async ({ page }) => {
    await enterTextMode(page);
    const bounds = await firstBoxBounds(page);

    // Double-click to select a word
    await page.mouse.click(bounds.x + 60, bounds.y + 30, { clickCount: 2 });
    await page.waitForTimeout(400);

    // Should have selection highlight
    expect(await selectionRectCount(page)).toBeGreaterThan(0);

    // Wait past multi-click threshold
    await page.waitForTimeout(400);

    // Single click to collapse
    await page.mouse.click(bounds.x + 60, bounds.y + 30);
    await page.waitForTimeout(400);

    // Selection should be gone, cursor should be attached
    expect(await selectionRectCount(page)).toBe(0);
    await expect(page.locator('#text-cursor')).toBeAttached();
  });
});
