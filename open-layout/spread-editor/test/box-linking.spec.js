import { test, expect } from '@playwright/test';

/**
 * Click a port/overflow element for a given box.
 * Dispatches a pointerdown event directly on the SVG element to avoid
 * viewport scroll issues (ports near page bottom may be off-screen).
 */
async function clickPort(page, boxId, portType) {
  const found = await page.evaluate(({ boxId, portType }) => {
    const svg = document.querySelector('#svg-container svg');
    let el;
    if (portType === 'overflow') {
      el = svg.querySelector(`[data-overflow="true"][data-port-box="${boxId}"]`);
    } else {
      el = svg.querySelector(`[data-port="${portType}"][data-port-box="${boxId}"]`);
    }
    if (!el) return false;
    const rect = el.getBoundingClientRect();
    const cx = rect.x + rect.width / 2;
    const cy = rect.y + rect.height / 2;
    el.dispatchEvent(new PointerEvent('pointerdown', {
      bubbles: true, clientX: cx, clientY: cy, pointerId: 1,
    }));
    return true;
  }, { boxId, portType });
  if (!found) throw new Error(`Port ${portType} not found for box ${boxId}`);
}

/**
 * Click the body of a box by its data-box-id.
 * In link mode, clicks the link-target overlay if present; otherwise the
 * normal box body rect.  Uses dispatchEvent to avoid viewport scroll issues.
 */
async function clickBoxBody(page, boxId) {
  const found = await page.evaluate((boxId) => {
    const svg = document.querySelector('#svg-container svg');
    // Prefer the link-target overlay (rendered on top during link mode)
    let body = svg.querySelector(`[data-link-target="true"][data-box-id="${boxId}"]`);
    if (!body) {
      body = svg.querySelector(`[data-box-id="${boxId}"][data-handle="body"]`);
    }
    if (!body) return false;
    const rect = body.getBoundingClientRect();
    const cx = rect.x + rect.width / 2;
    const cy = rect.y + rect.height / 2;
    body.dispatchEvent(new PointerEvent('pointerdown', {
      bubbles: true, clientX: cx, clientY: cy, pointerId: 1,
    }));
    return true;
  }, boxId);
  if (!found) throw new Error(`Box body not found for ${boxId}`);
}

test.describe('Text Frame Linking', () => {
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

  test('clicking output port on last box of a chain enters link mode', async ({ page }) => {
    // The last default box's output port should be clickable
    const lastBoxId = await page.evaluate(() => {
      const app = window.scribusShell?.plugins?.find(p => p._stories !== undefined);
      const story = app?._stories[0];
      return story?.boxIds[story.boxIds.length - 1];
    });
    expect(lastBoxId).toBeTruthy();

    await clickPort(page, lastBoxId, 'output');
    await page.waitForTimeout(300);

    const mode = await page.evaluate(() => {
      const shell = document.querySelector('scribus-app-shell');
      return shell?.getAttribute('data-mode');
    });
    expect(mode).toBe('link');
  });

  test('link mode shows target highlights on other story boxes', async ({ page }) => {
    // Create a new text frame first (to have a valid target)
    const trigger = page.locator('scribus-create-menu button.trigger');
    await trigger.click();
    await page.locator('.scribus-create-menu-item', { hasText: 'Text Frame' }).click();
    await page.waitForTimeout(500);

    // Enter link mode from the last default box
    const lastBoxId = await page.evaluate(() => {
      const app = window.scribusShell?.plugins?.find(p => p._stories !== undefined);
      const story = app?._stories[0];
      return story?.boxIds[story.boxIds.length - 1];
    });
    await clickPort(page, lastBoxId, 'output');
    await page.waitForTimeout(300);

    // Should see link target highlights
    const targetCount = await page.evaluate(() => {
      const svg = document.querySelector('#svg-container svg');
      return svg.querySelectorAll('[data-link-target="true"]').length;
    });
    expect(targetCount).toBeGreaterThan(0);
  });

  test('escape cancels link mode', async ({ page }) => {
    const lastBoxId = await page.evaluate(() => {
      const app = window.scribusShell?.plugins?.find(p => p._stories !== undefined);
      const story = app?._stories[0];
      return story?.boxIds[story.boxIds.length - 1];
    });
    await clickPort(page, lastBoxId, 'output');
    await page.waitForTimeout(300);

    // Verify in link mode
    let mode = await page.evaluate(() => {
      const shell = document.querySelector('scribus-app-shell');
      return shell?.getAttribute('data-mode');
    });
    expect(mode).toBe('link');

    // Press Escape
    await page.locator('#svg-container').focus();
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);

    mode = await page.evaluate(() => {
      const shell = document.querySelector('scribus-app-shell');
      return shell?.getAttribute('data-mode');
    });
    expect(mode).toBe('object');
  });

  test('linking a new text frame appends it to the chain', async ({ page }) => {
    // Create a new text frame
    const trigger = page.locator('scribus-create-menu button.trigger');
    await trigger.click();
    await page.locator('.scribus-create-menu-item', { hasText: 'Text Frame' }).click();
    await page.waitForTimeout(500);

    // Get the new box ID and story count before linking
    const before = await page.evaluate(() => {
      const app = window.scribusShell?.plugins?.find(p => p._stories !== undefined);
      const newBox = app?.boxes.find(b => b.id.startsWith('text-'));
      return {
        storyCount: app?._stories.length,
        originalChainLength: app?._stories[0]?.boxIds.length,
        newBoxId: newBox?.id,
      };
    });
    expect(before.storyCount).toBe(2);
    expect(before.originalChainLength).toBe(4);

    // Enter link mode from the last default box
    const lastBoxId = await page.evaluate(() => {
      const app = window.scribusShell?.plugins?.find(p => p._stories !== undefined);
      const story = app?._stories[0];
      return story?.boxIds[story.boxIds.length - 1];
    });
    await clickPort(page, lastBoxId, 'output');
    await page.waitForTimeout(300);

    // Click the new text frame to link it
    await clickBoxBody(page, before.newBoxId);
    await page.waitForTimeout(500);

    // Verify: one story with 5 boxes, link mode exited
    const after = await page.evaluate(() => {
      const app = window.scribusShell?.plugins?.find(p => p._stories !== undefined);
      const shell = document.querySelector('scribus-app-shell');
      return {
        storyCount: app?._stories.length,
        chainLength: app?._stories[0]?.boxIds.length,
        mode: shell?.getAttribute('data-mode'),
      };
    });
    expect(after.storyCount).toBe(1);
    expect(after.chainLength).toBe(5);
    expect(after.mode).toBe('object');
  });

  test('linking is undoable', async ({ page }) => {
    // Create a new text frame
    const trigger = page.locator('scribus-create-menu button.trigger');
    await trigger.click();
    await page.locator('.scribus-create-menu-item', { hasText: 'Text Frame' }).click();
    await page.waitForTimeout(500);

    const newBoxId = await page.evaluate(() => {
      const app = window.scribusShell?.plugins?.find(p => p._stories !== undefined);
      return app?.boxes.find(b => b.id.startsWith('text-'))?.id;
    });

    // Link it
    const lastBoxId = await page.evaluate(() => {
      const app = window.scribusShell?.plugins?.find(p => p._stories !== undefined);
      return app?._stories[0]?.boxIds[app._stories[0].boxIds.length - 1];
    });
    await clickPort(page, lastBoxId, 'output');
    await page.waitForTimeout(300);
    await clickBoxBody(page, newBoxId);
    await page.waitForTimeout(500);

    // Verify linked (1 story, 5 boxes)
    let state = await page.evaluate(() => {
      const app = window.scribusShell?.plugins?.find(p => p._stories !== undefined);
      return { storyCount: app?._stories.length, chainLength: app?._stories[0]?.boxIds.length };
    });
    expect(state.storyCount).toBe(1);
    expect(state.chainLength).toBe(5);

    // Undo
    await page.keyboard.press('ControlOrMeta+KeyZ');
    await page.waitForTimeout(500);

    // Should be back to 2 stories, 4-box chain
    state = await page.evaluate(() => {
      const app = window.scribusShell?.plugins?.find(p => p._stories !== undefined);
      return { storyCount: app?._stories.length, chainLength: app?._stories[0]?.boxIds.length };
    });
    expect(state.storyCount).toBe(2);
    expect(state.chainLength).toBe(4);
  });

  test('clicking filled output port unlinks the chain', async ({ page }) => {
    // The default chain has 4 boxes. Click the output port of box 2
    // (which is filled, since box 3 follows). This should split the chain.
    const boxIds = await page.evaluate(() => {
      const app = window.scribusShell?.plugins?.find(p => p._stories !== undefined);
      return app?._stories[0]?.boxIds;
    });
    expect(boxIds.length).toBe(4);

    // Click the filled output port of the second box
    await clickPort(page, boxIds[1], 'output');
    await page.waitForTimeout(500);

    // Should now have 2 stories: first with boxes 0-1, second with boxes 2-3
    const after = await page.evaluate(() => {
      const app = window.scribusShell?.plugins?.find(p => p._stories !== undefined);
      return {
        storyCount: app?._stories.length,
        chain1: app?._stories[0]?.boxIds,
        chain2: app?._stories[1]?.boxIds,
      };
    });
    expect(after.storyCount).toBe(2);
    expect(after.chain1.length).toBe(2);
    expect(after.chain2.length).toBe(2);
  });

  test('unlinking is undoable', async ({ page }) => {
    const boxIds = await page.evaluate(() => {
      const app = window.scribusShell?.plugins?.find(p => p._stories !== undefined);
      return app?._stories[0]?.boxIds;
    });

    // Unlink at box 1
    await clickPort(page, boxIds[1], 'output');
    await page.waitForTimeout(500);

    let state = await page.evaluate(() => {
      const app = window.scribusShell?.plugins?.find(p => p._stories !== undefined);
      return { storyCount: app?._stories.length };
    });
    expect(state.storyCount).toBe(2);

    // Undo
    await page.keyboard.press('ControlOrMeta+KeyZ');
    await page.waitForTimeout(500);

    state = await page.evaluate(() => {
      const app = window.scribusShell?.plugins?.find(p => p._stories !== undefined);
      return {
        storyCount: app?._stories.length,
        chainLength: app?._stories[0]?.boxIds.length,
      };
    });
    expect(state.storyCount).toBe(1);
    expect(state.chainLength).toBe(4);
  });
});
