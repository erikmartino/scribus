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
});
