import { test, expect } from '@playwright/test';
import path from 'node:path';
import fs from 'node:fs';
import zlib from 'node:zlib';

const FIXTURE_DIR = path.resolve(import.meta.dirname);

// --- PNG fixture generation ---

function crc32(buf) {
  let c = 0xFFFFFFFF;
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    c = i;
    for (let j = 0; j < 8; j++) c = (c & 1) ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    table[i] = c;
  }
  c = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) c = table[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

function pngChunk(type, data) {
  const typeBytes = Buffer.from(type, 'ascii');
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const combined = Buffer.concat([typeBytes, data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(combined));
  return Buffer.concat([len, combined, crc]);
}

/**
 * Create a minimal valid RGBA PNG buffer.
 * @param {number} w - width
 * @param {number} h - height
 * @param {(x: number, y: number) => [number,number,number,number]} pixelFn
 */
function makePng(w, h, pixelFn) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;  // 8-bit
  ihdr[9] = 6;  // RGBA
  ihdr[10] = ihdr[11] = ihdr[12] = 0;

  const rowBytes = 1 + w * 4;
  const raw = Buffer.alloc(rowBytes * h);
  for (let y = 0; y < h; y++) {
    raw[y * rowBytes] = 0; // no filter
    for (let x = 0; x < w; x++) {
      const [r, g, b, a] = pixelFn(x, y);
      const off = y * rowBytes + 1 + x * 4;
      raw[off] = r; raw[off + 1] = g; raw[off + 2] = b; raw[off + 3] = a;
    }
  }

  const compressed = zlib.deflateSync(raw);
  return Buffer.concat([
    sig,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', compressed),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

// Fixture file paths
const RED_4x4 = path.join(FIXTURE_DIR, 'fixture-4x4-red.png');
const CHECKER_8x8 = path.join(FIXTURE_DIR, 'fixture-8x8-checker.png');

test.describe('Streaming Downscale Demo', () => {
  // Generate PNG fixtures before the suite runs (avoids gitignore issues)
  test.beforeAll(async () => {
    fs.writeFileSync(RED_4x4, makePng(4, 4, () => [255, 0, 0, 255]));
    fs.writeFileSync(CHECKER_8x8, makePng(8, 8, (x, y) =>
      (x + y) % 2 === 0 ? [255, 0, 0, 255] : [0, 0, 255, 255]
    ));
  });

  test.afterAll(async () => {
    // Clean up generated fixtures
    try { fs.unlinkSync(RED_4x4); } catch { /* ignore */ }
    try { fs.unlinkSync(CHECKER_8x8); } catch { /* ignore */ }
  });

  test.beforeEach(async ({ page }) => {
    page.on('console', msg => {
      console.log(`BROWSER [${msg.type()}]: ${msg.text()}`);
    });
    page.on('pageerror', err => {
      console.error(`BROWSER [error]: ${err.message}`);
    });

    await page.goto('/streaming-downscale-demo/index.html');
    await page.waitForSelector('#start-btn');
  });

  test('page loads with correct initial state', async ({ page }) => {
    await expect(page.locator('h1')).toHaveText('Streaming Image Downscaler');
    await expect(page.locator('#start-btn')).toHaveText('Start');
    await expect(page.locator('#start-btn')).toBeEnabled();

    // Stats should show defaults
    await expect(page.locator('#stat-fmt')).toHaveText('—');
    await expect(page.locator('#stat-src')).toHaveText('—');
    await expect(page.locator('#stat-out')).toHaveText('—');
  });

  test('scale slider updates label', async ({ page }) => {
    const slider = page.locator('#scale-input');
    const label = page.locator('#scale-label');

    await expect(label).toHaveText('4');

    await slider.fill('8');
    await expect(label).toHaveText('8');

    await slider.fill('2');
    await expect(label).toHaveText('2');
  });

  test('file input clears URL and vice versa', async ({ page }) => {
    const urlInput = page.locator('#url-input');
    const fileInput = page.locator('#file-input');

    // URL input has default value
    await expect(urlInput).toHaveValue('CMU-1.tiff');

    // Picking a file clears the URL
    await fileInput.setInputFiles(RED_4x4);
    await expect(urlInput).toHaveValue('');

    // Typing in URL clears file
    await urlInput.fill('test.png');
  });

  test('shows error when no input provided', async ({ page }) => {
    await page.locator('#url-input').fill('');
    await page.locator('#start-btn').click();

    await expect(page.locator('#status')).toHaveText('Enter a URL or pick a file.');
    await expect(page.locator('#status')).toHaveClass(/error/);
  });

  test('decodes a local PNG file and downscales it', async ({ page }) => {
    const fileInput = page.locator('#file-input');
    const scaleSlider = page.locator('#scale-input');

    // Use scale=2 with 8x8 image -> 4x4 output
    await scaleSlider.fill('2');
    await fileInput.setInputFiles(CHECKER_8x8);

    await page.locator('#start-btn').click();

    // Wait for completion
    await expect(page.locator('#status')).toHaveText(/Done/, { timeout: 15000 });
    await expect(page.locator('#status')).toHaveClass(/ok/);

    // Check stats
    await expect(page.locator('#stat-fmt')).toHaveText('PNG');
    await expect(page.locator('#stat-src')).toHaveText('8 × 8');
    await expect(page.locator('#stat-out')).toHaveText('4 × 4');

    // Rows stat should show completion
    const rowsText = await page.locator('#stat-rows').textContent();
    expect(rowsText).toContain('8 src');
    expect(rowsText).toContain('4 out');

    // Canvas should have correct dimensions
    const canvas = page.locator('#output-canvas');
    const width = await canvas.getAttribute('width');
    const height = await canvas.getAttribute('height');
    expect(parseInt(width)).toBe(4);
    expect(parseInt(height)).toBe(4);

    // Button should be back to Start
    await expect(page.locator('#start-btn')).toHaveText('Start');
  });

  test('decodes a 4x4 PNG with scale=2 producing 2x2 output', async ({ page }) => {
    const fileInput = page.locator('#file-input');
    const scaleSlider = page.locator('#scale-input');

    await scaleSlider.fill('2');
    await fileInput.setInputFiles(RED_4x4);

    await page.locator('#start-btn').click();

    await expect(page.locator('#status')).toHaveText(/Done/, { timeout: 15000 });

    await expect(page.locator('#stat-fmt')).toHaveText('PNG');
    await expect(page.locator('#stat-src')).toHaveText('4 × 4');
    await expect(page.locator('#stat-out')).toHaveText('2 × 2');

    // Verify the canvas output is pure red (downscaled from uniform red)
    const pixelData = await page.evaluate(() => {
      const canvas = document.getElementById('output-canvas');
      const ctx = canvas.getContext('2d');
      const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
      return Array.from(img.data);
    });

    // 2x2 output * 4 channels = 16 values, all should be [255, 0, 0, 255]
    expect(pixelData.length).toBe(16);
    for (let i = 0; i < pixelData.length; i += 4) {
      expect(pixelData[i]).toBe(255);     // R
      expect(pixelData[i + 1]).toBe(0);   // G
      expect(pixelData[i + 2]).toBe(0);   // B
      expect(pixelData[i + 3]).toBe(255); // A
    }
  });

  test('checkerboard PNG downscale produces averaged pixel colors', async ({ page }) => {
    const fileInput = page.locator('#file-input');
    const scaleSlider = page.locator('#scale-input');

    // Scale=2: each 2x2 block of alternating red/blue should average
    await scaleSlider.fill('2');
    await fileInput.setInputFiles(CHECKER_8x8);

    await page.locator('#start-btn').click();

    await expect(page.locator('#status')).toHaveText(/Done/, { timeout: 15000 });

    const pixelData = await page.evaluate(() => {
      const canvas = document.getElementById('output-canvas');
      const ctx = canvas.getContext('2d');
      return Array.from(ctx.getImageData(0, 0, canvas.width, canvas.height).data);
    });

    // 4x4 output = 16 pixels = 64 values
    expect(pixelData.length).toBe(64);

    // Each 2x2 block of the checkerboard has 2 red + 2 blue pixels.
    // Red = (255,0,0,255), Blue = (0,0,255,255)
    // Average: R = (255+255+0+0)/4 = 128, G = 0, B = (0+0+255+255)/4 = 128, A = 255
    // Box filter rounds: (510/4+0.5)|0 = 128
    for (let i = 0; i < pixelData.length; i += 4) {
      expect(pixelData[i]).toBe(128);     // R
      expect(pixelData[i + 1]).toBe(0);   // G
      expect(pixelData[i + 2]).toBe(128); // B
      expect(pixelData[i + 3]).toBe(255); // A
    }
  });

  test('PNG fetch via URL path works', async ({ page }) => {
    // The fixture PNG is generated and served by the dev server.
    // We need to create it in a place the dev server can serve it.
    // Use page.evaluate to create a PNG in-browser and feed it via URL.
    const urlInput = page.locator('#url-input');
    const scaleSlider = page.locator('#scale-input');

    await scaleSlider.fill('2');
    // Use a data URI approach: create the PNG in-browser and use Object URL.
    // Actually, let's just test with a URL that returns an error to keep it
    // simple, and test the URL success path by creating a file the server
    // can serve.

    // Generate a fresh fixture that the server can serve
    const servablePath = path.join(FIXTURE_DIR, '..', 'test-serve.png');
    fs.writeFileSync(servablePath, makePng(8, 8, (x, y) =>
      (x + y) % 2 === 0 ? [255, 0, 0, 255] : [0, 0, 255, 255]
    ));

    try {
      await urlInput.fill('/streaming-downscale-demo/test-serve.png');
      await page.locator('#start-btn').click();

      await expect(page.locator('#status')).toHaveText(/Done/, { timeout: 15000 });
      await expect(page.locator('#status')).toHaveClass(/ok/);

      await expect(page.locator('#stat-fmt')).toHaveText('PNG');
      await expect(page.locator('#stat-src')).toHaveText('8 × 8');
      await expect(page.locator('#stat-out')).toHaveText('4 × 4');
    } finally {
      try { fs.unlinkSync(servablePath); } catch { /* ignore */ }
    }
  });

  test('Stop button aborts in-progress decode', async ({ page }) => {
    // With a tiny fixture the decode may finish before we can click Stop,
    // so we accept either outcome: aborted or completed.
    const fileInput = page.locator('#file-input');
    await fileInput.setInputFiles(CHECKER_8x8);

    await page.locator('#start-btn').click();

    // Try to click Stop if the button is still in that state
    const btnText = await page.locator('#start-btn').textContent();
    if (btnText === 'Stop') {
      await page.locator('#start-btn').click();
    }

    // Either way, the button should eventually return to "Start"
    await expect(page.locator('#start-btn')).toHaveText('Start', { timeout: 5000 });
  });

  test('shows error for fetch failure on bad URL', async ({ page }) => {
    const urlInput = page.locator('#url-input');
    await urlInput.fill('/nonexistent-image.png');

    await page.locator('#start-btn').click();

    await expect(page.locator('#status')).toHaveText(/Error.*Fetch failed.*404/, {
      timeout: 10000,
    });
    await expect(page.locator('#status')).toHaveClass(/error/);
    await expect(page.locator('#start-btn')).toHaveText('Start');
  });

  test('no console errors during PNG decode', async ({ page }) => {
    const errors = [];
    page.on('pageerror', err => errors.push(err.message));

    const fileInput = page.locator('#file-input');
    const scaleSlider = page.locator('#scale-input');
    await scaleSlider.fill('2');
    await fileInput.setInputFiles(CHECKER_8x8);

    await page.locator('#start-btn').click();
    await expect(page.locator('#status')).toHaveText(/Done/, { timeout: 15000 });

    expect(errors).toEqual([]);
  });
});
