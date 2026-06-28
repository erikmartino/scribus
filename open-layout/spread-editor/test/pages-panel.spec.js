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

  test('should switch spreads correctly when clicking another spread card in the pages side panel', async ({ page }) => {
    await page.goto(`/spread-editor/index.html?doc=${USER}/${testDocSlug}`);
    await page.waitForSelector('scribus-app-shell:defined');
    const statusEl = page.locator('#status');
    await expect(statusEl).toHaveText(/Ready/, { timeout: 20000 });

    // Open Pages panel
    const pagesTab = page.locator('[data-panel-id="pages"]');
    await pagesTab.click();

    // Verify Spread 2 card exists and click it
    const spread2Card = page.locator('[data-spread-id="spread-2"]');
    await expect(spread2Card).toBeVisible();
    await spread2Card.click();
    await expect(statusEl).toHaveText(/Ready/, { timeout: 20000 });

    // Verify class contains active and page query is correct
    await expect(spread2Card).toHaveClass(/active/);
    expect(page.url()).toContain('page=3');

    // Click Spread 1 card to switch back
    const spread1Card = page.locator('[data-spread-id="spread-1"]');
    await expect(spread1Card).toBeVisible();
    await spread1Card.click();
    await expect(statusEl).toHaveText(/Ready/, { timeout: 20000 });

    // Verify Spread 1 card is now active and URL contains page=1
    await expect(spread1Card).toHaveClass(/active/);
    expect(page.url()).toContain('page=1');
  });

  test('should support adding a new spread with sequential page numbers', async ({ page }) => {
    await page.goto(`/spread-editor/index.html?doc=${USER}/${testDocSlug}`);
    await page.waitForSelector('scribus-app-shell:defined');
    const statusEl = page.locator('#status');
    await expect(statusEl).toHaveText(/Ready/, { timeout: 20000 });

    // Open Pages panel
    const pagesTab = page.locator('[data-panel-id="pages"]');
    await pagesTab.click();

    // Verify initial count
    const initialCards = page.locator('.page-card');
    await expect(initialCards).toHaveCount(2);

    // Click "Add Spread" button
    const addBtn = page.locator('.add-spread-btn');
    await expect(addBtn).toBeVisible();
    await addBtn.click();

    // Confirm the dialog by clicking "Create"
    const dialogCreateBtn = page.locator('scribus-dialog button:has-text("Create")');
    await expect(dialogCreateBtn).toBeVisible();
    await dialogCreateBtn.click();

    // Wait for load/ready
    await expect(statusEl).toHaveText(/Ready/, { timeout: 20000 });

    // Verify there are now 3 spreads
    await expect(initialCards).toHaveCount(3);

    // Verify new spread card page index matches next sequential page (page index 4)
    const spread3Card = page.locator('[data-page-index="4"]');
    await expect(spread3Card).toBeVisible();
    await expect(spread3Card).toHaveClass(/active/);
    expect(page.url()).toContain('page=4');
  });

  test('should support deleting the active spread and switching to adjacent spread', async ({ page }) => {
    await page.goto(`/spread-editor/index.html?doc=${USER}/${testDocSlug}`);
    await page.waitForSelector('scribus-app-shell:defined');
    const statusEl = page.locator('#status');
    await expect(statusEl).toHaveText(/Ready/, { timeout: 20000 });

    // Open Pages panel
    const pagesTab = page.locator('[data-panel-id="pages"]');
    await pagesTab.click();

    const spread1Card = page.locator('[data-page-index="1"]');
    const spread2Card = page.locator('[data-page-index="3"]');

    // Check delete button is initially hidden
    const deleteBtn = page.locator('.page-card[data-spread-id="spread-2"] .spread-delete-btn');
    await expect(deleteBtn).not.toBeVisible();

    // Click spread 2 to make it active
    await spread2Card.click();
    await expect(statusEl).toHaveText(/Ready/, { timeout: 20000 });
    await expect(spread2Card).toHaveClass(/active/);

    // After clicking, mouse is hovering, so delete button is visible
    await expect(deleteBtn).toBeVisible();

    // Intercept confirm dialog and accept it
    page.once('dialog', dialog => dialog.accept());
    await deleteBtn.click();

    // Wait for transition/re-layout
    await expect(statusEl).toHaveText(/Ready/, { timeout: 20000 });

    // Verify only 1 card remains and it is active (spread 1)
    const cards = page.locator('.page-card');
    await expect(cards).toHaveCount(1);
    await expect(spread1Card).toHaveClass(/active/);
    expect(page.url()).toContain('page=1');
  });

  test('should support adding a single right page spread and rendering it correctly', async ({ page }) => {
    await page.goto(`/spread-editor/index.html?doc=${USER}/${testDocSlug}`);
    await page.waitForSelector('scribus-app-shell:defined');
    const statusEl = page.locator('#status');
    await expect(statusEl).toHaveText(/Ready/, { timeout: 20000 });

    // Open Pages panel
    const pagesTab = page.locator('[data-panel-id="pages"]');
    await pagesTab.click();

    // Click "Add Spread" button
    const addBtn = page.locator('.add-spread-btn');
    await expect(addBtn).toBeVisible();
    await addBtn.click();

    // Select right page option in dropdown
    const select = page.locator('scribus-dialog select');
    await expect(select).toBeVisible();
    await select.selectOption('right');

    // Confirm dialog
    const dialogCreateBtn = page.locator('scribus-dialog button:has-text("Create")');
    await dialogCreateBtn.click();

    // Wait for load/ready
    await expect(statusEl).toHaveText(/Ready/, { timeout: 20000 });

    // Verify there are now 3 spreads
    const cards = page.locator('.page-card');
    await expect(cards).toHaveCount(3);

    // Verify page range label displays only 1 page (Page 4)
    const spread3Info = page.locator('.page-card[data-spread-id="spread-3"] .page-spread-info');
    await expect(spread3Info).toHaveText('Page 4');
  });

  test('should reset active mode to object mode when switching spreads', async ({ page }) => {
    await page.goto(`/spread-editor/index.html?doc=${USER}/${testDocSlug}`);
    await page.waitForSelector('scribus-app-shell:defined');
    const statusEl = page.locator('#status');
    await expect(statusEl).toHaveText(/Ready/, { timeout: 20000 });

    // Enter text mode on first box
    const box = page.locator('.box-rect').first();
    await box.dblclick();

    // Verify shell has text mode active
    const shell = page.locator('scribus-app-shell');
    await expect(shell).toHaveAttribute('data-mode', 'text');

    // Open Pages panel
    const pagesTab = page.locator('[data-panel-id="pages"]');
    await pagesTab.click();

    // Click Spread 2 to switch spread
    const spread2Card = page.locator('[data-spread-id="spread-2"]');
    await expect(spread2Card).toBeVisible();
    await spread2Card.click();
    await expect(statusEl).toHaveText(/Ready/, { timeout: 20000 });

    // Verify mode is reset to object mode
    await expect(shell).toHaveAttribute('data-mode', 'object');
  });

  test('should support deleting a non-active spread and correctly update panel cards and page numbers', async ({ page }) => {
    await page.goto(`/spread-editor/index.html?doc=${USER}/${testDocSlug}`);
    await page.waitForSelector('scribus-app-shell:defined');
    const statusEl = page.locator('#status');
    await expect(statusEl).toHaveText(/Ready/, { timeout: 20000 });

    // Open Pages panel
    const pagesTab = page.locator('[data-panel-id="pages"]');
    await pagesTab.click();

    // Verify initially there are 2 cards: Spread 1 (Pages 1-2) and Spread 2 (Pages 3-4)
    const cards = page.locator('.page-card');
    await expect(cards).toHaveCount(2);

    const spread1Card = page.locator('[data-spread-id="spread-1"]');
    const spread2Card = page.locator('[data-spread-id="spread-2"]');
    await expect(spread1Card).toHaveClass(/active/);
    await expect(spread2Card).not.toHaveClass(/active/);

    // Hover/delete Spread 2 (which is non-active, active is Spread 1)
    const deleteBtn = page.locator('.page-card[data-spread-id="spread-2"] .spread-delete-btn');
    // Ensure the delete button is visible on hover
    await spread2Card.hover();
    await expect(deleteBtn).toBeVisible();

    // Intercept confirm dialog and accept it
    page.once('dialog', dialog => dialog.accept());
    await deleteBtn.click();

    // Wait for transition/re-layout
    await expect(statusEl).toHaveText(/Ready/, { timeout: 20000 });

    // Verify only 1 card remains and it is active (spread 1)
    await expect(cards).toHaveCount(1);
    await expect(spread1Card).toHaveClass(/active/);
  });

  test('should support clicking active card to scroll back to its first page', async ({ page }) => {
    await page.goto(`/spread-editor/index.html?doc=${USER}/${testDocSlug}`);
    await page.waitForSelector('scribus-app-shell:defined');
    const statusEl = page.locator('#status');
    await expect(statusEl).toHaveText(/Ready/, { timeout: 20000 });

    // Open Pages panel
    const pagesTab = page.locator('[data-panel-id="pages"]');
    await pagesTab.click();

    const spread1Card = page.locator('[data-spread-id="spread-1"]');
    await expect(spread1Card).toHaveClass(/active/);

    const svgContainer = page.locator('#svg-container');
    
    // Scroll container down/right manually
    await svgContainer.evaluate(el => {
      el.scrollLeft = 500;
      el.scrollTop = 500;
    });

    const scrollLeftBefore = await svgContainer.evaluate(el => el.scrollLeft);
    expect(scrollLeftBefore).toBeGreaterThan(100);

    // Click active card Spread 1 again
    await spread1Card.click();
    await expect(statusEl).toHaveText(/Ready/, { timeout: 20000 });

    // Verify scroll returned to around center (less than 500, e.g. close to 0)
    const scrollLeftAfter = await svgContainer.evaluate(el => el.scrollLeft);
    expect(scrollLeftAfter).toBeLessThan(100);
  });

  test('should isolate new content to the newly created spread after switching spreads', async ({ page }) => {
    // 1. Open the spread editor with the active document (which beforeEach created from alice/brochure-q2 template)
    await page.goto(`/spread-editor/index.html?doc=${USER}/${testDocSlug}`);
    await page.waitForSelector('scribus-app-shell:defined');
    const statusEl = page.locator('#status');
    await expect(statusEl).toHaveText(/Ready/, { timeout: 20000 });

    // Open Pages panel
    const pagesTab = page.locator('[data-panel-id="pages"]');
    await pagesTab.click();

    // Verify initial spread count is 2
    const initialCards = page.locator('.page-card');
    await expect(initialCards).toHaveCount(2);

    // 2. Click "Add Spread" button
    const addBtn = page.locator('.add-spread-btn');
    await expect(addBtn).toBeVisible();
    await addBtn.click();

    // Confirm the dialog by clicking "Create"
    const dialogCreateBtn = page.locator('scribus-dialog button:has-text("Create")');
    await expect(dialogCreateBtn).toBeVisible();
    await dialogCreateBtn.click();

    // Wait for load/ready
    await expect(statusEl).toHaveText(/Ready/, { timeout: 20000 });

    // Verify there are now 3 spreads
    await expect(initialCards).toHaveCount(3);

    // Verify new spread card (spread-3) page index matches next sequential page (page index 4) and is active
    const spread3Card = page.locator('[data-page-index="4"]');
    await expect(spread3Card).toBeVisible();
    await expect(spread3Card).toHaveClass(/active/);

    // 3. Add some content on the newly added spread (spread-3).
    // Let's get the box IDs on spread-3 before adding the text frame
    const idsBefore = await page.evaluate(() => {
      const svg = document.querySelector('#svg-container svg.overlay-svg');
      if (!svg) return [];
      const ids = new Set();
      svg.querySelectorAll('.box-rect[data-box-id]').forEach(el => ids.add(el.getAttribute('data-box-id')));
      return [...ids];
    });
    console.log('E2E TEST: IDs before:', idsBefore);

    // Create a Text Frame
    const trigger = page.locator('scribus-create-menu button.trigger');
    await trigger.click();
    const textFrameItem = page.locator('.scribus-create-menu-item', { hasText: 'Text Frame' });
    await textFrameItem.click();

    // Wait for the new box to appear and get its ID
    let newBoxId = null;
    await expect(async () => {
      const idsAfter = await page.evaluate(() => {
        const svg = document.querySelector('#svg-container svg.overlay-svg');
        if (!svg) return [];
        const ids = new Set();
        svg.querySelectorAll('.box-rect[data-box-id]').forEach(el => ids.add(el.getAttribute('data-box-id')));
        return [...ids];
      });
      console.log('E2E TEST: IDs after:', idsAfter);
      // Find the ID that is in idsAfter but not in idsBefore
      const diff = idsAfter.filter(id => !idsBefore.includes(id));
      expect(diff.length).toBe(1);
      newBoxId = diff[0];
    }).toPass({ timeout: 5000 });

    // Explicitly click Save button to persist the spread
    const saveBtn = page.locator('scribus-button[label="Save"]');
    await expect(saveBtn).toBeVisible();
    await saveBtn.click();
    await expect(statusEl).toHaveText('Saved.', { timeout: 10000 });

    // 4. Switch to the first spread (spread-1) to see that the new content is not there anymore.
    const spread1Card = page.locator('[data-spread-id="spread-1"]');
    await expect(spread1Card).toBeVisible();
    await spread1Card.click();
    await expect(statusEl).toHaveText(/Ready/, { timeout: 20000 });

    // Verify Spread 1 is active, and the new box from Spread 3 is NOT on Spread 1
    await expect(spread1Card).toHaveClass(/active/);
    const hasNewBoxOnSpread1 = await page.evaluate((id) => {
      const svg = document.querySelector('#svg-container svg.overlay-svg');
      if (!svg) return false;
      return !!svg.querySelector(`[data-box-id="${id}"]`);
    }, newBoxId);
    expect(hasNewBoxOnSpread1).toBe(false);

    // 5. Switch back again and the new content is there.
    await spread3Card.click();
    await expect(statusEl).toHaveText(/Ready/, { timeout: 20000 });
    await expect(spread3Card).toHaveClass(/active/);

    const hasNewBoxOnSpread3 = await page.evaluate((id) => {
      const svg = document.querySelector('#svg-container svg.overlay-svg');
      if (!svg) return false;
      return !!svg.querySelector(`[data-box-id="${id}"]`);
    }, newBoxId);
    expect(hasNewBoxOnSpread3).toBe(true);
  });
});


