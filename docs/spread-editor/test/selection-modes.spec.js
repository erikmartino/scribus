import { test, expect } from '@playwright/test';

test.describe('Spread Editor Selection Modes', () => {
    test.beforeEach(async ({ page }) => {
        // Pipe browser console logs to terminal
        page.on('console', msg => {
            console.log(`BROWSER [${msg.type()}]: ${msg.text()}`);
        });
        page.on('pageerror', err => {
            console.error(`BROWSER [error]: ${err.message}`);
        });
        
        await page.goto('/spread-editor/index.html');
        const statusEl = page.locator('#status');
        await expect(statusEl).toBeVisible({ timeout: 15000 });
        await expect(statusEl).toHaveText(/Ready/, { timeout: 20000 });
    });

    test('should have system text selection disabled', async ({ page }) => {
        const bodyValue = await page.evaluate(() => getComputedStyle(document.body).userSelect);
        // Note: some browsers return 'none', some '-webkit-none'
        expect(bodyValue).toMatch(/none/);
    });

    test('should enter edit mode only after selection', async ({ page }) => {
        const box = page.locator('.box-rect').first();
        const shell = page.locator('scribus-app-shell');
        
        // Initial state: Object mode
        await expect(shell).toHaveAttribute('data-mode', 'object');
        
        // 1. Click box to select
        await box.click();
        await expect(shell).toHaveAttribute('data-mode', 'object');
        
        // Typography section should NOT be visible yet
        const typography = page.locator('scribus-ribbon-section[label="Typography"]');
        await expect(typography).not.toBeVisible();
        
        // 2. Click again to enter text mode
        await box.click();
        await expect(shell).toHaveAttribute('data-mode', 'text');
        
        // Typography section SHOULD be visible
        await expect(typography).toBeVisible();
        
        // Cursor should be attached (it blinks, so visibility check is flaky)
        const cursor = page.locator('#text-cursor');
        await expect(cursor).toBeAttached();
    });

    test('should exit both modes on background click', async ({ page }) => {
        const box = page.locator('.box-rect').first();
        const shell = page.locator('scribus-app-shell');
        const canvas = page.locator('#svg-container');

        // Enter text mode
        await box.click();
        await box.click();
        await expect(shell).toHaveAttribute('data-mode', 'text');

        // Click background (canvas)
        // We use click with position to ensure it's outside the box
        await canvas.click({ position: { x: 10, y: 10 } });
        
        // Should be back to object mode with no selection
        await expect(shell).toHaveAttribute('data-mode', 'object');
        // Note: selectedBoxId is internal, but we can check if the overlay rect has no selected-box
        const selectedOverlay = page.locator('.box-rect[stroke="var(--accent)"]');
        await expect(selectedOverlay).not.toBeVisible();
    });

    test('dragging text should create a selection', async ({ page }) => {
        const box = page.locator('.box-rect').first();
        const shell = page.locator('scribus-app-shell');
        
        // Enter text mode
        await box.click();
        await box.click();

        // Drag to select
        const boxBounds = await box.boundingBox();
        if (!boxBounds) throw new Error('Box bounds not found');
        
        await page.mouse.move(boxBounds.x + 50, boxBounds.y + 50);
        await page.mouse.down();
        await page.mouse.move(boxBounds.x + 200, boxBounds.y + 100);
        await page.mouse.up();

        // Check for selection highlights in the selection group
        const selectionBoxes = page.locator('scribus-app-shell .text-selection rect');
        await expect(selectionBoxes.count()).resolves.toBeGreaterThan(0);
    });
});
