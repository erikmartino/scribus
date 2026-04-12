import { test, expect } from '@playwright/test';

/** Wire up browser console/error forwarding for diagnostics. */
function forwardBrowserLogs(page) {
    page.on('console', msg => {
        console.log(`BROWSER [${msg.type()}]: ${msg.text()}`);
    });
    page.on('pageerror', err => {
        console.error(`BROWSER [error]: ${err.message}`);
    });
}

test.describe('Story Editor Integration', () => {
    test.beforeEach(async ({ page, context }) => {
        forwardBrowserLogs(page);
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

    test('font size in properties panel reflects current paragraph style', async ({ page }) => {
        const editor = page.locator('#svg-container');
        await editor.focus();

        // 1. Check First Paragraph (Lead style initialized as 30pt)
        await page.keyboard.press('Home');
        await page.waitForTimeout(300);

        const fontSizeInput = page.locator('scribus-input#font-size');
        const firstParaSize = await fontSizeInput.evaluate(el => el.value);
        expect(Number(firstParaSize)).toBe(30);

        // 2. Move to Second Paragraph (Normal style initialized as 22pt)
        // Sending multiple ArrowDowns to skip the wrapped lines of the first multi-line paragraph
        for (let i = 0; i < 5; i++) {
            await page.keyboard.press('ArrowDown');
            await page.waitForTimeout(50);
        }
        await page.waitForTimeout(300);

        const secondParaSize = await fontSizeInput.evaluate(el => el.value);
        expect(Number(secondParaSize)).toBe(22);
    });

    test('double-click on existing selection narrows to word', async ({ page }) => {
        const editor = page.locator('#svg-container');
        await editor.focus();

        // Select all text first to create a large selection
        await page.keyboard.press('ControlOrMeta+a');
        await page.waitForTimeout(300);

        // Verify we have a selection (selection rects should be present)
        const selRectsBeforeCount = await page.locator('#svg-container svg #text-selection rect').count();
        expect(selRectsBeforeCount).toBeGreaterThan(0);

        // Find the bounding box of the first <text> element (first line of text)
        const firstTextBBox = await page.evaluate(() => {
            const textEl = document.querySelector('#svg-container svg text');
            if (!textEl) return null;
            const svg = textEl.closest('svg');
            const ctm = svg.getScreenCTM();
            const bbox = textEl.getBBox();
            // Convert SVG coords to screen coords
            const pt = svg.createSVGPoint();
            // Click roughly in the middle of the first line, horizontally
            pt.x = bbox.x + bbox.width * 0.3;
            pt.y = bbox.y + bbox.height * 0.5;
            const screenPt = pt.matrixTransform(ctm);
            return { x: screenPt.x, y: screenPt.y };
        });
        expect(firstTextBBox).toBeTruthy();

        // Double-click on the text (within the existing select-all selection)
        await page.mouse.dblclick(firstTextBBox.x, firstTextBBox.y);
        await page.waitForTimeout(500);

        // After double-click, selection should exist but be narrower (a word, not all text)
        const selRectsAfterCount = await page.locator('#svg-container svg #text-selection rect').count();
        // A word selection should produce fewer highlight rects than select-all
        // (select-all covers many lines, word selection covers at most 1 line)
        expect(selRectsAfterCount).toBeGreaterThan(0);
        expect(selRectsAfterCount).toBeLessThan(selRectsBeforeCount);
    });
});
