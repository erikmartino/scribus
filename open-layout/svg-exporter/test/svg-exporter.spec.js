// svg-exporter.spec.js — E2E tests for the svg-exporter viewer page.

import { test, expect } from '@playwright/test';

test.describe('SVG Exporter', () => {
  test.beforeEach(async ({ page }) => {
    page.on('console', msg => {
      console.log(`BROWSER [${msg.type()}]: ${msg.text()}`);
    });
    page.on('pageerror', err => {
      console.error(`BROWSER [error]: ${err.message}`);
    });
  });

  test('renders a page SVG for the typography-sampler demo document', async ({ page }) => {
    await page.goto('/svg-exporter/?doc=demo/typography-sampler');

    // Wait for rendering to complete (status shows page count)
    await expect(page.locator('#status')).toContainText('rendered', { timeout: 30000 });

    // At least one page SVG container should be visible
    const pageContainers = page.locator('.page-svg-container');
    await expect(pageContainers).toHaveCount(1);

    // The SVG inside should contain text elements (actual rendered text)
    const svg = pageContainers.first().locator('svg');
    await expect(svg).toBeVisible();

    // Check that there is actual text content in the SVG
    const textElements = svg.locator('text');
    const count = await textElements.count();
    expect(count).toBeGreaterThan(0);
  });

  test('shows a page label', async ({ page }) => {
    await page.goto('/svg-exporter/?doc=demo/typography-sampler');
    await expect(page.locator('#status')).toContainText('rendered', { timeout: 30000 });

    const label = page.locator('.page-label').first();
    await expect(label).toBeVisible();
    await expect(label).toContainText('Page');
  });

  test('defaults to typography-sampler when no doc param is given', async ({ page }) => {
    await page.goto('/svg-exporter/');
    // Should load the default document without error
    await expect(page.locator('#doc-label')).toHaveText('demo/typography-sampler');
    await expect(page.locator('#status')).toContainText('rendered', { timeout: 30000 });
  });

  test('shows document path in header', async ({ page }) => {
    await page.goto('/svg-exporter/?doc=demo/typography-sampler');
    await expect(page.locator('#doc-label')).toHaveText('demo/typography-sampler');
  });
});
