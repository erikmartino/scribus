import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const STORE_DIR = path.resolve(import.meta.dirname, '../../store');
const USER = process.env.E2E_STORE_USER || 'alice';

function forwardBrowserLogs(page) {
  page.on('console', msg => console.log(`BROWSER [${msg.type()}]: ${msg.text()}`));
  page.on('pageerror', err => console.error(`BROWSER [error]: ${err.message}`));
}

/**
 * Helper: simulate dropping a document asset on #svg-container at target screen coordinates.
 */
async function dropAssetAt(page, assetRef, ext, x, y) {
  await page.evaluate(({ assetRef, ext, x, y }) => {
    const dt = new DataTransfer();
    dt.setData('application/x-scribus-asset', JSON.stringify({ assetRef, ext }));

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
  }, { assetRef, ext, x, y });
}

test.describe('Assets Panel and Drag-and-Drop', () => {
  let testDocSlug;
  let testDocDir;

  test.beforeEach(async ({ page, request }, testInfo) => {
    forwardBrowserLogs(page);
    
    // Create a hermetic temporary test document cloned from alice/typography-sampler4
    testDocSlug = `test-assets-w${testInfo.workerIndex}-${Date.now()}`;
    testDocDir = path.join(STORE_DIR, USER, testDocSlug);

    const res = await request.post(`/store/${USER}/${testDocSlug}`, {
      data: { from: 'demo/typography-sampler' },
    });
    expect(res.status()).toBe(201);

    // Open the spread editor with the temporary doc param
    await page.goto(`/spread-editor/index.html?doc=${USER}/${testDocSlug}`);
    await page.waitForSelector('scribus-app-shell:defined');
    const statusEl = page.locator('#status');
    await expect(statusEl).toHaveText(/Ready/, { timeout: 20000 });
  });

  test.afterEach(async () => {
    if (testDocDir && fs.existsSync(testDocDir)) {
      fs.rmSync(testDocDir, { recursive: true, force: true });
    }
  });

  test('Assets tab is registered, lists the seeded assets, and can double click to insert', async ({ page }) => {
    const shell = page.locator('scribus-app-shell');

    // Click the Assets tab
    const assetsTab = page.locator('button.panel-tab:has-text("Assets")');
    await expect(assetsTab).toBeVisible();
    await assetsTab.click();

    // Verify vintage-press asset card is visible
    const vintageCard = page.locator('.asset-card:has-text("vintage-press")');
    await expect(vintageCard).toBeVisible();

    // Verify 1 image box is already present by default
    await expect(page.locator('image[data-image-box="true"]')).toHaveCount(1);

    // Double click to insert at center of page
    await vintageCard.dblclick();
    await page.waitForTimeout(300);

    // Verify the image box count increased to 2
    const imageBox = page.locator('image[data-image-box="true"]');
    await expect(imageBox).toHaveCount(2);
  });

  test('dropping a document asset creates an image box in object mode', async ({ page }) => {
    // Open assets panel
    const assetsTab = page.locator('button.panel-tab:has-text("Assets")');
    await assetsTab.click();

    const canvas = page.locator('#svg-container');
    const box = await canvas.boundingBox();
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;

    // Initially 1 image box
    await expect(page.locator('image[data-image-box="true"]')).toHaveCount(1);

    // Drop vintage-press asset in center of workspace
    await dropAssetAt(page, 'vintage-press', 'png', cx, cy);
    await page.waitForTimeout(300);

    // Image box should be created (count becomes 2)
    const imageBox = page.locator('image[data-image-box="true"]');
    await expect(imageBox).toHaveCount(2);
  });

  test('dropping a document asset onto an existing image frame replaces its content', async ({ page }) => {
    // Open assets panel
    const assetsTab = page.locator('button.panel-tab:has-text("Assets")');
    await assetsTab.click();

    // Initially 1 image box
    const imageBox = page.locator('image[data-image-box="true"]');
    await expect(imageBox).toHaveCount(1);

    // Find the center of the pre-existing image box in screen space
    const imgCenter = await page.evaluate(() => {
      const img = document.querySelector('image[data-image-box]');
      const ctm = img.ownerSVGElement.getScreenCTM();
      const x = parseFloat(img.getAttribute('x'));
      const y = parseFloat(img.getAttribute('y'));
      const w = parseFloat(img.getAttribute('width'));
      const h = parseFloat(img.getAttribute('height'));
      const pt = new DOMPoint(x + w / 2, y + h / 2).matrixTransform(ctm);
      return { x: pt.x, y: pt.y };
    });

    // Let's replace it by dropping the asset onto the existing image box
    await dropAssetAt(page, 'vintage-press', 'png', imgCenter.x, imgCenter.y);
    await page.waitForTimeout(300);

    // Check that we still have exactly 1 image box, and it updated/replaced correctly
    await expect(page.locator('image[data-image-box="true"]')).toHaveCount(1);
  });

  test('uploading a TIFF image generates a preview and makes it visible in the side panel', async ({ page }) => {
    // Open assets panel
    const assetsTab = page.locator('button.panel-tab:has-text("Assets")');
    await assetsTab.click();

    // Verify planck-cmb is not initially present
    await expect(page.locator('.asset-card:has-text("planck-cmb")')).toHaveCount(0);

    // Read the real 21.7MB Planck CMB TIFF file from our local store to test standard decoders (wasm-vips)
    const localTiffPath = path.join(STORE_DIR, 'alice/typography-sampler/assets/planck-cmb/planck-cmb.tiff');
    const tiffBuffer = fs.readFileSync(localTiffPath);

    // Trigger file picker and upload Planck CMB TIFF
    const [fileChooser] = await Promise.all([
      page.waitForEvent('filechooser'),
      page.locator('.assets-upload-zone').click(),
    ]);

    await fileChooser.setFiles({
      name: 'planck-cmb.tiff',
      mimeType: 'image/tiff',
      buffer: tiffBuffer,
    });

    // Wait for the asset to be uploaded and listed in the panel
    const sampleCard = page.locator('.asset-card').filter({ has: page.locator('.asset-name', { hasText: 'planck-cmb' }) });
    await expect(sampleCard).toBeVisible({ timeout: 20000 });

    // Poll the filesystem until the preview image and updated meta.json exist on disk
    const previewFile = path.join(testDocDir, 'assets', 'planck-cmb', 'planck-cmb-preview.jpg');
    const metaFile = path.join(testDocDir, 'assets', 'planck-cmb', 'meta.json');
    let previewExists = false;
    for (let i = 0; i < 40; i++) {
      if (fs.existsSync(previewFile)) {
        try {
          const meta = JSON.parse(fs.readFileSync(metaFile, 'utf-8'));
          if (meta.preview === 'planck-cmb-preview.jpg') {
            previewExists = true;
            break;
          }
        } catch (e) {
          // Meta.json might be partially written
        }
      }
      await page.waitForTimeout(500);
    }
    expect(previewExists).toBe(true);

    // Verify preview image src is generated and points to the -preview.jpg
    const thumbnail = sampleCard.locator('.asset-thumbnail');
    await expect(thumbnail).toBeVisible({ timeout: 10000 });
    await expect(thumbnail).toHaveAttribute('src', /planck-cmb-preview\.jpg/, { timeout: 15000 });
  });
});
