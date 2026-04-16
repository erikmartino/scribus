import { test, expect } from '@playwright/test';

test.describe('Create Menu', () => {
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

  test('create menu button is visible in the ribbon', async ({ page }) => {
    const createMenu = page.locator('scribus-create-menu');
    await expect(createMenu).toBeVisible();
  });

  test('clicking the create button opens a dropdown with shape types', async ({ page }) => {
    // Click the trigger (inside shadow DOM)
    const trigger = page.locator('scribus-create-menu button.trigger');
    await trigger.click();

    // The dropdown is portalled to document.body
    const dropdown = page.locator('.scribus-create-dropdown');
    await expect(dropdown).toBeVisible();

    const items = page.locator('.scribus-create-menu-item');
    await expect(items).toHaveCount(3);
    await expect(items.nth(0)).toContainText('Circle');
    await expect(items.nth(1)).toContainText('Square');
    await expect(items.nth(2)).toContainText('Triangle');
  });

  test('clicking a menu item creates a new shape', async ({ page }) => {
    const countBefore = await page.locator('.selectable').count();

    const trigger = page.locator('scribus-create-menu button.trigger');
    await trigger.click();

    const circleItem = page.locator('.scribus-create-menu-item', { hasText: 'Circle' });
    await circleItem.click();

    // A new shape should appear
    await expect(page.locator('.selectable')).toHaveCount(countBefore + 1);
  });

  test('dropdown closes after creating a shape', async ({ page }) => {
    const trigger = page.locator('scribus-create-menu button.trigger');
    await trigger.click();

    const squareItem = page.locator('.scribus-create-menu-item', { hasText: 'Square' });
    await squareItem.click();

    // Dropdown should be closed
    const dropdown = page.locator('.scribus-create-dropdown');
    await expect(dropdown).toBeHidden();
  });

  test('dropdown closes when clicking outside', async ({ page }) => {
    const trigger = page.locator('scribus-create-menu button.trigger');
    await trigger.click();

    // Verify dropdown is open
    const dropdown = page.locator('.scribus-create-dropdown');
    await expect(dropdown).toBeVisible();

    // Click outside
    await page.locator('#main-content').click();

    await expect(dropdown).toBeHidden();
  });

  test('undo reverses shape creation', async ({ page }) => {
    const countBefore = await page.locator('.selectable').count();

    // Create a new triangle
    const trigger = page.locator('scribus-create-menu button.trigger');
    await trigger.click();

    const triItem = page.locator('.scribus-create-menu-item', { hasText: 'Triangle' });
    await triItem.click();

    await expect(page.locator('.selectable')).toHaveCount(countBefore + 1);

    // Undo
    await page.keyboard.press('ControlOrMeta+KeyZ');

    await expect(page.locator('.selectable')).toHaveCount(countBefore);
  });

  test('create menu section has label Create', async ({ page }) => {
    // The Create section should be the first ribbon section
    const sections = page.locator('scribus-ribbon-section');
    const first = sections.first();
    await expect(first).toHaveAttribute('label', 'Create');
  });
});
