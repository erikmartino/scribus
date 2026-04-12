import { test, expect } from '@playwright/test';

test.describe('Focus Preservation Verification', () => {
    test.beforeEach(async ({ page }) => {
        page.on('console', msg => console.log(`BROWSER [${msg.type()}]: ${msg.text()}`));
        page.on('pageerror', err => console.log(`BROWSER ERR: ${err.message}`));
        
        await page.goto('/story-editor/index.html');
        // Wait for components and initial layout (crucial for WASM engine)
        await page.waitForSelector('scribus-ribbon-section', { timeout: 60000 });
        await page.waitForSelector('#svg-container svg text', { timeout: 60000 });
        await page.waitForFunction(() => window.scribusShell && window.scribusShell.plugins.some(p => p.editor), { timeout: 60000 });
    });

    test('verify editor maintains focus after clicking Bold button', async ({ page }) => {
        const editor = page.locator('#svg-container');
        await editor.focus();

        // 1. Clear existing text to reduce noise
        await page.keyboard.press('ControlOrMeta+a');
        await page.keyboard.press('Backspace');
        await page.waitForTimeout(200);

        // 2. Type initial text
        await page.keyboard.type('Hello', { delay: 50 });
        
        // 3. Click the Bold button in the ribbon
        const boldBtn = page.locator('#toggle-bold button');
        await boldBtn.click();
        
        // 4. Type more text immediately without clicking back
        await page.keyboard.type(' World', { delay: 50 });
        await page.waitForTimeout(500);
        
        // 5. Verify the text is in the editor
        const text = await page.evaluate(() => {
            const plugin = window.scribusShell.plugins.find(p => p.editor);
            const story = plugin.editor.story;
            // Join all runs in the first paragraph
            return story[0].map(run => run.text).join('');
        });
        
        console.log(`Editor text after bold toggle: "${text}"`);
        expect(text).toContain('Hello World');
    });

    test('verify editor maintains focus after changing Font Family', async ({ page }) => {
        const editor = page.locator('#svg-container');
        await editor.focus();

        // 1. Clear existing text
        await page.keyboard.press('ControlOrMeta+a');
        await page.keyboard.press('Backspace');
        await page.waitForTimeout(200);

        // 2. Type initial text
        await page.keyboard.type('Font', { delay: 50 });
        
        // 3. Change font family in ribbon
        const selector = page.locator('#font-family-selector select');
        await selector.selectOption('Roboto');
        
        // 4. Type more text
        await page.keyboard.type(' Change', { delay: 50 });
        await page.waitForTimeout(500);
        
        const text = await page.evaluate(() => {
            const plugin = window.scribusShell.plugins.find(p => p.editor);
            const story = plugin.editor.story;
            return story[0].map(run => run.text).join('');
        });
        
        console.log(`Editor text after font change: "${text}"`);
        expect(text).toContain('Font Change');
    });
});
