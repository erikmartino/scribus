import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const STORE_DIR = path.resolve(import.meta.dirname, '../../store');

test.describe('Document Save', () => {
  /** Create a throwaway document from the demo template before each test. */
  let testDocSlug;
  let testDocDir;

  test.beforeEach(async ({ page, request }) => {
    page.on('console', msg => {
      console.log(`BROWSER [${msg.type()}]: ${msg.text()}`);
    });
    page.on('pageerror', err => {
      console.error(`BROWSER [error]: ${err.message}`);
    });

    // Create a unique test document via the POST copy endpoint
    testDocSlug = `test-save-${Date.now()}`;
    testDocDir = path.join(STORE_DIR, 'alice', testDocSlug);

    const res = await request.post(`/store/alice/${testDocSlug}`, {
      data: { from: 'demo/typography-sampler' },
    });
    expect(res.status()).toBe(201);

    // Open the spread editor with the doc param
    await page.goto(`/spread-editor/index.html?doc=alice/${testDocSlug}`);
    await page.waitForSelector('scribus-app-shell:defined');
    const statusEl = page.locator('#status');
    await expect(statusEl).toHaveText(/Ready/, { timeout: 20000 });
  });

  test.afterEach(async () => {
    // Clean up test document
    fs.rmSync(testDocDir, { recursive: true, force: true });
  });

  test('Save button is visible in the ribbon when doc param is set', async ({ page }) => {
    const saveBtn = page.locator('scribus-button[label="Save"]');
    await expect(saveBtn).toBeVisible();
  });

  test('Save button is NOT visible without doc param', async ({ page }) => {
    // Navigate without the doc param
    await page.goto('/spread-editor/index.html');
    await page.waitForSelector('scribus-app-shell:defined');
    const statusEl = page.locator('#status');
    await expect(statusEl).toHaveText(/Ready/, { timeout: 20000 });

    const saveBtn = page.locator('scribus-button[label="Save"]');
    await expect(saveBtn).not.toBeVisible();
  });

  test('clicking Save persists spread and stories to store', async ({ page }) => {
    const saveBtn = page.locator('scribus-button[label="Save"]');
    await saveBtn.click();

    // Wait for status to show "Saved."
    const statusEl = page.locator('#status');
    await expect(statusEl).toHaveText('Saved.', { timeout: 10000 });

    // Verify files were written to disk
    const spreadPath = path.join(testDocDir, 'spreads', 'spread-1.json');
    expect(fs.existsSync(spreadPath)).toBe(true);

    const spreadJson = JSON.parse(fs.readFileSync(spreadPath, 'utf-8'));
    expect(spreadJson.id).toBe('spread-1');
    expect(spreadJson.frames.length).toBeGreaterThan(0);

    // Verify at least one story file was written
    const storiesDir = path.join(testDocDir, 'stories');
    const storyFiles = fs.readdirSync(storiesDir).filter(f => f.endsWith('.json'));
    expect(storyFiles.length).toBeGreaterThan(0);

    const storyJson = JSON.parse(fs.readFileSync(path.join(storiesDir, storyFiles[0]), 'utf-8'));
    expect(storyJson.paragraphs).toBeDefined();
    expect(storyJson.paragraphs.length).toBeGreaterThan(0);
  });

  test('Save updates document.json modified timestamp', async ({ page }) => {
    const docJsonPath = path.join(testDocDir, 'document.json');
    const before = JSON.parse(fs.readFileSync(docJsonPath, 'utf-8'));
    const beforeModified = before.modified;

    // Wait a moment to ensure the timestamp differs
    await page.waitForTimeout(100);

    const saveBtn = page.locator('scribus-button[label="Save"]');
    await saveBtn.click();

    const statusEl = page.locator('#status');
    await expect(statusEl).toHaveText('Saved.', { timeout: 10000 });

    const after = JSON.parse(fs.readFileSync(docJsonPath, 'utf-8'));
    expect(after.modified).not.toBe(beforeModified);
    // Verify it's a valid ISO date that is more recent
    expect(new Date(after.modified).getTime()).toBeGreaterThan(new Date(beforeModified).getTime());
  });

  test('Ctrl+S triggers save', async ({ page }) => {
    await page.keyboard.press('ControlOrMeta+KeyS');

    const statusEl = page.locator('#status');
    await expect(statusEl).toHaveText('Saved.', { timeout: 10000 });

    // Verify spread file was written
    const spreadPath = path.join(testDocDir, 'spreads', 'spread-1.json');
    expect(fs.existsSync(spreadPath)).toBe(true);
  });

  test('spread frames include text and image boxes', async ({ page }) => {
    // Create a new image frame
    const trigger = page.locator('scribus-create-menu button.trigger');
    await trigger.click();
    await page.locator('.scribus-create-menu-item', { hasText: 'Image Frame' }).click();
    await page.waitForTimeout(500);

    // Save
    const saveBtn = page.locator('scribus-button[label="Save"]');
    await saveBtn.click();
    const statusEl = page.locator('#status');
    await expect(statusEl).toHaveText('Saved.', { timeout: 10000 });

    // Read back the spread and verify both frame types
    const spreadPath = path.join(testDocDir, 'spreads', 'spread-1.json');
    const spreadJson = JSON.parse(fs.readFileSync(spreadPath, 'utf-8'));

    const textFrames = spreadJson.frames.filter(f => f.type === 'text');
    const imageFrames = spreadJson.frames.filter(f => f.type === 'image');
    expect(textFrames.length).toBeGreaterThan(0);
    expect(imageFrames.length).toBe(1);
  });
});
