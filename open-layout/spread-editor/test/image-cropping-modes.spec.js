import { test, expect } from '@playwright/test';

function forwardBrowserLogs(page) {
  page.on('console', msg => console.log(`BROWSER [${msg.type()}]: ${msg.text()}`));
  page.on('pageerror', err => console.error(`BROWSER [error]: ${err.message}`));
}

async function dropImageAt(page, x, y, { color = 'blue', width = 100, height = 100 } = {}) {
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

    container.dispatchEvent(new DragEvent('dragenter', {
      bubbles: true, dataTransfer: dt, clientX: x, clientY: y,
    }));
    container.dispatchEvent(new DragEvent('dragover', {
      bubbles: true, cancelable: true, dataTransfer: dt, clientX: x, clientY: y,
    }));
    container.dispatchEvent(new DragEvent('drop', {
      bubbles: true, cancelable: true, dataTransfer: dt, clientX: x, clientY: y,
    }));

    return new Promise(resolve => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.readAsDataURL(blob);
    });
  }, { x, y, color, width, height });
}

test.describe('Image Cropping, Scaling and Placement Modes', () => {
  test.beforeEach(async ({ page }) => {
    forwardBrowserLogs(page);
    await page.goto('/spread-editor/index.html');
    await page.waitForSelector('scribus-app-shell:defined');
    const statusEl = page.locator('#status');
    await expect(statusEl).toHaveText(/Ready/, { timeout: 20000 });
  });

  test('Mode 1: Combined Resize without Shift locks aspect ratio', async ({ page }) => {
    const canvas = page.locator('#svg-container');
    await canvas.click({ position: { x: 10, y: 10 } });

    const canvasBox = await canvas.boundingBox();
    const cx = canvasBox.x + canvasBox.width / 2;
    const cy = canvasBox.y + canvasBox.height / 2;

    await dropImageAt(page, cx, cy, { width: 100, height: 100 });
    await expect(page.locator('[data-image-box="true"]')).toHaveCount(1, { timeout: 5000 });

    const imageOverlay = page.locator('[data-box-id^="image-"][data-handle="body"]');
    await imageOverlay.click();
    await page.waitForTimeout(300);

    const handle = page.locator('[data-handle="se"]');
    const handleBox = await handle.boundingBox();
    const startX = handleBox.x + handleBox.width / 2;
    const startY = handleBox.y + handleBox.height / 2;

    // Drag corner without Shift (aspect locked)
    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await page.mouse.move(startX + 100, startY + 50);
    await page.mouse.up();
    await page.waitForTimeout(300);

    // Verify both frame dimensions and image scaling dimensions are scaled uniformly
    const boxAndPlacement = await page.evaluate(() => {
      const app = window.app;
      const box = app.imageBoxes[0];
      const img = document.querySelector('image[data-image-box]');
      return {
        width: box.width,
        height: box.height,
        aspect: box.width / box.height,
        imgAspect: parseFloat(img.getAttribute('width')) / parseFloat(img.getAttribute('height'))
      };
    });

    // Uniform box aspect should be around 1.0 (original was 100x100 box placed by drop)
    expect(Math.abs(boxAndPlacement.aspect - 1.0)).toBeLessThan(0.01);
    // Rendered image aspect ratio should also stay at 1.0
    expect(Math.abs(boxAndPlacement.imgAspect - 1.0)).toBeLessThan(0.01);
  });

  test('Mode 1: Combined Resize with Shift allows aspect ratio changes', async ({ page }) => {
    const canvas = page.locator('#svg-container');
    await canvas.click({ position: { x: 10, y: 10 } });

    const canvasBox = await canvas.boundingBox();
    const cx = canvasBox.x + canvasBox.width / 2;
    const cy = canvasBox.y + canvasBox.height / 2;

    await dropImageAt(page, cx, cy, { width: 100, height: 100 });
    await expect(page.locator('[data-image-box="true"]')).toHaveCount(1, { timeout: 5000 });

    const imageOverlay = page.locator('[data-box-id^="image-"][data-handle="body"]');
    await imageOverlay.click();
    await page.waitForTimeout(300);

    const handle = page.locator('[data-handle="se"]');
    const handleBox = await handle.boundingBox();
    const startX = handleBox.x + handleBox.width / 2;
    const startY = handleBox.y + handleBox.height / 2;

    // Drag corner WITH Shift key down
    await page.keyboard.down('Shift');
    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await page.mouse.move(startX + 150, startY + 50);
    await page.mouse.up();
    await page.keyboard.up('Shift');
    await page.waitForTimeout(300);

    const boxAndPlacement = await page.evaluate(() => {
      const app = window.app;
      const box = app.imageBoxes[0];
      const img = document.querySelector('image[data-image-box]');
      return {
        width: box.width,
        height: box.height,
        aspect: box.width / box.height,
        imgAspect: parseFloat(img.getAttribute('width')) / parseFloat(img.getAttribute('height'))
      };
    });

    // Width of frame should have grown much more than height (skewed aspect ratio)
    expect(boxAndPlacement.aspect).toBeGreaterThan(1.2);
    // Rendered image aspect ratio should also change and match the skewed box aspect ratio
    expect(boxAndPlacement.imgAspect).toBeGreaterThan(1.2);
  });

  test('Mode 3: Double click enters Edit Content mode with orange outlines', async ({ page }) => {
    const canvas = page.locator('#svg-container');
    await canvas.click({ position: { x: 10, y: 10 } });

    const canvasBox = await canvas.boundingBox();
    const cx = canvasBox.x + canvasBox.width / 2;
    const cy = canvasBox.y + canvasBox.height / 2;

    await dropImageAt(page, cx, cy, { width: 100, height: 100 });
    await expect(page.locator('[data-image-box="true"]')).toHaveCount(1, { timeout: 5000 });

    const imageOverlay = page.locator('[data-box-id^="image-"][data-handle="body"]');
    // Double click to enter Mode 3
    await imageOverlay.dblclick();
    await page.waitForTimeout(300);

    // Verify Mode 3 state
    const modeState = await page.evaluate(() => {
      console.log('DEBUG Mode 3 activeCroppingMode:', window.app.activeCroppingMode);
      console.log('DEBUG Mode 3 selectedBoxId:', window.app.selectedBoxId);
      return {
        mode: window.app.activeCroppingMode,
        hasContentHandles: !!document.querySelector('[data-sublayer="content-handles"]'),
        hasStandardHandles: !!document.querySelector('[data-sublayer="handles"]')
      };
    });

    expect(modeState.mode).toBe(3);
    expect(modeState.hasContentHandles).toBe(true);
    expect(modeState.hasStandardHandles).toBe(false); // Only orange handles, no standard handles
  });

  test('Text Frame: Resize without Shift defaults to unlocked aspect ratio', async ({ page }) => {
    const trigger = page.locator('scribus-create-menu button.trigger');
    await trigger.click();
    await page.locator('.scribus-create-menu-item', { hasText: 'Text Frame' }).click();
    await page.waitForTimeout(500);

    const textOverlay = page.locator('[data-box-id^="text-"][data-handle="body"]');
    await textOverlay.click();
    await page.waitForTimeout(300);

    const handle = page.locator('[data-handle="se"]');
    const handleBox = await handle.boundingBox();
    const startX = handleBox.x + handleBox.width / 2;
    const startY = handleBox.y + handleBox.height / 2;

    // Drag corner without Shift (aspect unlocked by default for text boxes!)
    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await page.mouse.move(startX + 150, startY + 50);
    await page.mouse.up();
    await page.waitForTimeout(300);

    const boxState = await page.evaluate(() => {
      const box = window.app.boxes[window.app.boxes.length - 1];
      return {
        width: box.width,
        height: box.height,
        aspect: box.width / box.height
      };
    });

    // Aspect ratio of the box should be freeform/skewed (width grew by 150, height grew by 50)
    expect(boxState.aspect).not.toBeCloseTo(4 / 3, 1);
  });

  test('Text Frame: Resize with Shift enables locked aspect ratio', async ({ page }) => {
    const trigger = page.locator('scribus-create-menu button.trigger');
    await trigger.click();
    await page.locator('.scribus-create-menu-item', { hasText: 'Text Frame' }).click();
    await page.waitForTimeout(500);

    const textOverlay = page.locator('[data-box-id^="text-"][data-handle="body"]');
    await textOverlay.click();
    await page.waitForTimeout(300);

    const handle = page.locator('[data-handle="se"]');
    const handleBox = await handle.boundingBox();
    const startX = handleBox.x + handleBox.width / 2;
    const startY = handleBox.y + handleBox.height / 2;

    // Drag corner WITH Shift key down (aspect ratio locked for text boxes!)
    await page.keyboard.down('Shift');
    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await page.mouse.move(startX + 150, startY + 50);
    await page.mouse.up();
    await page.keyboard.up('Shift');
    await page.waitForTimeout(300);

    const boxState = await page.evaluate(() => {
      const box = window.app.boxes[window.app.boxes.length - 1];
      return {
        width: box.width,
        height: box.height,
        aspect: box.width / box.height
      };
    });

    // Aspect ratio of the box should be locked to its original aspect ratio!
    // Since original text box from create menu is 400x300, aspect is 4/3 = 1.3333
    expect(boxState.aspect).toBeCloseTo(4 / 3, 2);
  });
});
