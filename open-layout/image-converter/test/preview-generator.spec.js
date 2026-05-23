import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const STORE_DIR = path.resolve(import.meta.dirname, '../../store');
const USER = process.env.E2E_STORE_USER;

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
    raw[y * rowBytes] = 0;
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

test.describe('Asset Preview Generator', () => {
  let testDocSlug;
  let testDocDir;

  test.beforeEach(async ({ page, request }, testInfo) => {
    page.on('console', msg => console.log(`BROWSER [${msg.type()}]: ${msg.text()}`));
    page.on('pageerror', err => console.error(`BROWSER [error]: ${err.message}`));

    testDocSlug = `test-preview-gen-w${testInfo.workerIndex}-${Date.now()}`;
    testDocDir = path.join(STORE_DIR, USER, testDocSlug);

    // Create a new document in E2E workspace
    const res = await request.post(`/store/${USER}/${testDocSlug}`, {
      data: { from: 'demo/typography-sampler' },
    });
    expect(res.status()).toBe(201);
  });

  test.afterEach(async () => {
    fs.rmSync(testDocDir, { recursive: true, force: true });
  });

  test('scans and processes assets with correct downscaled bounds', async ({ page }) => {
    // 1. Create a large high-res asset folder manually (1000x800px)
    const largeAssetDir = path.join(testDocDir, 'assets', 'large-image');
    fs.mkdirSync(largeAssetDir, { recursive: true });
    
    const largePng = makePng(1000, 800, () => [255, 0, 0, 255]); // red
    fs.writeFileSync(path.join(largeAssetDir, 'large-image.png'), largePng);
    fs.writeFileSync(path.join(largeAssetDir, 'meta.json'), JSON.stringify({
      mime: 'image/png',
      width: 1000,
      height: 800,
      sizeBytes: largePng.length
    }));

    // 2. Create a small asset folder manually (300x200px)
    const smallAssetDir = path.join(testDocDir, 'assets', 'small-image');
    fs.mkdirSync(smallAssetDir, { recursive: true });

    const smallPng = makePng(300, 200, () => [0, 0, 255, 255]); // blue
    fs.writeFileSync(path.join(smallAssetDir, 'small-image.png'), smallPng);
    fs.writeFileSync(path.join(smallAssetDir, 'meta.json'), JSON.stringify({
      mime: 'image/png',
      width: 300,
      height: 200,
      sizeBytes: smallPng.length
    }));

    // 3. Navigate to preview-generator.html
    await page.goto('/image-converter/preview-generator.html');

    // 4. Click Scan & Generate
    await page.locator('#action-btn').click();

    // 5. Wait for completion log or status to show 'All previews generated successfully!'
    await expect(page.locator('#status-text')).toHaveText('All previews generated successfully!', { timeout: 15000 });

    // 6. Verify that large-image-preview.jpg was created at correct size proportionally (500x400px)
    const largePreviewPath = path.join(largeAssetDir, 'large-image-preview.jpg');
    expect(fs.existsSync(largePreviewPath)).toBe(true);

    const largeMeta = JSON.parse(fs.readFileSync(path.join(largeAssetDir, 'meta.json'), 'utf-8'));
    expect(largeMeta.preview).toBe('large-image-preview.jpg');
    expect(largeMeta.previewWidth).toBe(500);
    expect(largeMeta.previewHeight).toBe(400);

    // 7. Verify that small-image-preview.jpg was created retaining its original size (300x200px)
    const smallPreviewPath = path.join(smallAssetDir, 'small-image-preview.jpg');
    expect(fs.existsSync(smallPreviewPath)).toBe(true);

    const smallMeta = JSON.parse(fs.readFileSync(path.join(smallAssetDir, 'meta.json'), 'utf-8'));
    expect(smallMeta.preview).toBe('small-image-preview.jpg');
    expect(smallMeta.previewWidth).toBe(300);
    expect(smallMeta.previewHeight).toBe(200);

    // 8. Verify the processed metrics
    await expect(page.locator('#metric-scanned')).not.toHaveText('0');
    await expect(page.locator('#metric-pending')).toHaveText('0');
  });
});
