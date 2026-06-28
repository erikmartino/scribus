import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const STORE_DIR = path.resolve(import.meta.dirname, '../../store');
const USER = process.env.E2E_STORE_USER;

/**
 * Click a port/overflow element for a given box.
 * Dispatches a pointerdown event directly on the SVG element to avoid
 * viewport scroll issues.
 */
async function clickPort(page, boxId, portType) {
  const found = await page.evaluate(({ boxId, portType }) => {
    const svg = document.querySelector('#svg-container svg.overlay-svg');
    let el;
    if (portType === 'overflow') {
      el = svg.querySelector(`[data-overflow="true"][data-port-box="${boxId}"]`);
    } else {
      el = svg.querySelector(`[data-port="${portType}"][data-port-box="${boxId}"]`);
    }
    if (!el) return false;
    const rect = el.getBoundingClientRect();
    const cx = rect.x + rect.width / 2;
    const cy = rect.y + rect.height / 2;
    el.dispatchEvent(new PointerEvent('pointerdown', {
      bubbles: true, clientX: cx, clientY: cy, pointerId: 1,
    }));
    return true;
  }, { boxId, portType });
  if (!found) throw new Error(`Port ${portType} not found for box ${boxId}`);
}

/**
 * Click the body of a box by its data-box-id.
 * In link mode, clicks the link-target overlay if present; otherwise the
 * normal box body rect. Uses dispatchEvent to avoid viewport scroll issues.
 */
async function clickBoxBody(page, boxId) {
  const found = await page.evaluate((boxId) => {
    const svg = document.querySelector('#svg-container svg.overlay-svg');
    // Prefer the link-target overlay (rendered on top during link mode)
    let body = svg.querySelector(`[data-link-target="true"][data-box-id="${boxId}"]`);
    if (!body) {
      body = svg.querySelector(`[data-box-id="${boxId}"][data-handle="body"]`);
    }
    if (!body) return false;
    const rect = body.getBoundingClientRect();
    const cx = rect.x + rect.width / 2;
    const cy = rect.y + rect.height / 2;
    body.dispatchEvent(new PointerEvent('pointerdown', {
      bubbles: true, clientX: cx, clientY: cy, pointerId: 1,
    }));
    return true;
  }, boxId);
  if (!found) throw new Error(`Box body not found for ${boxId}`);
}

test.describe('Cross-Spread Text Frame Linking', () => {
  let testDocSlug;
  let testDocDir;

  test.beforeEach(async ({ page, request }, testInfo) => {
    page.on('console', msg => {
      console.log(`BROWSER [${msg.type()}]: ${msg.text()}`);
    });
    page.on('pageerror', err => {
      console.error(`BROWSER [error]: ${err.message}`);
    });

    // Create a unique test document via the POST copy endpoint from the brochure-q2 template
    testDocSlug = `test-linking-cross-spread-w${testInfo.workerIndex}-${Date.now()}`;
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

  test('should support linking text frames across different spreads', async ({ page }) => {
    // 1. Open spread editor with active document on Spread 1
    await page.goto(`/spread-editor/index.html?doc=${USER}/${testDocSlug}`);
    await page.waitForSelector('scribus-app-shell:defined');
    const statusEl = page.locator('#status');
    await expect(statusEl).toHaveText(/Ready/, { timeout: 20000 });

    // Open Pages panel
    const pagesTab = page.locator('[data-panel-id="pages"]');
    await expect(pagesTab).toBeVisible();
    await pagesTab.click();

    // Verify Spread 1 card is active
    const spread1Card = page.locator('[data-page-index="1"]');
    await expect(spread1Card).toBeVisible();
    await expect(spread1Card).toHaveClass(/active/);

    // 2. Click the output port on 'frame-intro' on Spread 1 to enter Link Mode
    await clickPort(page, 'frame-intro', 'output');
    await page.waitForTimeout(300);

    const mode = await page.evaluate(() => {
      const shell = document.querySelector('scribus-app-shell');
      return shell?.getAttribute('data-mode');
    });
    expect(mode).toBe('link');

    // 3. Switch to Spread 2 by clicking the card
    const spread2Card = page.locator('[data-page-index="3"]');
    await expect(spread2Card).toBeVisible();
    await spread2Card.click();
    await expect(statusEl).toHaveText(/Ready/, { timeout: 20000 });

    // Verify Spread 2 is now active
    await expect(spread2Card).toHaveClass(/active/);

    // Verify Link Mode is STILL active
    const modeAfterSwitch = await page.evaluate(() => {
      const shell = document.querySelector('scribus-app-shell');
      return shell?.getAttribute('data-mode');
    });
    expect(modeAfterSwitch).toBe('link');

    // Verify the target boxes on Spread 2 show the link overlays
    const targetCount = await page.evaluate(() => {
      const svg = document.querySelector('#svg-container svg.overlay-svg');
      return svg.querySelectorAll('[data-link-target="true"]').length;
    });
    // Two text frames on Spread 2 (frame-body, frame-sidebar) should both be highlighted as valid targets
    expect(targetCount).toBe(2);

    // 4. Click 'frame-body' on Spread 2 to complete the linking action
    await clickBoxBody(page, 'frame-body');
    await expect(statusEl).toHaveText(/Ready/, { timeout: 20000 });

    // Verify mode has reset to 'object' after successful linking
    const shell = page.locator('scribus-app-shell');
    await expect(shell).toHaveAttribute('data-mode', 'object', { timeout: 15000 });

    // 5. Verify backend data correctness
    // Load spread-2.json from the disk and check frame-body's storyRef
    const spread2JsonPath = path.join(testDocDir, 'spreads/spread-2.json');
    const spread2Json = JSON.parse(fs.readFileSync(spread2JsonPath, 'utf8'));
    const frameBody = spread2Json.frames.find(f => f.id === 'frame-body');
    
    expect(frameBody).toBeDefined();
    // It should now point to 'story-title' (the source story) instead of 'story-body'
    expect(frameBody.storyRef).toBe('story-title');
  });

  test('should support propagating text flow offsets correctly across spreads after linking', async ({ page }) => {
    // 1. Append a very long paragraph to story-title.json to guarantee overflow
    const storyPath = path.join(testDocDir, 'stories/story-title.json');
    const storyJson = JSON.parse(fs.readFileSync(storyPath, 'utf8'));
    storyJson.paragraphs.push({
      styleRef: 'body',
      runs: [
        { text: 'A long continuation paragraph that will overflow frame-intro on Spread 1 and must flow into frame-body on Spread 2. '.repeat(100) }
      ],
      fontSize: 12,
      fontFamily: 'EB Garamond',
      lineHeight: 1.4
    });
    fs.writeFileSync(storyPath, JSON.stringify(storyJson, null, 2), 'utf8');

    // 2. Open spread editor with active document on Spread 1
    await page.goto(`/spread-editor/index.html?doc=${USER}/${testDocSlug}`);
    await page.waitForSelector('scribus-app-shell:defined');
    const statusEl = page.locator('#status');
    await expect(statusEl).toHaveText(/Ready/, { timeout: 20000 });

    // Open Pages panel
    const pagesTab = page.locator('[data-panel-id="pages"]');
    await expect(pagesTab).toBeVisible();
    await pagesTab.click();

    // Verify Spread 1 card is active
    const spread1Card = page.locator('[data-page-index="1"]');
    await expect(spread1Card).toBeVisible();
    await expect(spread1Card).toHaveClass(/active/);

    // 3. Click the overflow port on 'frame-intro' on Spread 1 to enter Link Mode
    // (Since it overflows, it will have an overflow port instead of an output port)
    await clickPort(page, 'frame-intro', 'overflow');
    await page.waitForTimeout(300);

    const mode = await page.evaluate(() => {
      const shell = document.querySelector('scribus-app-shell');
      return shell?.getAttribute('data-mode');
    });
    expect(mode).toBe('link');

    // 4. Switch to Spread 2 by clicking the card
    const spread2Card = page.locator('[data-page-index="3"]');
    await expect(spread2Card).toBeVisible();
    await spread2Card.click();
    await expect(statusEl).toHaveText(/Ready/, { timeout: 20000 });

    // Verify Spread 2 is now active
    await expect(spread2Card).toHaveClass(/active/);

    // Click 'frame-body' on Spread 2 to complete the linking action
    await clickBoxBody(page, 'frame-body');
    await expect(statusEl).toHaveText(/Ready/, { timeout: 20000 });

    // Verify mode has reset to 'object' after successful linking
    const shell = page.locator('scribus-app-shell');
    await expect(shell).toHaveAttribute('data-mode', 'object', { timeout: 15000 });

    // 5. Verify flowAnchors correctness on the backend
    const spread2JsonPath = path.join(testDocDir, 'spreads/spread-2.json');
    const spread2Json = JSON.parse(fs.readFileSync(spread2JsonPath, 'utf8'));
    expect(spread2Json.flowAnchors).toBeDefined();
    expect(spread2Json.flowAnchors['story-title']).toBeDefined();
    const anchor = spread2Json.flowAnchors['story-title'];
    expect(anchor.paragraphIndex).toBeGreaterThanOrEqual(0);

    // 6. Switch back to Spread 2 in the editor to verify UI rendering of sliced text
    // Switch to Spread 1, then back to Spread 2 to trigger full reload
    await spread1Card.click();
    await expect(statusEl).toHaveText(/Ready/, { timeout: 20000 });
    await spread2Card.click();
    await expect(statusEl).toHaveText(/Ready/, { timeout: 20000 });

    const textContent = await page.locator('#svg-container').textContent();
    const cleanText = textContent.replace(/\s+/g, '');
    // The text on Spread 2 should contain the overflow text and NOT the beginning of story-title
    expect(cleanText).not.toContain('Thisquarter');
    expect(cleanText).toContain('continuationparagraph');
  });
});
