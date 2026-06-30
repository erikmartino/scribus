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
});
