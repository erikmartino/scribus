import { test, expect } from '@playwright/test';

test.describe('Story Editor Integration', () => {
    test.beforeEach(async ({ page, context }) => {
        await context.grantPermissions(['clipboard-read', 'clipboard-write']);
        await page.goto('/story-editor/index.html');
        await page.waitForSelector('#svg-container', { timeout: 60000 });
        // Wait for at least one text line to render (WASM + fonts loaded)
        await page.waitForSelector('#svg-container svg text', { timeout: 60000 });
    });

    test('typing inserts text and undo removes it as a group', async ({ page }) => {
        const editor = page.locator('#svg-container');
        await editor.focus();

        // Move cursor to end of first line
        await page.keyboard.press('End');
        await page.waitForTimeout(100);

        // Type a short distinctive marker (short to avoid line-break hyphenation)
        await page.keyboard.type('ZQX', { delay: 50 });
        await page.waitForTimeout(500);

        // Verify text appeared in the SVG
        const svgHTML = await page.locator('#svg-container svg').innerHTML();
        expect(svgHTML).toContain('ZQX');

        // Undo the grouped typing
        await page.keyboard.press('ControlOrMeta+z');
        await page.waitForTimeout(500);

        const afterUndo = await page.locator('#svg-container svg').innerHTML();
        expect(afterUndo).not.toContain('ZQX');
    });

    test('bold styling can be undone via Ctrl+Z', async ({ page }) => {
        const editor = page.locator('#svg-container');
        await editor.focus();

        // Capture initial SVG state
        const initialHTML = await page.locator('#svg-container svg').innerHTML();
        const initialBoldCount = (initialHTML.match(/font-weight="bold"/g) || []).length;

        // Select all text and apply bold
        await page.keyboard.press('ControlOrMeta+a');
        await page.waitForTimeout(200);
        await page.keyboard.press('ControlOrMeta+b');
        await page.waitForTimeout(500);

        // Every tspan should now be bold — count should increase
        const boldHTML = await page.locator('#svg-container svg').innerHTML();
        const boldCount = (boldHTML.match(/font-weight="bold"/g) || []).length;
        expect(boldCount).toBeGreaterThan(initialBoldCount);

        // Undo the bold
        await page.keyboard.press('ControlOrMeta+z');
        await page.waitForTimeout(500);

        // Bold count should return to initial
        const undoneHTML = await page.locator('#svg-container svg').innerHTML();
        const undoneCount = (undoneHTML.match(/font-weight="bold"/g) || []).length;
        expect(undoneCount).toBe(initialBoldCount);
    });

    test('copy and paste duplicates content, undo removes the paste', async ({ page }) => {
        const editor = page.locator('#svg-container');
        await editor.focus();

        // Count initial tspan elements
        const initialTspans = await page.locator('#svg-container svg text tspan').count();

        // Select all and copy
        await page.keyboard.press('ControlOrMeta+a');
        await page.waitForTimeout(200);
        await page.keyboard.press('ControlOrMeta+c');
        await page.waitForTimeout(200);

        // Verify localStorage has clipboard data
        const clipJSON = await page.evaluate(() => localStorage.getItem('scribus_local_clipboard'));
        expect(clipJSON).toBeTruthy();
        const clipData = JSON.parse(clipJSON);
        expect(clipData.items).toBeDefined();
        expect(clipData.items[0].type).toBe('story');

        // Deselect by pressing End, then paste
        await page.keyboard.press('End');
        await page.waitForTimeout(200);
        await page.keyboard.press('ControlOrMeta+v');
        await page.waitForTimeout(800);

        // After paste, there should be more tspan elements (content duplicated)
        const afterPasteTspans = await page.locator('#svg-container svg text tspan').count();
        expect(afterPasteTspans).toBeGreaterThan(initialTspans);

        // Undo the paste
        await page.keyboard.press('ControlOrMeta+z');
        await page.waitForTimeout(500);

        // tspan count should be back near initial
        const afterUndoTspans = await page.locator('#svg-container svg text tspan').count();
        expect(afterUndoTspans).toBeLessThan(afterPasteTspans);
    });
});
