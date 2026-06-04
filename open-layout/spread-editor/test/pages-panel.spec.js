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

    // Verify that Spread 1 card is highlighted as active since page 2 belongs to it
    const spread1Card = page.locator('[data-page-index="1"]');
    await expect(spread1Card).toHaveClass(/active/);
  });
});
