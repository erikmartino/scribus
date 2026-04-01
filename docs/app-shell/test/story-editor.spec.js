import { test, expect } from '@playwright/test';

test.describe('Story Editor Integration', () => {
    test.beforeEach(async ({ page }) => {
        // Navigate to the Story Editor demo
        await page.goto('http://localhost:8000/story-editor/index.html');
        // Wait for components and layout with generous timeout (WASM might take time)
        await page.waitForSelector('#svg-container', { timeout: 60000 });
        // The editor renders lines as .line-view groups within the SVG
        await page.waitForSelector('.line-view', { timeout: 60000 });
    });

    test('typing several characters and undoing them as a group', async ({ page }) => {
        const editor = page.locator('#svg-container');
        await editor.focus();
        
        // Move to end (arrow right several times or click)
        await page.keyboard.press('ArrowDown');
        await page.keyboard.press('End');
        
        // Type a word - should be one undo action because of grouping
        await page.keyboard.type(' GroupedText');
        
        // Find the text in the SVG
        await expect(page.locator('text:has-text("GroupedText")')).toBeVisible();
        
        // Undo
        await page.keyboard.press('ControlOrMeta+KeyZ');
        
        // Should be gone
        await expect(page.locator('text:has-text("GroupedText")')).not.toBeVisible();
    });

    test('bold styling via ribbon and undo', async ({ page }) => {
        const editor = page.locator('#svg-container');
        await editor.focus();
        
        // Select all text
        await page.keyboard.press('ControlOrMeta+KeyA');
        
        // Toggle Bold via Ribbon (Scribus Button with label "Bold")
        const boldBtn = page.locator('scribus-button[label="Bold"]');
        await boldBtn.click();
        
        // The SVG should now contain bold text (font-weight="bold" or similar)
        // Note: Our SvgRenderer uses font-weight="bold" attribute
        const boldText = page.locator('text[font-weight="bold"]').first();
        await expect(boldText).toBeVisible();
        
        // Undo via Application ribbon
        const undoBtn = page.locator('scribus-button[label="Undo"]');
        await undoBtn.click();
        
        await expect(boldText).not.toBeVisible();
    });

    test('copy and paste within the SAME editor preserves rich content', async ({ page }) => {
        const editor = page.locator('#svg-container');
        await editor.focus();
        
        // 1. Bold the first word
        await page.keyboard.press('ControlOrMeta+KeyA');
        const boldBtn = page.locator('scribus-button[label="Bold"]');
        await boldBtn.click();
        
        // 2. Copy the bolded text
        await page.keyboard.press('ControlOrMeta+KeyC');
        
        // 3. Move to end and paste
        await page.keyboard.press('ArrowRight');
        await page.keyboard.press('Enter');
        await page.keyboard.press('ControlOrMeta+KeyV');
        
        // 4. Verify we have TWO instances of bold text now (one original, one pasted)
        const boldElements = page.locator('text[font-weight="bold"]');
        const count = await boldElements.count();
        expect(count).toBeGreaterThan(1);
    });

    test('font selection updates layout', async ({ page }) => {
        const editor = page.locator('#svg-container');
        await editor.focus();
        
        // Find font selector in properties panel
        const fontSelector = page.locator('scribus-input[label="Font Family"]');
        
        // Current font should be EB Garamond (default)
        const initialFont = await page.locator('text').first().getAttribute('font-family');
        
        // Change to Roboto
        // Note: ScribusInput encapsulates a real input in shadow DOM
        const input = fontSelector.locator('input');
        await input.fill('Roboto');
        await input.press('Enter');
        
        // Check if layout updated
        const newFont = await page.locator('text').first().getAttribute('font-family');
        expect(newFont).toBe('Roboto');
    });
});
