import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const STORE_DIR = path.resolve(import.meta.dirname, '../../store');

test.describe('Document Browser', () => {
  test.beforeEach(async ({ page }) => {
    page.on('console', msg => {
      console.log(`BROWSER [${msg.type()}]: ${msg.text()}`);
    });
    page.on('pageerror', err => {
      console.error(`BROWSER [error]: ${err.message}`);
    });

    await page.goto('/document-browser/');
    await page.waitForSelector('scribus-app-shell:defined');
    const statusEl = page.locator('#status');
    await expect(statusEl).toHaveText(/Ready/, { timeout: 20000 });
  });

  test('page loads and shows Ready status', async ({ page }) => {
    const status = page.locator('#status');
    await expect(status).toHaveText('Ready');
    await expect(status).toHaveAttribute('type', 'ok');
  });

  test('displays Templates section with at least one template', async ({ page }) => {
    const heading = page.locator('.browser-workspace h2', { hasText: 'Templates' });
    await expect(heading).toBeVisible();

    const templateCards = page.locator('#template-grid .doc-card');
    await expect(templateCards).not.toHaveCount(0);
  });

  test('template cards show title and metadata', async ({ page }) => {
    const firstCard = page.locator('#template-grid .doc-card').first();
    await expect(firstCard).toBeVisible();

    // Title should exist
    const title = firstCard.locator('.title');
    await expect(title).not.toBeEmpty();

    // Metadata should show page size
    const meta = firstCard.locator('.meta');
    await expect(meta).toContainText('mm');
  });

  test('template card has Use Template button', async ({ page }) => {
    const useBtn = page.locator('#template-grid .doc-card button.primary', { hasText: 'Use Template' });
    await expect(useBtn.first()).toBeVisible();
  });

  test('displays My Documents section', async ({ page }) => {
    const heading = page.locator('.browser-workspace h2', { hasText: 'My Documents' });
    await expect(heading).toBeVisible();
  });

  test('user documents show Open button', async ({ page }) => {
    const openBtn = page.locator('#user-docs-grid .doc-card button.primary', { hasText: 'Open' });
    await expect(openBtn.first()).toBeVisible();
  });

  test('clicking Use Template opens clone dialog', async ({ page }) => {
    const useBtn = page.locator('#template-grid .doc-card button.primary').first();
    await useBtn.click();

    const dialog = page.locator('scribus-dialog#clone-dialog');
    await expect(dialog).toHaveAttribute('open', '');

    // Dialog should have a name input
    const nameInput = dialog.locator('input#clone-name-input');
    await expect(nameInput).toBeVisible();
    // Should be pre-filled with a slug
    const value = await nameInput.inputValue();
    expect(value.length).toBeGreaterThan(0);
  });

  test('cancel button closes clone dialog', async ({ page }) => {
    const useBtn = page.locator('#template-grid .doc-card button.primary').first();
    await useBtn.click();

    const dialog = page.locator('scribus-dialog#clone-dialog');
    await expect(dialog).toHaveAttribute('open', '');

    const cancelBtn = dialog.locator('button', { hasText: 'Cancel' });
    await cancelBtn.click();

    await expect(dialog).not.toHaveAttribute('open');
  });

  test('Escape key closes clone dialog', async ({ page }) => {
    const useBtn = page.locator('#template-grid .doc-card button.primary').first();
    await useBtn.click();

    const dialog = page.locator('scribus-dialog#clone-dialog');
    await expect(dialog).toHaveAttribute('open', '');

    await page.keyboard.press('Escape');

    await expect(dialog).not.toHaveAttribute('open');
  });

  test('cloning a template creates a new document', async ({ page }) => {
    const testSlug = `test-clone-${Date.now()}`;
    const testDir = path.join(STORE_DIR, 'alice', testSlug);

    try {
      const useBtn = page.locator('#template-grid .doc-card button.primary').first();
      await useBtn.click();

      const dialog = page.locator('scribus-dialog#clone-dialog');
      await expect(dialog).toHaveAttribute('open', '');

      const nameInput = dialog.locator('input#clone-name-input');
      await nameInput.fill(testSlug);

      const createBtn = dialog.locator('button.primary', { hasText: 'Create' });
      await createBtn.click();

      // Dialog should close
      await expect(dialog).not.toHaveAttribute('open', '', { timeout: 5000 });

      // The new document should appear in the user docs grid after reload
      const newCard = page.locator(`#user-docs-grid .doc-card[data-doc-path="alice/${testSlug}"]`);
      await expect(newCard).toBeVisible({ timeout: 10000 });
    } finally {
      // Clean up the cloned document
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  test('cloning with duplicate name shows conflict error', async ({ page }) => {
    const testSlug = `test-dup-${Date.now()}`;
    const testDir = path.join(STORE_DIR, 'alice', testSlug);

    try {
      // Clone once
      const useBtn = page.locator('#template-grid .doc-card button.primary').first();
      await useBtn.click();

      const dialog = page.locator('scribus-dialog#clone-dialog');
      await expect(dialog).toHaveAttribute('open', '');

      const nameInput = dialog.locator('input#clone-name-input');
      await nameInput.fill(testSlug);

      const createBtn = dialog.locator('button.primary', { hasText: 'Create' });
      await createBtn.click();

      // Wait for dialog to close (first clone succeeded)
      await expect(dialog).not.toHaveAttribute('open', '', { timeout: 5000 });

      // Try to clone again with the same name
      await useBtn.click();
      await expect(dialog).toHaveAttribute('open', '');

      const nameInput2 = dialog.locator('input#clone-name-input');
      await nameInput2.fill(testSlug);

      const createBtn2 = dialog.locator('button.primary', { hasText: 'Create' });
      await createBtn2.click();

      // Should show error about already existing
      const errorMsg = dialog.locator('div', { hasText: 'already exists' });
      await expect(errorMsg).toBeVisible({ timeout: 5000 });
    } finally {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });
});
