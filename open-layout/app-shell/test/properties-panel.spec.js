import { test, expect } from '@playwright/test';

/**
 * Sanity-check E2E tests for the multi-panel sidebar.
 * Detailed logic is covered by unit tests in test-property-descriptors.js.
 */
test.describe('Properties Panel (sanity)', () => {
  test.beforeEach(async ({ page }) => {
    page.on('console', msg => {
      console.log(`BROWSER [${msg.type()}]: ${msg.text()}`);
    });
    page.on('pageerror', err => {
      console.error(`BROWSER [error]: ${err.message}`);
    });

    await page.goto('http://localhost:8000/app-shell/');
    await page.waitForSelector('scribus-app-shell:defined');
    await page.waitForSelector('.selectable');
  });

  test('tab bar shows Properties (active) and Layers tabs', async ({ page }) => {
    // Playwright auto-pierces shadow DOM with locator()
    const propertiesTab = page.locator('.panel-tab').filter({ hasText: 'Properties' });
    const layersTab = page.locator('.panel-tab').filter({ hasText: 'Layers' });

    await expect(propertiesTab).toHaveClass(/active/);
    await expect(layersTab).toBeVisible();
    await expect(layersTab).not.toHaveClass(/active/);
  });

  test('selecting a shape shows property groups, deselecting shows empty state', async ({ page }) => {
    const circle = page.locator('.selectable.circle').first();
    await circle.click();

    await expect(page.locator('.property-group-heading').filter({ hasText: 'Object' })).toBeVisible();
    await expect(page.locator('.property-readonly').filter({ hasText: 'circle' })).toBeVisible();

    // Clear selection by clicking the workspace background
    // Use the heading text area which is inside the slotted workspace content
    await page.locator('h1', { hasText: 'App Shell Workspace' }).click();
    await expect(page.locator('.panel-empty')).toBeVisible();
  });

  test('Layers tab lists document items and clicking selects a shape', async ({ page }) => {
    const layersTab = page.locator('.panel-tab').filter({ hasText: 'Layers' });
    await layersTab.click();
    await expect(layersTab).toHaveClass(/active/);

    await expect(page.locator('.layer-item')).toHaveCount(3);

    // Click first layer item — should select a shape
    await page.locator('.layer-item').first().click();
    expect(await page.locator('.selectable.selected').count()).toBe(1);
  });

  test('Layers panel supports multiselect and styles selected items', async ({ page }) => {
    const layersTab = page.locator('.panel-tab').filter({ hasText: 'Layers' });
    await layersTab.click();

    const items = page.locator('.layer-item');
    await items.nth(0).click();

    await expect(items.nth(0)).toHaveClass(/primary-selected/);
    await expect(items.nth(0)).toHaveClass(/selected/);

    // Ctrl+Click second item
    const isMac = process.platform === 'darwin';
    const modifier = isMac ? 'Meta' : 'Control';
    await page.keyboard.down(modifier);
    await items.nth(1).click();
    await page.keyboard.up(modifier);

    // Both should be selected, second is primary-selected
    await expect(items.nth(0)).toHaveClass(/selected/);
    await expect(items.nth(0)).not.toHaveClass(/primary-selected/);
    await expect(items.nth(1)).toHaveClass(/selected/);
    await expect(items.nth(1)).toHaveClass(/primary-selected/);

    // Check canvas has 2 selected shapes
    expect(await page.locator('.selectable.selected').count()).toBe(2);
  });
});
