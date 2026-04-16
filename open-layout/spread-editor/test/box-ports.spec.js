import { test, expect } from '@playwright/test';

test.describe('Text Frame Ports and Overflow', () => {
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

  test('default text boxes have input and output port indicators', async ({ page }) => {
    // The default 4-box chain should show ports on each box
    const ports = await page.evaluate(() => {
      const svg = document.querySelector('#svg-container svg');
      const inputs = svg.querySelectorAll('[data-port="input"]');
      const outputs = svg.querySelectorAll('[data-port="output"]');
      return {
        inputCount: inputs.length,
        outputCount: outputs.length,
      };
    });
    // 4 default text boxes = 4 input ports + 4 output ports
    // (unless one has overflow, in which case the last output is replaced
    //  by an overflow marker — check for that too)
    const overflowCount = await page.evaluate(() => {
      const svg = document.querySelector('#svg-container svg');
      return svg.querySelectorAll('[data-overflow="true"]').length;
    });
    expect(ports.inputCount).toBe(4);
    // output ports + overflow markers should total 4
    expect(ports.outputCount + overflowCount).toBe(4);
  });

  test('first box in a chain has an unfilled input port', async ({ page }) => {
    // The first box in the default chain should have an unfilled (outline) input port
    const firstBoxId = await page.evaluate(() => {
      const app = window.scribusShell?.plugins?.find(p => p._stories !== undefined);
      return app?._stories[0]?.boxIds[0];
    });
    expect(firstBoxId).toBeTruthy();

    const portFill = await page.evaluate((boxId) => {
      const svg = document.querySelector('#svg-container svg');
      const port = svg.querySelector(`[data-port="input"][data-port-box="${boxId}"]`);
      return port?.getAttribute('fill');
    }, firstBoxId);
    // First box: no predecessor, so input port is unfilled (outline only)
    expect(portFill).toBe('none');
  });

  test('middle boxes in a chain have filled input ports', async ({ page }) => {
    // Boxes after the first in the chain should have filled input ports
    const secondBoxId = await page.evaluate(() => {
      const app = window.scribusShell?.plugins?.find(p => p._stories !== undefined);
      return app?._stories[0]?.boxIds[1];
    });
    expect(secondBoxId).toBeTruthy();

    const portFill = await page.evaluate((boxId) => {
      const svg = document.querySelector('#svg-container svg');
      const port = svg.querySelector(`[data-port="input"][data-port-box="${boxId}"]`);
      return port?.getAttribute('fill');
    }, secondBoxId);
    // Second box receives text from first, so input port is filled
    expect(portFill).not.toBe('none');
  });

  test('boxes with continuation have filled output ports', async ({ page }) => {
    // The first box in a 4-box chain should have a filled output port
    // (text continues to the next box)
    const firstBoxId = await page.evaluate(() => {
      const app = window.scribusShell?.plugins?.find(p => p._stories !== undefined);
      return app?._stories[0]?.boxIds[0];
    });

    const portFill = await page.evaluate((boxId) => {
      const svg = document.querySelector('#svg-container svg');
      const port = svg.querySelector(`[data-port="output"][data-port-box="${boxId}"]`);
      return port?.getAttribute('fill');
    }, firstBoxId);
    expect(portFill).not.toBe('none');
  });

  test('new text frame has unfilled input and output ports', async ({ page }) => {
    // Create a new standalone text frame — it is a single-box chain
    const trigger = page.locator('scribus-create-menu button.trigger');
    await trigger.click();
    const textFrameItem = page.locator('.scribus-create-menu-item', { hasText: 'Text Frame' });
    await textFrameItem.click();
    await page.waitForTimeout(500);

    // Find the new box (starts with "text-")
    const newBoxId = await page.evaluate(() => {
      const svg = document.querySelector('#svg-container svg');
      const rects = svg.querySelectorAll('[data-box-id][data-handle="body"]');
      for (const r of rects) {
        if (r.dataset.boxId.startsWith('text-')) return r.dataset.boxId;
      }
      return null;
    });
    expect(newBoxId).not.toBeNull();

    const ports = await page.evaluate((boxId) => {
      const svg = document.querySelector('#svg-container svg');
      const input = svg.querySelector(`[data-port="input"][data-port-box="${boxId}"]`);
      const output = svg.querySelector(`[data-port="output"][data-port-box="${boxId}"]`);
      const overflow = svg.querySelector(`[data-overflow="true"][data-port-box="${boxId}"]`);
      return {
        inputFill: input?.getAttribute('fill'),
        outputFill: output?.getAttribute('fill'),
        hasOverflow: !!overflow,
      };
    }, newBoxId);

    // Single box, no predecessors, empty text: unfilled ports, no overflow
    expect(ports.inputFill).toBe('none');
    expect(ports.outputFill).toBe('none');
    expect(ports.hasOverflow).toBe(false);
  });

  test('image boxes do not have ports', async ({ page }) => {
    // Create an image frame
    const trigger = page.locator('scribus-create-menu button.trigger');
    await trigger.click();
    const imageFrameItem = page.locator('.scribus-create-menu-item', { hasText: 'Image Frame' });
    await imageFrameItem.click();
    await expect(page.locator('[data-image-box="true"]')).toHaveCount(1, { timeout: 5000 });

    // Image box should NOT have ports
    const imageBoxId = await page.evaluate(() => {
      const svg = document.querySelector('#svg-container svg');
      const rects = svg.querySelectorAll('[data-box-id][data-handle="body"]');
      for (const r of rects) {
        if (r.dataset.boxId.startsWith('image-')) return r.dataset.boxId;
      }
      return null;
    });
    expect(imageBoxId).not.toBeNull();

    const ports = await page.evaluate((boxId) => {
      const svg = document.querySelector('#svg-container svg');
      const input = svg.querySelector(`[data-port="input"][data-port-box="${boxId}"]`);
      const output = svg.querySelector(`[data-port="output"][data-port-box="${boxId}"]`);
      return { hasInput: !!input, hasOutput: !!output };
    }, imageBoxId);

    expect(ports.hasInput).toBe(false);
    expect(ports.hasOutput).toBe(false);
  });

  test('overflow marker appears when text exceeds frame capacity', async ({ page }) => {
    // Create a small text frame, enter text mode, and type a lot of text
    // to cause overflow
    const trigger = page.locator('scribus-create-menu button.trigger');
    await trigger.click();
    const textFrameItem = page.locator('.scribus-create-menu-item', { hasText: 'Text Frame' });
    await textFrameItem.click();
    await page.waitForTimeout(500);

    const newBoxId = await page.evaluate(() => {
      const svg = document.querySelector('#svg-container svg');
      const rects = svg.querySelectorAll('[data-box-id][data-handle="body"]');
      for (const r of rects) {
        if (r.dataset.boxId.startsWith('text-')) return r.dataset.boxId;
      }
      return null;
    });
    expect(newBoxId).not.toBeNull();

    // Double-click to enter text mode on the new frame
    const svgBox = await page.locator('#svg-container svg').boundingBox();
    const svgViewBox = await page.evaluate(() => {
      const svg = document.querySelector('#svg-container svg');
      const vb = svg.viewBox.baseVal;
      return { x: vb.x, y: vb.y, width: vb.width, height: vb.height };
    });
    const newBox = await page.evaluate((boxId) => {
      const svg = document.querySelector('#svg-container svg');
      const r = svg.querySelector(`[data-box-id="${boxId}"][data-handle="body"]`);
      return {
        x: parseFloat(r.getAttribute('x')),
        y: parseFloat(r.getAttribute('y')),
        width: parseFloat(r.getAttribute('width')),
        height: parseFloat(r.getAttribute('height'))
      };
    }, newBoxId);

    const scaleX = svgBox.width / svgViewBox.width;
    const scaleY = svgBox.height / svgViewBox.height;
    const clickX = svgBox.x + (newBox.x - svgViewBox.x + newBox.width / 2) * scaleX;
    const clickY = svgBox.y + (newBox.y - svgViewBox.y + newBox.height / 2) * scaleY;

    // First click: select, second click: enter text mode
    await page.mouse.click(clickX, clickY);
    await page.waitForTimeout(200);
    await page.mouse.click(clickX, clickY);
    await page.waitForTimeout(500);

    // Type enough text to overflow the small 200x150 frame
    await page.locator('#svg-container').focus();
    const longText = 'This is a very long paragraph that should overflow the small text frame because it contains many words that will not fit within the limited height of one hundred and fifty points available in this frame.';
    await page.keyboard.type(longText);
    await page.waitForTimeout(500);

    // Check for the overflow marker
    const hasOverflow = await page.evaluate((boxId) => {
      const svg = document.querySelector('#svg-container svg');
      return !!svg.querySelector(`[data-overflow="true"][data-port-box="${boxId}"]`);
    }, newBoxId);
    expect(hasOverflow).toBe(true);

    // The output port should NOT exist (replaced by overflow marker)
    const hasOutputPort = await page.evaluate((boxId) => {
      const svg = document.querySelector('#svg-container svg');
      return !!svg.querySelector(`[data-port="output"][data-port-box="${boxId}"]`);
    }, newBoxId);
    expect(hasOutputPort).toBe(false);
  });
});
