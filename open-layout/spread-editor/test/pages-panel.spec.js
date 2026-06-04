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

  test('should support individual pages side panel and click-to-jump centering', async ({ page }) => {
    // Open spread editor with active document
    await page.goto(`/spread-editor/index.html?doc=${USER}/${testDocSlug}`);
    await page.waitForSelector('scribus-app-shell:defined');
    const statusEl = page.locator('#status');
    await expect(statusEl).toHaveText(/Ready/, { timeout: 20000 });

    // Open the Pages panel tab
    const pagesTab = page.locator('[data-panel-id="pages"]');
    await expect(pagesTab).toBeVisible();
    await pagesTab.click();

    // Verify individual page cards are rendered via unique page index
    const page1Card = page.locator('[data-page-index="1"]');
    const page2Card = page.locator('[data-page-index="2"]');
    
    await expect(page1Card).toBeVisible();
    await expect(page2Card).toBeVisible();

    // Page 1 should be active by default since we loaded page 1's spread
    await expect(page1Card).toHaveClass(/active/);

    // Clicking Page 2 should keep us on the same spread but shift the active card
    await page2Card.click();
    await expect(page2Card).toHaveClass(/active/);
    await expect(page1Card).not.toHaveClass(/active/);

    // Verify that the URL contains the &page=2 parameter
    const url = page.url();
    expect(url).toContain('page=2');

    // Verify Page 3 is visible and on spread-2
    const page3Card = page.locator('[data-page-index="3"]');
    await expect(page3Card).toBeVisible();

    // Click Page 3 to trigger spread loading and page navigation
    await page3Card.click();
    await expect(statusEl).toHaveText(/Ready/, { timeout: 20000 });
    await expect(page3Card).toHaveClass(/active/);
    await expect(page2Card).not.toHaveClass(/active/);
    expect(page.url()).toContain('page=3');
  });

  test('should load the correct spread and center the page via URL query parameter', async ({ page }) => {
    // Open spread editor with a specific page query parameter (?page=2)
    await page.goto(`/spread-editor/index.html?doc=${USER}/${testDocSlug}&page=2`);
    await page.waitForSelector('scribus-app-shell:defined');
    const statusEl = page.locator('#status');
    await expect(statusEl).toHaveText(/Ready/, { timeout: 20000 });

    // Open Pages panel
    const pagesTab = page.locator('[data-panel-id="pages"]');
    await pagesTab.click();

    // Verify that Page 2 card is highlighted as active
    const page2Card = page.locator('[data-page-index="2"]');
    await expect(page2Card).toHaveClass(/active/);
  });
});
