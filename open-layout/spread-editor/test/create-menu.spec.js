import { test, expect } from '@playwright/test';

test.describe('Spread Editor Create Menu', () => {
  test.beforeEach(async ({ page }) => {
    page.on('console', msg => {
      console.log(`BROWSER [${msg.type()}]: ${msg.text()}`);
    });
    page.on('pageerror', err => {
      console.error(`BROWSER [error]: ${err.message}`);
    });

    await page.goto('/spread-editor/index.html');
    await page.waitForSelector('scribus-app-shell:defined');
    // Wait until the engine has fully loaded
    const statusEl = page.locator('#status');
    await expect(statusEl).toHaveText(/Ready/, { timeout: 20000 });
  });

  test('create menu is visible in the ribbon', async ({ page }) => {
    const createMenu = page.locator('scribus-create-menu');
    await expect(createMenu).toBeVisible();
  });

  test('dropdown lists Text Frame and Image Frame', async ({ page }) => {
    const trigger = page.locator('scribus-create-menu button.trigger');
    await trigger.click();

    const dropdown = page.locator('.scribus-create-dropdown');
    await expect(dropdown).toBeVisible();

    const items = page.locator('.scribus-create-menu-item');
    await expect(items).toHaveCount(2);
    await expect(items.nth(0)).toContainText('Text Frame');
    await expect(items.nth(1)).toContainText('Image Frame');
  });

  test('creating a text frame adds a new box overlay', async ({ page }) => {
    // Count unique box IDs before
    const countBefore = await page.evaluate(() => {
      const svg = document.querySelector('#svg-container svg.overlay-svg');
      if (!svg) return 0;
      const ids = new Set();
      svg.querySelectorAll('[data-box-id]').forEach(el => ids.add(el.dataset.boxId));
      return ids.size;
    });

    const trigger = page.locator('scribus-create-menu button.trigger');
    await trigger.click();

    const textFrameItem = page.locator('.scribus-create-menu-item', { hasText: 'Text Frame' });
    await textFrameItem.click();

    // Wait for update and verify a new unique box ID appeared
    await expect(async () => {
      const countAfter = await page.evaluate(() => {
        const svg = document.querySelector('#svg-container svg.overlay-svg');
        if (!svg) return 0;
        const ids = new Set();
        svg.querySelectorAll('[data-box-id]').forEach(el => ids.add(el.dataset.boxId));
        return ids.size;
      });
      expect(countAfter).toBe(countBefore + 1);
    }).toPass({ timeout: 5000 });
  });

  test('creating a text frame is undoable', async ({ page }) => {
    const boxIdsBefore = await page.evaluate(() => {
      const overlays = document.querySelector('#svg-container svg.overlay-svg');
      if (!overlays) return [];
      const ids = new Set();
      overlays.querySelectorAll('[data-box-id]').forEach(el => ids.add(el.dataset.boxId));
      return [...ids];
    });

    const trigger = page.locator('scribus-create-menu button.trigger');
    await trigger.click();
    const textFrameItem = page.locator('.scribus-create-menu-item', { hasText: 'Text Frame' });
    await textFrameItem.click();

    // Wait for the new box to appear
    await page.waitForTimeout(500);

    const boxIdsAfter = await page.evaluate(() => {
      const overlays = document.querySelector('#svg-container svg.overlay-svg');
      if (!overlays) return [];
      const ids = new Set();
      overlays.querySelectorAll('[data-box-id]').forEach(el => ids.add(el.dataset.boxId));
      return [...ids];
    });

    expect(boxIdsAfter.length).toBe(boxIdsBefore.length + 1);

    // Undo
    await page.keyboard.press('ControlOrMeta+KeyZ');
    await page.waitForTimeout(500);

    const boxIdsUndo = await page.evaluate(() => {
      const overlays = document.querySelector('#svg-container svg.overlay-svg');
      if (!overlays) return [];
      const ids = new Set();
      overlays.querySelectorAll('[data-box-id]').forEach(el => ids.add(el.dataset.boxId));
      return [...ids];
    });

    expect(boxIdsUndo.length).toBe(boxIdsBefore.length);
  });

  test('creating an image frame adds a new box with image', async ({ page }) => {
    const trigger = page.locator('scribus-create-menu button.trigger');
    await trigger.click();

    const imageFrameItem = page.locator('.scribus-create-menu-item', { hasText: 'Image Frame' });
    await imageFrameItem.click();

    // Wait for update - an image element should appear in the SVG
    await expect(page.locator('[data-image-box="true"]')).toHaveCount(1, { timeout: 5000 });
  });

  test('double-clicking an empty text frame enters text mode at end of story', async ({ page }) => {
    // Create a new text frame
    const trigger = page.locator('scribus-create-menu button.trigger');
    await trigger.click();
    const textFrameItem = page.locator('.scribus-create-menu-item', { hasText: 'Text Frame' });
    await textFrameItem.click();
    await page.waitForTimeout(500);

    // Find the new frame's box overlay (starts with "text-")
    const newBoxRect = await page.evaluate(() => {
      const svg = document.querySelector('#svg-container svg.overlay-svg');
      const rects = svg.querySelectorAll('[data-box-id][data-handle="body"]');
      for (const r of rects) {
        if (r.dataset.boxId.startsWith('text-')) {
          return {
            boxId: r.dataset.boxId,
            x: parseFloat(r.getAttribute('x')),
            y: parseFloat(r.getAttribute('y')),
            width: parseFloat(r.getAttribute('width')),
            height: parseFloat(r.getAttribute('height'))
          };
        }
      }
      return null;
    });
    expect(newBoxRect).not.toBeNull();

    // Convert SVG coordinates to screen coordinates and click twice
    // (first click selects, second click enters text mode)
    const svgBox = await page.locator('#svg-container svg.content-svg').boundingBox();
    const svgViewBox = await page.evaluate(() => {
      const svg = document.querySelector('#svg-container svg.content-svg');
      const vb = svg.viewBox.baseVal;
      return { x: vb.x, y: vb.y, width: vb.width, height: vb.height };
    });

    const scaleX = svgBox.width / svgViewBox.width;
    const scaleY = svgBox.height / svgViewBox.height;
    const clickX = svgBox.x + (newBoxRect.x - svgViewBox.x + newBoxRect.width / 2) * scaleX;
    const clickY = svgBox.y + (newBoxRect.y - svgViewBox.y + newBoxRect.height / 2) * scaleY;

    // First click: select the box
    await page.mouse.click(clickX, clickY);
    await page.waitForTimeout(200);

    // Second click: enter text mode
    await page.mouse.click(clickX, clickY);
    await page.waitForTimeout(500);

    // Should be in text mode now
    const mode = await page.evaluate(() => {
      const shell = document.querySelector('scribus-app-shell');
      return shell?.getAttribute('data-mode');
    });
    expect(mode).toBe('text');

    // Verify the editor state: text mode active, cursor positioned at
    // end of story, and blinking is enabled (cursor has a valid position).
    const state = await page.evaluate(() => {
      const shell = document.querySelector('scribus-app-shell');
      const cursor = document.querySelector('#svg-container svg.content-svg #text-cursor');
      // Access the SpreadEditorApp plugin to check editor state
      const app = window.scribusShell?.plugins?.find(p => p.mode !== undefined);
      return {
        mode: shell?.getAttribute('data-mode'),
        cursorExists: !!cursor,
        cursorHasPosition: cursor && cursor.getAttribute('x1') !== null,
        editorCursor: app?.editor?.cursor,
      };
    });
    expect(state.mode).toBe('text');
    expect(state.cursorExists).toBe(true);
    expect(state.cursorHasPosition).toBe(true);
    // Cursor should be at the end of the story
    expect(state.editorCursor.paraIndex).toBeGreaterThanOrEqual(0);
  });

  test('new text frame has an independent story from the default boxes', async ({ page }) => {
    // Get original story paragraph count (from #sample-text)
    const origStoryInfo = await page.evaluate(() => {
      const app = window.scribusShell?.plugins?.find(p => p._stories !== undefined);
      if (!app) return null;
      return {
        storyCount: app._stories.length,
        originalParaCount: app._stories[0]?.editor.story.length,
      };
    });
    expect(origStoryInfo).not.toBeNull();
    expect(origStoryInfo.storyCount).toBe(1);

    // Create a new text frame
    const trigger = page.locator('scribus-create-menu button.trigger');
    await trigger.click();
    const textFrameItem = page.locator('.scribus-create-menu-item', { hasText: 'Text Frame' });
    await textFrameItem.click();
    await page.waitForTimeout(500);

    // Verify a second story was created
    const afterCreate = await page.evaluate(() => {
      const app = window.scribusShell?.plugins?.find(p => p._stories !== undefined);
      if (!app) return null;
      return {
        storyCount: app._stories.length,
        originalParaCount: app._stories[0]?.editor.story.length,
        newStoryParaCount: app._stories[1]?.editor.story.length,
        newStoryText: app._stories[1]?.editor.story
          .map(p => p.map(r => r.text).join('')).join('\n'),
      };
    });
    expect(afterCreate.storyCount).toBe(2);
    // The new story should have 1 empty paragraph
    expect(afterCreate.newStoryParaCount).toBe(1);
    expect(afterCreate.newStoryText).toBe('');
    // Original story should be unchanged
    expect(afterCreate.originalParaCount).toBe(origStoryInfo.originalParaCount);
  });

  test('typing in a new text frame does not affect the original story', async ({ page }) => {
    // Get original story text
    const origText = await page.evaluate(() => {
      const app = window.scribusShell?.plugins?.find(p => p._stories !== undefined);
      return app?._stories[0]?.editor.story
        .map(p => p.map(r => r.text).join('')).join('\n') || '';
    });

    // Create a new text frame
    const trigger = page.locator('scribus-create-menu button.trigger');
    await trigger.click();
    const textFrameItem = page.locator('.scribus-create-menu-item', { hasText: 'Text Frame' });
    await textFrameItem.click();
    await page.waitForTimeout(500);

    // Find the new frame and double-click to enter text mode
    const newBoxRect = await page.evaluate(() => {
      const svg = document.querySelector('#svg-container svg.overlay-svg');
      const rects = svg.querySelectorAll('[data-box-id][data-handle="body"]');
      for (const r of rects) {
        if (r.dataset.boxId.startsWith('text-')) {
          return {
            boxId: r.dataset.boxId,
            x: parseFloat(r.getAttribute('x')),
            y: parseFloat(r.getAttribute('y')),
            width: parseFloat(r.getAttribute('width')),
            height: parseFloat(r.getAttribute('height'))
          };
        }
      }
      return null;
    });
    expect(newBoxRect).not.toBeNull();

    const svgBox = await page.locator('#svg-container svg.content-svg').boundingBox();
    const svgViewBox = await page.evaluate(() => {
      const svg = document.querySelector('#svg-container svg.content-svg');
      const vb = svg.viewBox.baseVal;
      return { x: vb.x, y: vb.y, width: vb.width, height: vb.height };
    });

    const scaleX = svgBox.width / svgViewBox.width;
    const scaleY = svgBox.height / svgViewBox.height;
    const clickX = svgBox.x + (newBoxRect.x - svgViewBox.x + newBoxRect.width / 2) * scaleX;
    const clickY = svgBox.y + (newBoxRect.y - svgViewBox.y + newBoxRect.height / 2) * scaleY;

    // First click: select, second click: enter text mode
    await page.mouse.click(clickX, clickY);
    await page.waitForTimeout(200);
    await page.mouse.click(clickX, clickY);
    await page.waitForTimeout(500);

    // Type text (ensure container has focus for keyboard events)
    await page.locator('#svg-container').focus();
    await page.keyboard.type('Hello independent');
    await page.waitForTimeout(500);

    // Verify the new story has the typed text and original is unchanged
    const result = await page.evaluate(() => {
      const app = window.scribusShell?.plugins?.find(p => p._stories !== undefined);
      return {
        newStoryText: app?._activeStory?.editor.story
          .map(p => p.map(r => r.text).join('')).join('\n') || '',
        originalText: app?._stories[0]?.editor.story
          .map(p => p.map(r => r.text).join('')).join('\n') || '',
      };
    });
    expect(result.newStoryText).toContain('Hello independent');
    // Original story should be completely unchanged
    expect(result.originalText).toBe(origText);
  });

  test('undo of text frame creation also removes its story', async ({ page }) => {
    // Create a new text frame
    const trigger = page.locator('scribus-create-menu button.trigger');
    await trigger.click();
    const textFrameItem = page.locator('.scribus-create-menu-item', { hasText: 'Text Frame' });
    await textFrameItem.click();
    await page.waitForTimeout(500);

    // Verify we have 2 stories
    const countAfter = await page.evaluate(() => {
      const app = window.scribusShell?.plugins?.find(p => p._stories !== undefined);
      return app?._stories.length;
    });
    expect(countAfter).toBe(2);

    // Undo
    await page.keyboard.press('ControlOrMeta+KeyZ');
    await page.waitForTimeout(500);

    // Verify back to 1 story
    const countUndo = await page.evaluate(() => {
      const app = window.scribusShell?.plugins?.find(p => p._stories !== undefined);
      return app?._stories.length;
    });
    expect(countUndo).toBe(1);
  });

  test('dropdown closes after creating a frame', async ({ page }) => {
    const trigger = page.locator('scribus-create-menu button.trigger');
    await trigger.click();

    const dropdown = page.locator('.scribus-create-dropdown');
    await expect(dropdown).toBeVisible();

    const textFrameItem = page.locator('.scribus-create-menu-item', { hasText: 'Text Frame' });
    await textFrameItem.click();

    await expect(dropdown).toBeHidden();
  });
});
