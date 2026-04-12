import { test, expect } from '@playwright/test';

test.describe('Trailing Space Verification', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto('/story-editor/index.html');
        await page.waitForSelector('#svg-container svg text', { timeout: 60000 });
    });

    test('verify cursor moves when space is added at end of paragraph', async ({ page }) => {
        const editor = page.locator('#svg-container');
        await editor.focus();

        // 1. Clear existing text
        await page.keyboard.press('ControlOrMeta+a');
        await page.keyboard.press('Backspace');
        await page.waitForTimeout(200);

        // 2. Type "A"
        await page.keyboard.type('A', { delay: 50 });
        const xBeforeSpace = await page.evaluate(() => {
            const cursor = document.querySelector('#svg-container svg line');
            return parseFloat(cursor.getAttribute('x1'));
        });

        // 3. Type Space
        await page.keyboard.press('Space');
        await page.waitForTimeout(500);

        const xAfterSpace = await page.evaluate(() => {
            const cursor = document.querySelector('#svg-container svg line');
            return parseFloat(cursor.getAttribute('x1'));
        });

        console.log(`Cursor X before space: ${xBeforeSpace}, after space: ${xAfterSpace}`);
        
        // This is expected to FAIL (they will be equal) before the fix
        expect(xAfterSpace).toBeGreaterThan(xBeforeSpace);
    });
});
