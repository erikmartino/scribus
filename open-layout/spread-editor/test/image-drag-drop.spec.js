import { test, expect } from '@playwright/test';

function forwardBrowserLogs(page) {
  page.on('console', msg => console.log(`BROWSER [${msg.type()}]: ${msg.text()}`));
  page.on('pageerror', err => console.error(`BROWSER [error]: ${err.message}`));
}

/**
 * Helper: create a small PNG blob in the browser and dispatch a drop event
 * on #svg-container at the given position.  Returns the data URL of the
 * created image so callers can verify it was placed.
 */
async function dropImageAt(page, x, y, { color = 'red', width = 50, height = 50 } = {}) {
  return page.evaluate(async ({ x, y, color, width, height }) => {
    const c = document.createElement('canvas');
    c.width = width; c.height = height;
    const ctx = c.getContext('2d');
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, width, height);
    const blob = await new Promise(r => c.toBlob(r, 'image/png'));

    const dt = new DataTransfer();
    const file = new File([blob], 'test-image.png', { type: 'image/png' });
    dt.items.add(file);

    const container = document.querySelector('#svg-container');

    // Simulate the full drag sequence: dragenter → dragover → drop
    container.dispatchEvent(new DragEvent('dragenter', {
      bubbles: true, dataTransfer: dt, clientX: x, clientY: y,
    }));
    container.dispatchEvent(new DragEvent('dragover', {
      bubbles: true, cancelable: true, dataTransfer: dt, clientX: x, clientY: y,
    }));
    container.dispatchEvent(new DragEvent('drop', {
      bubbles: true, cancelable: true, dataTransfer: dt, clientX: x, clientY: y,
    }));

    // Read the file as a data URL so we can match it later
    return new Promise(resolve => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.readAsDataURL(blob);
    });
  }, { x, y, color, width, height });
}

test.describe('Image Drag and Drop', () => {
  test.beforeEach(async ({ page }) => {
    forwardBrowserLogs(page);
    await page.goto('/spread-editor/index.html');
    await page.waitForSelector('scribus-app-shell:defined');
    const statusEl = page.locator('#status');
    await expect(statusEl).toHaveText(/Ready/, { timeout: 20000 });
  });

  test('dropping an image file creates an image box in object mode', async ({ page }) => {
    const shell = page.locator('scribus-app-shell');

    // Ensure object mode
    const canvas = page.locator('#svg-container');
    await canvas.click({ position: { x: 10, y: 10 } });
    await expect(shell).toHaveAttribute('data-mode', 'object');

    // No image boxes initially
    const beforeCount = await page.evaluate(() => {
      const svg = document.querySelector('#svg-container svg.content-svg');
      return svg.querySelectorAll('image[data-image-box]').length;
    });
    expect(beforeCount).toBe(0);

    // Drop an image in the center of the container
    const box = await canvas.boundingBox();
    await dropImageAt(page, box.x + box.width / 2, box.y + box.height / 2);

    // Wait for the image to be processed and rendered
    await expect(page.locator('[data-image-box="true"]')).toHaveCount(1, { timeout: 5000 });

    // Verify the overlay has a box frame for it
    const hasOverlay = await page.evaluate(() => {
      const overlay = document.querySelector('#svg-container svg.overlay-svg');
      return !!overlay.querySelector('[data-box-id^="image-"]');
    });
    expect(hasOverlay).toBe(true);
  });

  test('dropped image box is placed near the drop coordinates', async ({ page }) => {
    const canvas = page.locator('#svg-container');
    await canvas.click({ position: { x: 10, y: 10 } });

    const canvasBox = await canvas.boundingBox();
    const dropX = canvasBox.x + canvasBox.width / 2;
    const dropY = canvasBox.y + canvasBox.height / 2;

    await dropImageAt(page, dropX, dropY, { width: 60, height: 40 });
    await expect(page.locator('[data-image-box="true"]')).toHaveCount(1, { timeout: 5000 });

    // Get the image box position in screen coordinates and verify it's
    // near the drop point
    const imgRect = await page.evaluate(() => {
      const svg = document.querySelector('#svg-container svg.content-svg');
      const img = svg.querySelector('image[data-image-box]');
      if (!img) return null;
      const ctm = svg.getScreenCTM();
      const x = parseFloat(img.getAttribute('x'));
      const y = parseFloat(img.getAttribute('y'));
      const w = parseFloat(img.getAttribute('width'));
      const h = parseFloat(img.getAttribute('height'));
      // Center of the image in screen coordinates
      const center = new DOMPoint(x + w / 2, y + h / 2).matrixTransform(ctm);
      return { screenX: center.x, screenY: center.y };
    });
    expect(imgRect).not.toBeNull();

    // The image center should be near the drop point (within 20px tolerance
    // for rounding and scaling)
    expect(Math.abs(imgRect.screenX - dropX)).toBeLessThan(20);
    expect(Math.abs(imgRect.screenY - dropY)).toBeLessThan(20);
  });

  test('dropping an image in object mode is undoable', async ({ page }) => {
    const canvas = page.locator('#svg-container');
    await canvas.click({ position: { x: 10, y: 10 } });

    const box = await canvas.boundingBox();
    await dropImageAt(page, box.x + box.width / 2, box.y + box.height / 2);
    await expect(page.locator('[data-image-box="true"]')).toHaveCount(1, { timeout: 5000 });

    // Undo
    await page.keyboard.press('ControlOrMeta+KeyZ');
    await page.waitForTimeout(500);

    // Image should be gone
    const afterUndo = await page.evaluate(() => {
      const svg = document.querySelector('#svg-container svg.content-svg');
      return svg.querySelectorAll('image[data-image-box]').length;
    });
    expect(afterUndo).toBe(0);
  });

  test('dropping multiple image files creates multiple image boxes', async ({ page }) => {
    const canvas = page.locator('#svg-container');
    await canvas.click({ position: { x: 10, y: 10 } });

    const box = await canvas.boundingBox();

    // Create a drop with two image files
    await page.evaluate(async ({ x, y }) => {
      const makeBlob = (color) => {
        const c = document.createElement('canvas');
        c.width = 30; c.height = 30;
        const ctx = c.getContext('2d');
        ctx.fillStyle = color;
        ctx.fillRect(0, 0, 30, 30);
        return new Promise(r => c.toBlob(r, 'image/png'));
      };

      const blob1 = await makeBlob('red');
      const blob2 = await makeBlob('blue');
      const dt = new DataTransfer();
      dt.items.add(new File([blob1], 'img1.png', { type: 'image/png' }));
      dt.items.add(new File([blob2], 'img2.png', { type: 'image/png' }));

      const container = document.querySelector('#svg-container');
      container.dispatchEvent(new DragEvent('dragenter', {
        bubbles: true, dataTransfer: dt, clientX: x, clientY: y,
      }));
      container.dispatchEvent(new DragEvent('dragover', {
        bubbles: true, cancelable: true, dataTransfer: dt, clientX: x, clientY: y,
      }));
      container.dispatchEvent(new DragEvent('drop', {
        bubbles: true, cancelable: true, dataTransfer: dt, clientX: x, clientY: y,
      }));
    }, { x: box.x + box.width / 2, y: box.y + box.height / 2 });

    // Wait for both images to appear
    await expect(page.locator('[data-image-box="true"]')).toHaveCount(2, { timeout: 5000 });
  });

  test('non-image files are ignored during drop', async ({ page }) => {
    const canvas = page.locator('#svg-container');
    await canvas.click({ position: { x: 10, y: 10 } });

    const box = await canvas.boundingBox();

    // Drop a text file (not an image)
    await page.evaluate(async ({ x, y }) => {
      const dt = new DataTransfer();
      const file = new File(['hello world'], 'readme.txt', { type: 'text/plain' });
      dt.items.add(file);

      const container = document.querySelector('#svg-container');
      container.dispatchEvent(new DragEvent('dragenter', {
        bubbles: true, dataTransfer: dt, clientX: x, clientY: y,
      }));
      container.dispatchEvent(new DragEvent('dragover', {
        bubbles: true, cancelable: true, dataTransfer: dt, clientX: x, clientY: y,
      }));
      container.dispatchEvent(new DragEvent('drop', {
        bubbles: true, cancelable: true, dataTransfer: dt, clientX: x, clientY: y,
      }));
    }, { x: box.x + box.width / 2, y: box.y + box.height / 2 });

    await page.waitForTimeout(500);

    // No image boxes should have been created
    const imgCount = await page.evaluate(() => {
      const svg = document.querySelector('#svg-container svg.content-svg');
      return svg.querySelectorAll('image[data-image-box]').length;
    });
    expect(imgCount).toBe(0);
  });

  test('drop highlight appears during dragenter and disappears on drop', async ({ page }) => {
    const canvas = page.locator('#svg-container');
    const box = await canvas.boundingBox();
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;

    // Simulate dragenter
    await page.evaluate(({ x, y }) => {
      const dt = new DataTransfer();
      dt.items.add(new File([new Uint8Array(1)], 'f.png', { type: 'image/png' }));

      const container = document.querySelector('#svg-container');
      container.dispatchEvent(new DragEvent('dragenter', {
        bubbles: true, dataTransfer: dt, clientX: x, clientY: y,
      }));
    }, { x: cx, y: cy });

    // Highlight should be visible
    const highlight = page.locator('[data-drop-highlight="true"]');
    await expect(highlight).toBeAttached();

    // Now simulate drop to clear it
    await page.evaluate(async ({ x, y }) => {
      const c = document.createElement('canvas');
      c.width = 10; c.height = 10;
      const ctx = c.getContext('2d');
      ctx.fillRect(0, 0, 10, 10);
      const blob = await new Promise(r => c.toBlob(r, 'image/png'));
      const dt = new DataTransfer();
      dt.items.add(new File([blob], 'f.png', { type: 'image/png' }));

      const container = document.querySelector('#svg-container');
      container.dispatchEvent(new DragEvent('drop', {
        bubbles: true, cancelable: true, dataTransfer: dt, clientX: x, clientY: y,
      }));
    }, { x: cx, y: cy });

    // Highlight should be gone
    await expect(highlight).not.toBeAttached({ timeout: 2000 });
  });

  test('drop highlight disappears on dragleave', async ({ page }) => {
    const canvas = page.locator('#svg-container');
    const box = await canvas.boundingBox();
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;

    // Simulate dragenter
    await page.evaluate(({ x, y }) => {
      const dt = new DataTransfer();
      dt.items.add(new File([new Uint8Array(1)], 'f.png', { type: 'image/png' }));

      const container = document.querySelector('#svg-container');
      container.dispatchEvent(new DragEvent('dragenter', {
        bubbles: true, dataTransfer: dt, clientX: x, clientY: y,
      }));
    }, { x: cx, y: cy });

    const highlight = page.locator('[data-drop-highlight="true"]');
    await expect(highlight).toBeAttached();

    // Simulate dragleave
    await page.evaluate(({ x, y }) => {
      const dt = new DataTransfer();
      dt.items.add(new File([new Uint8Array(1)], 'f.png', { type: 'image/png' }));

      const container = document.querySelector('#svg-container');
      container.dispatchEvent(new DragEvent('dragleave', {
        bubbles: true, dataTransfer: dt, clientX: x, clientY: y,
      }));
    }, { x: cx, y: cy });

    await expect(highlight).not.toBeAttached({ timeout: 2000 });
  });

  test('image box from drop has resize handles', async ({ page }) => {
    const canvas = page.locator('#svg-container');
    await canvas.click({ position: { x: 10, y: 10 } });

    const box = await canvas.boundingBox();
    await dropImageAt(page, box.x + box.width / 2, box.y + box.height / 2);
    await expect(page.locator('[data-image-box="true"]')).toHaveCount(1, { timeout: 5000 });

    // Click the image overlay to select it
    const imageOverlay = page.locator('[data-box-id^="image-"][data-handle="body"]');
    await imageOverlay.click();
    await page.waitForTimeout(300);

    // Verify 8 resize handles
    const handleCount = await page.evaluate(() => {
      const overlay = document.querySelector('#svg-container svg.overlay-svg');
      const imageBoxRect = overlay.querySelector('[data-box-id^="image-"]');
      if (!imageBoxRect) return 0;
      const boxId = imageBoxRect.dataset.boxId;
      return overlay.querySelectorAll(
        `[data-sublayer="handles"] [data-box-id="${boxId}"]`
      ).length;
    });
    expect(handleCount).toBe(8);
  });
});
