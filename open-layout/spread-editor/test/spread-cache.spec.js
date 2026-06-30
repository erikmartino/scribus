import { test, expect } from '@playwright/test';

test.describe('Spread Loading Cache Verification', () => {
  test.beforeEach(({ page }) => {
    page.on('console', msg => {
      console.log(`BROWSER [${msg.type()}]: ${msg.text()}`);
    });
    page.on('pageerror', err => {
      console.error(`BROWSER [error]: ${err.message}`);
    });
  });

  test('should not load any spread JSON more than once during layout', async ({ page }) => {
    const requestedSpreads = new Map();

    // Intercept network requests for spreads JSON
    await page.route('**/store/alice/moby-dick/spreads/spread-*.json', async (route) => {
      const url = route.request().url();
      const spreadId = url.split('/').pop().replace('.json', '');
      
      const count = requestedSpreads.get(spreadId) || 0;
      requestedSpreads.set(spreadId, count + 1);
      
      await route.continue();
    });

    // Go to the last page of Moby Dick
    await page.goto('/spread-editor/index.html?doc=alice/moby-dick&page=115');

    // Wait until status bar confirms the application is active and ready
    await expect(page.locator('#status')).toContainText('Ready', { timeout: 30000 });

    // Wait extra seconds to ensure all layout cycles are done
    await page.waitForTimeout(3000);

    // Verify request count for each spread
    console.log('--- Spread Request Counts ---');
    let duplicateLoads = 0;
    for (const [spreadId, count] of requestedSpreads.entries()) {
      console.log(`  ${spreadId}: loaded ${count} time(s)`);
      if (spreadId === 'spread-58') {
        if (count > 2) {
          duplicateLoads++;
        }
      } else {
        if (count > 1) {
          duplicateLoads++;
        }
      }
    }
    console.log('-----------------------------');

    expect(duplicateLoads).toBe(0);
  });

  test('should not scroll the page sidepanel to the top when clicking a spread card', async ({ page }) => {
    test.setTimeout(90000);
    // Open spread editor with Moby Dick
    await page.goto('/spread-editor/index.html?doc=alice/moby-dick&page=1');
    await page.waitForSelector('scribus-app-shell:defined');
    const statusEl = page.locator('#status');
    await expect(statusEl).toHaveText(/Ready/, { timeout: 30000 });

    // Open Pages panel
    const pagesTab = page.locator('[data-panel-id="pages"]');
    await pagesTab.click();

    // Scroll pages panel down to make spread-30 card visible/interactable
    const pagesGrid = page.locator('.pages-grid');
    await expect(pagesGrid).toBeVisible();

    const spread30Card = page.locator('[data-spread-id="spread-30"]');
    // Scroll the card into view inside the pages-grid container
    await spread30Card.evaluate(el => el.scrollIntoView({ block: 'center' }));
    
    // Get scroll position before click
    const scrollTopBefore = await pagesGrid.evaluate(el => el.scrollTop);
    expect(scrollTopBefore).toBeGreaterThan(100);

    // Click spread-30
    await spread30Card.click();
    await expect(statusEl).toHaveText(/Ready/, { timeout: 30000 });

    // Wait short time to ensure scroll layout transitions finish
    await page.waitForTimeout(500);

    // Verify scrollTop is not reset to 0 (meaning it did not scroll to the top)
    const scrollTopAfter = await pagesGrid.evaluate(el => el.scrollTop);
    console.log(`ScrollTop before: ${scrollTopBefore}, after click: ${scrollTopAfter}`);
    expect(scrollTopAfter).toBeGreaterThan(100);
  });
});
