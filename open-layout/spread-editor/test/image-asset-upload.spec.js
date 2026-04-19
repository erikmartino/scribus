import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const STORE_DIR = path.resolve(import.meta.dirname, '../../store');

/**
 * Helper: drop an image onto #svg-container via synthetic DragEvent.
 */
async function dropImageAt(page, x, y, { color = 'red', width = 60, height = 40, name = 'test-image.png' } = {}) {
  return page.evaluate(async ({ x, y, color, width, height, name }) => {
    const c = document.createElement('canvas');
    c.width = width; c.height = height;
    const ctx = c.getContext('2d');
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, width, height);
    const blob = await new Promise(r => c.toBlob(r, 'image/png'));

    const dt = new DataTransfer();
    const file = new File([blob], name, { type: 'image/png' });
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
  }, { x, y, color, width, height, name });
}

test.describe('Image Asset Upload', () => {
  let testDocSlug;
  let testDocDir;

  test.beforeEach(async ({ page, request }) => {
    page.on('console', msg => console.log(`BROWSER [${msg.type()}]: ${msg.text()}`));
    page.on('pageerror', err => console.error(`BROWSER [error]: ${err.message}`));

    // Create a unique test document from the demo template
    testDocSlug = `test-asset-${Date.now()}`;
    testDocDir = path.join(STORE_DIR, 'alice', testDocSlug);

    const res = await request.post(`/store/alice/${testDocSlug}`, {
      data: { from: 'demo/typography-sampler' },
    });
    expect(res.status()).toBe(201);

    // Open the spread editor with the doc param
    await page.goto(`/spread-editor/index.html?doc=alice/${testDocSlug}`);
    await page.waitForSelector('scribus-app-shell:defined');
    const statusEl = page.locator('#status');
    await expect(statusEl).toHaveText(/Ready/, { timeout: 20000 });
  });

  test.afterEach(async () => {
    fs.rmSync(testDocDir, { recursive: true, force: true });
  });

  test('dropping an image uploads it as an asset to the store', async ({ page }) => {
    const canvas = page.locator('#svg-container');
    await canvas.click({ position: { x: 10, y: 10 } });

    const box = await canvas.boundingBox();
    await dropImageAt(page, box.x + box.width / 2, box.y + box.height / 2, {
      name: 'My Photo.png',
    });

    // Wait for the image box to appear
    await expect(page.locator('[data-image-box="true"]')).toHaveCount(1, { timeout: 5000 });

    // Verify asset files were created on disk
    const assetsDir = path.join(testDocDir, 'assets', 'my-photo');
    expect(fs.existsSync(assetsDir)).toBe(true);
    expect(fs.existsSync(path.join(assetsDir, 'my-photo.png'))).toBe(true);
    expect(fs.existsSync(path.join(assetsDir, 'meta.json'))).toBe(true);

    // Verify meta.json content
    const meta = JSON.parse(fs.readFileSync(path.join(assetsDir, 'meta.json'), 'utf-8'));
    expect(meta.mime).toBe('image/png');
    expect(meta.width).toBe(60);
    expect(meta.height).toBe(40);
    expect(meta.sizeBytes).toBeGreaterThan(0);
  });

  test('asset image file is a valid PNG', async ({ page }) => {
    const canvas = page.locator('#svg-container');
    await canvas.click({ position: { x: 10, y: 10 } });

    const box = await canvas.boundingBox();
    await dropImageAt(page, box.x + box.width / 2, box.y + box.height / 2, {
      name: 'pixel.png',
    });
    await expect(page.locator('[data-image-box="true"]')).toHaveCount(1, { timeout: 5000 });

    const imgPath = path.join(testDocDir, 'assets', 'pixel', 'pixel.png');
    expect(fs.existsSync(imgPath)).toBe(true);

    // PNG magic bytes: 89 50 4E 47
    const buf = fs.readFileSync(imgPath);
    expect(buf[0]).toBe(0x89);
    expect(buf[1]).toBe(0x50);
    expect(buf[2]).toBe(0x4e);
    expect(buf[3]).toBe(0x47);
  });

  test('saving with an uploaded asset uses assetRef not imageUrl', async ({ page }) => {
    const canvas = page.locator('#svg-container');
    await canvas.click({ position: { x: 10, y: 10 } });

    const box = await canvas.boundingBox();
    await dropImageAt(page, box.x + box.width / 2, box.y + box.height / 2, {
      name: 'banner.png',
    });
    await expect(page.locator('[data-image-box="true"]')).toHaveCount(1, { timeout: 5000 });

    // Save
    const saveBtn = page.locator('scribus-button[label="Save"]');
    await saveBtn.click();
    await page.waitForTimeout(1500);

    // Read the saved spread JSON
    const spreadPath = path.join(testDocDir, 'spreads', 'spread-1.json');
    const spread = JSON.parse(fs.readFileSync(spreadPath, 'utf-8'));

    // Find the image frame
    const imageFrame = spread.frames.find(f => f.type === 'image' && f.id.startsWith('image-'));
    expect(imageFrame).toBeTruthy();
    expect(imageFrame.assetRef).toBe('banner');
    expect(imageFrame.imageUrl).toBeUndefined();
  });

  test('duplicate asset names get numeric suffixes', async ({ page }) => {
    const canvas = page.locator('#svg-container');
    await canvas.click({ position: { x: 10, y: 10 } });

    const box = await canvas.boundingBox();

    // Drop first image
    await dropImageAt(page, box.x + box.width / 3, box.y + box.height / 2, {
      name: 'icon.png', color: 'red',
    });
    await expect(page.locator('[data-image-box="true"]')).toHaveCount(1, { timeout: 5000 });

    // Drop second image with the same name
    await dropImageAt(page, box.x + 2 * box.width / 3, box.y + box.height / 2, {
      name: 'icon.png', color: 'blue',
    });
    await expect(page.locator('[data-image-box="true"]')).toHaveCount(2, { timeout: 5000 });

    // Both asset folders should exist
    expect(fs.existsSync(path.join(testDocDir, 'assets', 'icon', 'icon.png'))).toBe(true);
    expect(fs.existsSync(path.join(testDocDir, 'assets', 'icon-2', 'icon-2.png'))).toBe(true);
  });

  test('HEAD endpoint returns 200 for existing files and 404 for missing', async ({ request }) => {
    // Check a file that exists (document.json was created by POST copy)
    const existsRes = await request.head(`/store/alice/${testDocSlug}/document.json`);
    expect(existsRes.status()).toBe(200);
    const contentLength = existsRes.headers()['content-length'];
    expect(parseInt(contentLength, 10)).toBeGreaterThan(0);

    // Check a file that does not exist
    const missingRes = await request.head(`/store/alice/${testDocSlug}/nonexistent.json`);
    expect(missingRes.status()).toBe(404);
  });

  test('dropped image renders from store URL not data URL', async ({ page }) => {
    const canvas = page.locator('#svg-container');
    await canvas.click({ position: { x: 10, y: 10 } });

    const box = await canvas.boundingBox();
    await dropImageAt(page, box.x + box.width / 2, box.y + box.height / 2, {
      name: 'photo.png',
    });
    await expect(page.locator('[data-image-box="true"]')).toHaveCount(1, { timeout: 5000 });

    // The image element's href should be a store URL, not a data: URL
    const href = await page.evaluate(() => {
      const svg = document.querySelector('#svg-container svg.content-svg');
      const img = svg.querySelector('image[data-image-box]');
      return img?.getAttribute('href') || img?.getAttributeNS('http://www.w3.org/1999/xlink', 'href');
    });
    expect(href).toContain('/store/');
    expect(href).toContain('photo/photo.png');
    expect(href).not.toContain('data:');
  });
});
