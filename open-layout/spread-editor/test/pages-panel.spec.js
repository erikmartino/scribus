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

    // Create a unique test document via the POST copy endpoint from the brochure-q2 template
    testDocSlug = `test-pages-w${testInfo.workerIndex}-${Date.now()}`;
    testDocDir = path.join(STORE_DIR, USER, testDocSlug);

    const res = await request.post(`/store/${USER}/${testDocSlug}`, {
      data: { from: 'alice/brochure-q2' },
    });
    expect(res.status()).toBe(201);

    // Open the spread editor with the doc param
    await page.goto(`/spread-editor/index.html?doc=${USER}/${testDocSlug}`);
    await page.waitForSelector('scribus-app-shell:defined');
    const statusEl = page.locator('#status');
    await expect(statusEl).toHaveText(/Ready/, { timeout: 20000 });
  });

  test.afterEach(async () => {
    // Clean up test document
    fs.rmSync(testDocDir, { recursive: true, force: true });
  });

  test('should support pages side panel and switching spreads', async ({ page }) => {
    const statusEl = page.locator('#status');

    // The Pages panel tab button should be visible in the sidebar
    const pagesTab = page.locator('[data-panel-id="pages"]');
    await expect(pagesTab).toBeVisible();
    await pagesTab.click();

    // Verify that both Spread 1 and Spread 2 cards are visible
    const spread1Card = page.locator('[data-spread-id="spread-1"]');
    const spread2Card = page.locator('[data-spread-id="spread-2"]');
    await expect(spread1Card).toBeVisible();
    await expect(spread2Card).toBeVisible();

    // Verify that Spread 1 displays details of pages
    await expect(spread1Card.locator('.spread-meta')).toHaveText(/Pages: 1, 2/);
    await expect(spread2Card.locator('.spread-meta')).toHaveText(/Page: 2/);

    // Verify that Spread 1 is currently active (has .active class)
    await expect(spread1Card).toHaveClass(/active/);
    await expect(spread2Card).not.toHaveClass(/active/);

    // Switch to Spread 2 by clicking its card
    await spread2Card.click();

    // Wait for it to reload (status should show Ready again)
    await expect(statusEl).toHaveText(/Ready/, { timeout: 20000 });

    // Verify that Spread 2 is now active
    await expect(spread2Card).toHaveClass(/active/);
    await expect(spread1Card).not.toHaveClass(/active/);
  });
});
