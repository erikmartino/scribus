import { test, expect } from '@playwright/test';

test.describe('Focus Preservation Verification', () => {
    test.beforeEach(async ({ page }) => {
        page.on('console', msg => console.log(`BROWSER [${msg.type()}]: ${msg.text()}`));
        page.on('pageerror', err => console.log(`BROWSER ERR: ${err.message}`));
        
        await page.goto('/story-editor/index.html');
        await page.waitForSelector('scribus-ribbon-section', { timeout: 60000 });
        await page.waitForFunction(() => window.plugin && window.plugin.editor, { timeout: 60000 });
    });

    test('verify editor maintains focus after clicking Bold button', async ({ page }) => {
        // 1. Focus the editor and type something
        const editor = page.locator('#svg-container');
        await editor.click();
        await page.keyboard.type('Hello');
        
        // 2. Click the Bold button in the ribbon
        const boldBtn = page.locator('#toggle-bold button');
        await boldBtn.click();
        
        // 3. Type more text immediately without clicking back
        await page.keyboard.type(' World');
        
        // 4. Verify the text is in the editor
        const text = await page.evaluate(() => {
            const story = window.plugin.editor.story;
            // First paragraph is at index 0. Each paragraph is an array of runs.
            return story[0].map(run => run.text).join('');
        });
        
        console.log(`Editor text after bold toggle: "${text}"`);
        expect(text).toContain('Hello World');
    });

    test('verify editor maintains focus after changing Font Family', async ({ page }) => {
        // 1. Focus the editor and type
        const editor = page.locator('#svg-container');
        await editor.click();
        await page.keyboard.type('Font');
        
        // 2. Change font family in ribbon
        const selector = page.locator('#font-family-selector select');
        await selector.selectOption('Roboto');
        
        // 3. Type more text
        await page.keyboard.type(' Change');
        
        const text = await page.evaluate(() => {
            const story = window.plugin.editor.story;
            return story[0].map(run => run.text).join('');
        });
        
        console.log(`Editor text after font change: "${text}"`);
        expect(text).toContain('Font Change');
    });
});
