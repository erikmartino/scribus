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

  test('Mode 2: Dragging (moving) frame moves content too, but resizing frame keeps content static', async ({ page }) => {
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

    // Enter Mode 2 (Box-Only / Edit Frame) via app-shell UI or app properties
    await page.evaluate(() => {
      window.app.activeCroppingMode = 2;
      window.app.update();
    });
    await page.waitForTimeout(300);

    // Get initial position and placement offsets
    const initial = await page.evaluate(() => {
      const box = window.app.imageBoxes[0];
      return {
        x: box.x,
        y: box.y,
        width: box.width,
        height: box.height,
        offsetX: box.placement?.offsetX || 0,
        offsetY: box.placement?.offsetY || 0,
      };
    });

    // 1. Drag (move) the frame
    const imageBox = await imageOverlay.boundingBox();
    const startX = imageBox.x + imageBox.width / 2;
    const startY = imageBox.y + imageBox.height / 2;
    
    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await page.mouse.move(startX + 50, startY + 30);
    await page.mouse.up();
    await page.waitForTimeout(300);

    const postDrag = await page.evaluate(() => {
      const box = window.app.imageBoxes[0];
      return {
        x: box.x,
        y: box.y,
        offsetX: box.placement?.offsetX || 0,
        offsetY: box.placement?.offsetY || 0,
      };
    });

    // Frame should have moved
    expect(postDrag.x).not.toBeCloseTo(initial.x, 1);
    expect(postDrag.y).not.toBeCloseTo(initial.y, 1);
    // In Mode 2, dragging (moving) the frame moves the content too, so relative offsets MUST remain unchanged!
    expect(postDrag.offsetX).toBeCloseTo(initial.offsetX, 1);
    expect(postDrag.offsetY).toBeCloseTo(initial.offsetY, 1);

    // 2. Resize the frame (using handle 'se')
    const handle = page.locator('[data-handle="se"]');
    const handleBox = await handle.boundingBox();
    const handleX = handleBox.x + handleBox.width / 2;
    const handleY = handleBox.y + handleBox.height / 2;

    await page.mouse.move(handleX, handleY);
    await page.mouse.down();
    await page.mouse.move(handleX + 40, handleY + 20);
    await page.mouse.up();
    await page.waitForTimeout(300);

    const postResize = await page.evaluate(() => {
      const box = window.app.imageBoxes[0];
      return {
        x: box.x,
        y: box.y,
        offsetX: box.placement?.offsetX || 0,
        offsetY: box.placement?.offsetY || 0,
      };
    });

    // In Mode 2, resizing the frame keeps the content static in pasteboard space.
    // This means the relative offsetX/offsetY must change to offset the resize!
    expect(postResize.offsetX).not.toBeCloseTo(postDrag.offsetX, 1);
    expect(postResize.offsetY).not.toBeCloseTo(postDrag.offsetY, 1);
  });

  test('Mode 3: Dragging content keeps frame static, and resizing content also keeps frame static', async ({ page }) => {
    const canvas = page.locator('#svg-container');
    await canvas.click({ position: { x: 10, y: 10 } });

    const canvasBox = await canvas.boundingBox();
    const cx = canvasBox.x + canvasBox.width / 2;
    const cy = canvasBox.y + canvasBox.height / 2;

    await dropImageAt(page, cx, cy, { width: 100, height: 100 });
    await expect(page.locator('[data-image-box="true"]')).toHaveCount(1, { timeout: 5000 });

    const imageOverlay = page.locator('[data-box-id^="image-"][data-handle="body"]');
    // Double click to enter Mode 3 (Edit Content)
    await imageOverlay.dblclick();
    await page.waitForTimeout(300);

    // Get initial position and placement offsets
    const initial = await page.evaluate(() => {
      const box = window.app.imageBoxes[0];
      return {
        x: box.x,
        y: box.y,
        width: box.width,
        height: box.height,
        offsetX: box.placement?.offsetX || 0,
        offsetY: box.placement?.offsetY || 0,
      };
    });

    // 1. Drag (move) the content (handle is orange content handle body)
    const contentBodyHandle = page.locator('[data-box-id^="image-"][data-handle="content_body"]').first();
    await expect(contentBodyHandle).toBeVisible();

    const handleBox = await contentBodyHandle.boundingBox();
    const startX = handleBox.x + handleBox.width / 2;
    const startY = handleBox.y + handleBox.height / 2;

    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await page.mouse.move(startX + 60, startY + 40);
    await page.mouse.up();
    await page.waitForTimeout(300);

    const postDrag = await page.evaluate(() => {
      const box = window.app.imageBoxes[0];
      return {
        x: box.x,
        y: box.y,
        width: box.width,
        height: box.height,
        offsetX: box.placement?.offsetX || 0,
        offsetY: box.placement?.offsetY || 0,
      };
    });

    // Dragging the content does NOT move the frame!
    expect(postDrag.x).toBeCloseTo(initial.x, 1);
    expect(postDrag.y).toBeCloseTo(initial.y, 1);
    // Relative placement offsets should change
    expect(postDrag.offsetX).not.toBeCloseTo(initial.offsetX, 1);
    expect(postDrag.offsetY).not.toBeCloseTo(initial.offsetY, 1);

    // 2. Resize the content (using handle 'content_se')
    const contentSeHandle = page.locator('[data-handle="content_se"]');
    await expect(contentSeHandle).toBeVisible();

    const seBox = await contentSeHandle.boundingBox();
    const seX = seBox.x + seBox.width / 2;
    const seY = seBox.y + seBox.height / 2;

    await page.mouse.move(seX, seY);
    await page.mouse.down();
    await page.mouse.move(seX + 40, seY + 30);
    await page.mouse.up();
    await page.waitForTimeout(300);

    const postResize = await page.evaluate(() => {
      const box = window.app.imageBoxes[0];
      return {
        x: box.x,
        y: box.y,
        width: box.width,
        height: box.height,
        offsetX: box.placement?.offsetX || 0,
        offsetY: box.placement?.offsetY || 0,
      };
    });

    // In Mode 3, resizing the content keeps the frame static!
    expect(postResize.x).toBeCloseTo(postDrag.x, 1);
    expect(postResize.y).toBeCloseTo(postDrag.y, 1);
    expect(postResize.width).toBeCloseTo(postDrag.width, 1);
    expect(postResize.height).toBeCloseTo(postDrag.height, 1);
    // But relative placement offsets/scales must have changed
    expect(postResize.offsetX).not.toBeCloseTo(postDrag.offsetX, 1);
    expect(postResize.offsetY).not.toBeCloseTo(postDrag.offsetY, 1);

    // 3. Drag the content by clicking at a point outside the frame but inside the expanded image bounds
    // The frame bottom-right was at seX, seY. The expanded content bottom-right is at seX + 40, seY + 30.
    // So clicking at seX + 20, seY + 15 is outside the frame, but inside the image bounds.
    await page.mouse.move(seX + 20, seY + 15);
    await page.mouse.down();
    await page.mouse.move(seX - 10, seY - 5);
    await page.mouse.up();
    await page.waitForTimeout(300);

    const postBoundsDrag = await page.evaluate(() => {
      const box = window.app.imageBoxes[0];
      return {
        x: box.x,
        y: box.y,
        offsetX: box.placement?.offsetX || 0,
        offsetY: box.placement?.offsetY || 0,
      };
    });

    // The frame remains static
    expect(postBoundsDrag.x).toBeCloseTo(postResize.x, 1);
    expect(postBoundsDrag.y).toBeCloseTo(postResize.y, 1);
    // But the image offsets have moved/changed!
    expect(postBoundsDrag.offsetX).not.toBeCloseTo(postResize.offsetX, 1);
    expect(postBoundsDrag.offsetY).not.toBeCloseTo(postResize.offsetY, 1);
  });

  test('Mode 1: Single-edge resize anchors on the opposite handle center', async ({ page }) => {
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

    // Get initial bounds of the box
    const initialBox = await page.evaluate(() => {
      const box = window.app.imageBoxes[0];
      return {
        x: box.x,
        y: box.y,
        width: box.width,
        height: box.height,
        centerX: box.x + box.width / 2,
        centerY: box.y + box.height / 2,
      };
    });

    // Locate the 's' (south) handle and drag it down
    const southHandle = page.locator('[data-handle="s"]');
    const handleBox = await southHandle.boundingBox();
    const handleX = handleBox.x + handleBox.width / 2;
    const handleY = handleBox.y + handleBox.height / 2;

    await page.mouse.move(handleX, handleY);
    await page.mouse.down();
    await page.mouse.move(handleX, handleY + 50);
    await page.mouse.up();
    await page.waitForTimeout(300);

    const postResize = await page.evaluate(() => {
      const box = window.app.imageBoxes[0];
      return {
        x: box.x,
        y: box.y,
        width: box.width,
        height: box.height,
        centerX: box.x + box.width / 2,
      };
    });

    // Height should have increased (since we dragged south handle down)
    expect(postResize.height).toBeGreaterThan(initialBox.height);
    // Top edge (y) should remain exactly the same since north handle center is the origo
    expect(postResize.y).toBeCloseTo(initialBox.y, 1);
    // Because aspect ratio was preserved, width should have also increased
    expect(postResize.width).toBeGreaterThan(initialBox.width);
    // The center X of the box should remain the same since scaling scales out symmetrically from center X
    expect(postResize.centerX).toBeCloseTo(initialBox.centerX, 1);
  });
});
