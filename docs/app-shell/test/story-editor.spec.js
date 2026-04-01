import { test, expect } from '@playwright/test';

test.describe('Story Editor Integration', () => {
    test.beforeEach(async ({ page }) => {
        // Navigate to the Story Editor demo
        await page.goto('http://localhost:8000/story-editor/index.html');
        // Wait for components and layout with generous timeout (WASM might take time)
        await page.waitForSelector('#svg-container', { timeout: 60000 });
        await page.waitForSelector('.line-view', { timeout: 60000 });
    });

    test('typing and undo restores previous text', async ({ page }) => {
        const editor = page.locator('#svg-container');
        await editor.focus();
        
        await page.keyboard.type('Hello ');
        await page.keyboard.press('KeyW');
        await page.keyboard.press('KeyO');
        
        // Check if something changed
        const textBefore = await editor.innerText();
        
        // Undo
        await page.keyboard.press('ControlOrMeta+KeyZ');
        
        const textAfter = await editor.innerText();
        expect(textAfter.length).toBeLessThan(textBefore.length);
    });

    test('bold styling and undo', async ({ page }) => {
        const editor = page.locator('#svg-container');
        await editor.focus();
        
        // Select all text
        await page.keyboard.press('ControlOrMeta+KeyA');
        
        // Toggle Bold via Ribbon
        const boldBtn = page.locator('scribus-button[label="Bold"]');
        await boldBtn.click();
        
        // The SVG should now contain bold text
        const boldText = page.locator('text[font-weight="bold"]').first();
        await expect(boldText).toBeVisible();
        
        // Undo
        const undoBtn = page.locator('scribus-button[label="Undo"]');
        await undoBtn.click();
        
        await expect(boldText).not.toBeVisible();
    });

    test('copy and paste within the same editor', async ({ page }) => {
        const editor = page.locator('#svg-container');
        await editor.focus();
        
        // Select all
        await page.keyboard.press('ControlOrMeta+KeyA');
        const initialText = await editor.innerText();
        
        // Copy
        await page.keyboard.press('ControlOrMeta+KeyC');
        
        // Move to end and paste
        await page.keyboard.press('ArrowRight');
        await page.keyboard.press('ControlOrMeta+KeyV');
        
        // Text should be doubled (roughly)
        const finalText = await editor.innerText();
        expect(finalText.length).toBeGreaterThan(initialText.length);
    });
});
