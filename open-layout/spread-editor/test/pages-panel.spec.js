import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const STORE_DIR = path.resolve(import.meta.dirname, '../../store');
const USER = process.env.E2E_STORE_USER;

test.describe('Pages Side Panel and Multi-Spread Navigation', () => {
  let testDocSlug;
  let testDocDir;

  test.beforeEach(async ({ page, request }, testInfo) => {
    page.on('console', msg => {
      console.log(`BROWSER [${msg.type()}]: ${msg.text()}`);
    });
    page.on('pageerror', err => {
      console.error(`BROWSER [error]: ${err.message}`);
    });
    page.on('requestfailed', request => {
      console.log(`FAILED REQUEST: ${request.url()} - ${request.failure()?.errorText || 'Unknown'}`);
    });
    page.on('response', response => {
      if (!response.ok()) {
        console.log(`FAILED RESPONSE: ${response.url()} - ${response.status()}`);
      }
    });

    // Create a unique test document via the POST copy endpoint from the brochure-q2 template
    testDocSlug = `test-pages-w${testInfo.workerIndex}-${Date.now()}`;
    testDocDir = path.join(STORE_DIR, USER, testDocSlug);

    const res = await request.post(`/store/${USER}/${testDocSlug}`, {
      data: { from: 'alice/brochure-q2' },
    });
    expect(res.status()).toBe(201);
  });

  test.afterEach(async () => {
    // Clean up test document
    fs.rmSync(testDocDir, { recursive: true, force: true });
  });

  test('should support spreads list in pages panel and click-to-jump centering', async ({ page }) => {
    // Open spread editor with active document
    await page.goto(`/spread-editor/index.html?doc=${USER}/${testDocSlug}`);
    await page.waitForSelector('scribus-app-shell:defined');
    const statusEl = page.locator('#status');
    await expect(statusEl).toHaveText(/Ready/, { timeout: 20000 });

    // Open the Pages panel tab
    const pagesTab = page.locator('[data-panel-id="pages"]');
    await expect(pagesTab).toBeVisible();
    await pagesTab.click();

    // Verify spread cards are rendered (by the index of their first page)
    const spread1Card = page.locator('[data-page-index="1"]'); // Spread 1 starts at Page 1
    const spread2Card = page.locator('[data-page-index="3"]'); // Spread 2 starts at Page 3
    
    await expect(spread1Card).toBeVisible();
    await expect(spread2Card).toBeVisible();

    // Spread 1 should be active by default since we loaded page 1's spread
    await expect(spread1Card).toHaveClass(/active/);

    // Click Spread 2 to trigger spread loading and page navigation
    await spread2Card.click();
    await expect(statusEl).toHaveText(/Ready/, { timeout: 20000 });
    await expect(spread2Card).toHaveClass(/active/);
    await expect(spread1Card).not.toHaveClass(/active/);
    expect(page.url()).toContain('page=3');
  });

  test('should load the correct spread and center the page via URL query parameter', async ({ page }) => {
    // Open spread editor with a specific page query parameter (?page=2)
    // Page 2 is part of Spread 1 (index 1)
    await page.goto(`/spread-editor/index.html?doc=${USER}/${testDocSlug}&page=2`);
    await page.waitForSelector('scribus-app-shell:defined');
    const statusEl = page.locator('#status');
    await expect(statusEl).toHaveText(/Ready/, { timeout: 20000 });

    // Open Pages panel
    const pagesTab = page.locator('[data-panel-id="pages"]');
    await pagesTab.click();

    const spread1Card = page.locator('[data-page-index="1"]');
    await expect(spread1Card).toHaveClass(/active/);
  });

  test('should reuse the same pages-panel DOM element instead of recreating it on update', async ({ page }) => {
    await page.goto(`/spread-editor/index.html?doc=${USER}/${testDocSlug}`);
    await page.waitForSelector('scribus-app-shell:defined');
    const statusEl = page.locator('#status');
    await expect(statusEl).toHaveText(/Ready/, { timeout: 20000 });

    // Open Pages panel
    const pagesTab = page.locator('[data-panel-id="pages"]');
    await pagesTab.click();

    const panelLocator = page.locator('.pages-panel');
    await expect(panelLocator).toBeVisible();

    // Store initial element handle
    const initialHandle = await panelLocator.elementHandle();

    // Find and drag a box slightly to trigger selection and movement updates
    const box = page.locator('.box-rect').first();
    await expect(box).toBeVisible();
    const boxBounds = await box.boundingBox();
    if (boxBounds) {
      await page.mouse.move(boxBounds.x + 10, boxBounds.y + 10);
      await page.mouse.down();
      await page.mouse.move(boxBounds.x + 30, boxBounds.y + 30);
      await page.mouse.up();
    }

    // Get final element handle
    const finalHandle = await panelLocator.elementHandle();

    // Assert that the page panel DOM node reference is exactly the same
    const isSameNode = await page.evaluate(
      ([el1, el2]) => el1 === el2,
      [initialHandle, finalHandle]
    );
    expect(isSameNode).toBe(true);
  });

  test('should reuse the same assets-panel DOM element instead of recreating it on update', async ({ page }) => {
    await page.goto(`/spread-editor/index.html?doc=${USER}/${testDocSlug}`);
    await page.waitForSelector('scribus-app-shell:defined');
    const statusEl = page.locator('#status');
    await expect(statusEl).toHaveText(/Ready/, { timeout: 20000 });

    // Open Assets panel
    const assetsTab = page.locator('[data-panel-id="assets"]');
    await assetsTab.click();

    const panelLocator = page.locator('.assets-panel');
    await expect(panelLocator).toBeVisible();

    // Store initial element handle
    const initialHandle = await panelLocator.elementHandle();

    // Find and drag a box slightly to trigger selection and movement updates
    const box = page.locator('.box-rect').first();
    await expect(box).toBeVisible();
    const boxBounds = await box.boundingBox();
    if (boxBounds) {
      await page.mouse.move(boxBounds.x + 10, boxBounds.y + 10);
      await page.mouse.down();
      await page.mouse.move(boxBounds.x + 30, boxBounds.y + 30);
      await page.mouse.up();
    }

    // Get final element handle
    const finalHandle = await panelLocator.elementHandle();

    // Assert that the assets panel DOM node reference is exactly the same
    const isSameNode = await page.evaluate(
      ([el1, el2]) => el1 === el2,
      [initialHandle, finalHandle]
    );
    expect(isSameNode).toBe(true);
  });
});

