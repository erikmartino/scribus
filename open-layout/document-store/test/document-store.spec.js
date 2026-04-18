import { test, expect } from '@playwright/test';

/** Wire up browser console/error forwarding for diagnostics. */
function forwardBrowserLogs(page) {
  page.on('console', msg => {
    console.log(`BROWSER [${msg.type()}]: ${msg.text()}`);
  });
  page.on('pageerror', err => {
    console.error(`BROWSER [error]: ${err.message}`);
  });
}

test.describe('Document Inspector', () => {
  test('shows no-doc message when ?doc param is missing', async ({ page }) => {
    forwardBrowserLogs(page);
    await page.goto('/document-store/index.html');
    await page.waitForSelector('#no-doc', { timeout: 10000 });

    const noDoc = page.locator('#no-doc');
    await expect(noDoc).toBeVisible();
    await expect(noDoc).toContainText('No document specified');
  });

  test('loads and displays typography-sampler metadata', async ({ page }) => {
    forwardBrowserLogs(page);
    await page.goto('/document-store/index.html?doc=demo/typography-sampler');
    await page.waitForSelector('#doc-header', { timeout: 15000 });

    // Document title
    const title = page.locator('#doc-title');
    await expect(title).toHaveText('Typography Sampler');

    // Metadata fields
    const header = page.locator('#doc-header');
    await expect(header).toContainText('open-layout/v1');
    await expect(header).toContainText('210 x 297');
  });

  test('loads and displays brochure-q2 with bleed', async ({ page }) => {
    forwardBrowserLogs(page);
    await page.goto('/document-store/index.html?doc=alice/brochure-q2');
    await page.waitForSelector('#doc-header', { timeout: 15000 });

    const title = page.locator('#doc-title');
    await expect(title).toHaveText('Q2 Product Brochure');

    const header = page.locator('#doc-header');
    await expect(header).toContainText('Bleed');
  });

  test('Spreads section is expandable and shows frames', async ({ page }) => {
    forwardBrowserLogs(page);
    await page.goto('/document-store/index.html?doc=demo/typography-sampler');
    await page.waitForSelector('#doc-header', { timeout: 15000 });

    // Click the Spreads section header
    const spreadsHeader = page.locator('[data-section="spreads"] .tree-section-header');
    await spreadsHeader.click();

    // Body should become visible
    const body = page.locator('[data-section="spreads"] .tree-section-body');
    await expect(body).toBeVisible();

    // Should contain spread-1
    await expect(body).toContainText('spread-1');

    // Should show the frame-main reference
    await expect(body).toContainText('frame-main');
    await expect(body).toContainText('story-main');
  });

  test('Stories section shows paragraph details', async ({ page }) => {
    forwardBrowserLogs(page);
    await page.goto('/document-store/index.html?doc=demo/typography-sampler');
    await page.waitForSelector('#doc-header', { timeout: 15000 });

    const storiesHeader = page.locator('[data-section="stories"] .tree-section-header');
    await storiesHeader.click();

    const body = page.locator('[data-section="stories"] .tree-section-body');
    await expect(body).toBeVisible();

    // Should contain story-main
    await expect(body).toContainText('story-main');

    // Should show paragraph count
    await expect(body).toContainText('3 paragraph(s)');

    // Should show text preview
    await expect(body).toContainText('Typography Sampler');
  });

  test('Paragraph Styles section shows style properties', async ({ page }) => {
    forwardBrowserLogs(page);
    await page.goto('/document-store/index.html?doc=demo/typography-sampler');
    await page.waitForSelector('#doc-header', { timeout: 15000 });

    const stylesHeader = page.locator('[data-section="paragraph-styles"] .tree-section-header');
    await stylesHeader.click();

    const body = page.locator('[data-section="paragraph-styles"] .tree-section-body');
    await expect(body).toBeVisible();

    // Should show the body and lead styles
    await expect(body).toContainText('body');
    await expect(body).toContainText('lead');
  });

  test('All Files section lists document files', async ({ page }) => {
    forwardBrowserLogs(page);
    await page.goto('/document-store/index.html?doc=demo/typography-sampler');
    await page.waitForSelector('#doc-header', { timeout: 15000 });

    const filesHeader = page.locator('[data-section="all-files"] .tree-section-header');
    await filesHeader.click();

    const body = page.locator('[data-section="all-files"] .tree-section-body');
    await expect(body).toBeVisible();

    await expect(body).toContainText('document.json');
    await expect(body).toContainText('spreads/spread-1.json');
    await expect(body).toContainText('stories/story-main.json');
  });

  test('brochure-q2 shows multiple spreads, stories, and assets', async ({ page }) => {
    forwardBrowserLogs(page);
    await page.goto('/document-store/index.html?doc=alice/brochure-q2');
    await page.waitForSelector('#doc-header', { timeout: 15000 });

    // Spreads badge should show 2
    const spreadsBadge = page.locator('[data-section="spreads"] .badge');
    await expect(spreadsBadge).toHaveText('2');

    // Stories badge should show 4
    const storiesBadge = page.locator('[data-section="stories"] .badge');
    await expect(storiesBadge).toHaveText('4');

    // Assets badge should show 1
    const assetsBadge = page.locator('[data-section="assets"] .badge');
    await expect(assetsBadge).toHaveText('1');

    // Expand assets and verify hero-photo
    const assetsHeader = page.locator('[data-section="assets"] .tree-section-header');
    await assetsHeader.click();
    const assetsBody = page.locator('[data-section="assets"] .tree-section-body');
    await expect(assetsBody).toContainText('hero-photo');
  });

  test('status bar shows loaded message', async ({ page }) => {
    forwardBrowserLogs(page);
    await page.goto('/document-store/index.html?doc=demo/typography-sampler');
    await page.waitForSelector('#doc-header', { timeout: 15000 });

    const status = page.locator('#status');
    await expect(status).toContainText('Loaded');
    await expect(status).toContainText('Typography Sampler');
  });
});
