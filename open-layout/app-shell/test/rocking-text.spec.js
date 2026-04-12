import { test, expect } from '@playwright/test';

test.describe('Rocking Text Verification', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto('/story-editor/index.html');
        await page.waitForSelector('#svg-container svg text', { timeout: 60000 });
    });

    test('verify text remains stationary when adding words elsewhere', async ({ page }) => {
        const editor = page.locator('#svg-container');
        await editor.focus();

        // 1. Clear existing text
        await page.keyboard.press('ControlOrMeta+a');
        await page.keyboard.press('Backspace');
        await page.waitForTimeout(200);

        // 2. Type "A [space] B"
        await page.keyboard.type('A   B', { delay: 50 });
        await page.waitForTimeout(500);

        // 3. Measure "B" position
        const xBefore = await page.evaluate(() => {
            const tspans = Array.from(document.querySelectorAll('tspan'));
            const bSpan = tspans.find(t => t.textContent === 'B');
            return bSpan.getBoundingClientRect().left;
        });

        // 4. Type " C"
        await page.keyboard.type(' C', { delay: 50 });
        await page.waitForTimeout(500);

        // 5. Measure "B" again
        const xAfter = await page.evaluate(() => {
            const tspans = Array.from(document.querySelectorAll('tspan'));
            const bSpan = tspans.find(t => t.textContent === 'B');
            return bSpan.getBoundingClientRect().left;
        });

        console.log(`B's X before: ${xBefore}, after: ${xAfter}`);
        
        // This is expected to FAIL (they will be different) before the fix
        // Allow a tiny subpixel difference for subpixel rendering artifacts
        expect(Math.abs(xAfter - xBefore)).toBeLessThan(0.1);
    });
});
