import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const STORE_DIR = path.resolve(import.meta.dirname, '../../store');
const TEST_IMAGES_DIR = path.resolve(import.meta.dirname, '../../test-images');
const USER = process.env.E2E_STORE_USER;

test.describe('Preview Worker — TIFF preview generation', () => {
  let testDocSlug;
  let testDocDir;

  test.beforeEach(async ({ page }, testInfo) => {
    page.on('console', msg => console.log(`BROWSER [${msg.type()}]: ${msg.text()}`));
    page.on('pageerror', err => console.error(`BROWSER [error]: ${err.message}`));

    testDocSlug = `test-preview-worker-w${testInfo.workerIndex}-${Date.now()}`;
    testDocDir = path.join(STORE_DIR, USER, testDocSlug);
    fs.mkdirSync(testDocDir, { recursive: true });
    // Minimal document.json so the store doesn't reject requests
    fs.writeFileSync(path.join(testDocDir, 'document.json'), JSON.stringify({
      title: 'Preview Worker Test',
      created: new Date().toISOString(),
      modified: new Date().toISOString(),
    }));
  });

  test.afterEach(async () => {
    fs.rmSync(testDocDir, { recursive: true, force: true });
  });

  test('generates a JPEG preview for a large TIFF using wasm-vips', async ({ page }) => {
    test.setTimeout(300_000); // 163 MB tiled JPEG-TIFF: stream to OPFS + wasm-vips thumbnail
    // ── 1. Install the CMU-1 TIFF as an asset in the test document ───────────
    const tifSrc = path.join(TEST_IMAGES_DIR, 'CMU-1.tif');
    if (!fs.existsSync(tifSrc)) {
      test.skip(true, 'CMU-1.tif not found in test-images/ — skipping');
    }

    const assetName = 'cmu-1';
    const assetDir = path.join(testDocDir, 'assets', assetName);
    fs.mkdirSync(assetDir, { recursive: true });
    fs.copyFileSync(tifSrc, path.join(assetDir, `${assetName}.tiff`));
    fs.writeFileSync(path.join(assetDir, 'meta.json'), JSON.stringify({
      mime: 'image/tiff',
      width: 46592,
      height: 33792,
      sizeBytes: fs.statSync(tifSrc).size,
    }));

    // ── 2. Navigate to preview-worker.html and wait for the meta.json PUT ────
    //    The worker PUTs the preview image then PUTs the updated meta.json.
    //    Waiting for the meta.json PUT confirms the full pipeline completed.
    const metaPut = page.waitForResponse(
      r => r.url().includes(`/${USER}/${testDocSlug}/assets/${assetName}/meta.json`) &&
           r.request().method() === 'PUT',
      { timeout: 270_000 },
    );

    await page.goto('/image-converter/preview-worker.html');
    const metaResponse = await metaPut;
    expect(metaResponse.status()).toBeLessThan(300);

    // ── 3. Verify the preview JPEG was written to disk ────────────────────────
    const previewPath = path.join(assetDir, `${assetName}-preview.jpg`);
    expect(fs.existsSync(previewPath), 'preview JPEG should exist').toBe(true);
    expect(fs.statSync(previewPath).size, 'preview should be a non-trivial JPEG').toBeGreaterThan(5_000);

    // ── 4. Verify meta.json was updated with preview fields ───────────────────
    const meta = JSON.parse(fs.readFileSync(path.join(assetDir, 'meta.json'), 'utf-8'));
    expect(meta.preview).toBe(`${assetName}-preview.jpg`);

    // For a 46592×33792 source the output should fit within 500×500.
    expect(meta.previewWidth).toBeGreaterThan(0);
    expect(meta.previewWidth).toBeLessThanOrEqual(500);
    expect(meta.previewHeight).toBeGreaterThan(0);
    expect(meta.previewHeight).toBeLessThanOrEqual(500);
    // Width is the long edge — expect it to be close to 500.
    expect(meta.previewWidth).toBeGreaterThanOrEqual(490);
  });
});
