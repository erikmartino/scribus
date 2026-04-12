import { test, expect } from '@playwright/test';

test.describe('Story Editor Clipboard Integration', () => {
    test.beforeEach(async ({ page, context }) => {
        // Log all console messages for AGENTS.md verification
        page.on('console', msg => console.log(`[BROWSER LOG]: ${msg.text()}`));
        
        await context.grantPermissions(['clipboard-read', 'clipboard-write']);
        await page.goto('/story-editor/index.html');
        await page.waitForSelector('#svg-container', { timeout: 60000 });
        await page.waitForSelector('#svg-container svg text', { timeout: 60000 });
    });

    test('Cut removes selected text and populates system clipboard', async ({ page }) => {
        const editor = page.locator('#svg-container');
        await editor.focus();

        // 1. Initial State Check
        const initialText = await page.textContent('#svg-container');
        expect(initialText.replace(/\s+/g, "")).toContain('StoryEditorPrototype');

        // 2. Select 'Story' via keyboard shortcut or manual select-all
        await page.keyboard.press('ControlOrMeta+a');
        await page.waitForTimeout(500);

        // 3. Perform Cut (Meta+X on Mac, Ctrl+X on others)
        await page.keyboard.press('ControlOrMeta+x');
        await page.waitForTimeout(1000); // Time for story-ops mutation and clipboard sync

        // 4. Verify text is gone from the UI
        const afterCutText = await page.textContent('#svg-container');
        expect(afterCutText.trim().replace(/\s+/g, ' ')).not.toContain('Story Editor Prototype');

        // 5. Verify system clipboard content
        const clipboardContent = await page.evaluate(async () => {
            return await navigator.clipboard.readText();
        });
        expect(clipboardContent.replace(/\s+/g, "")).toContain('StoryEditorPrototype');
    });

    test('Paste correctly restores previously cut text', async ({ page }) => {
        const editor = page.locator('#svg-container');
        await editor.focus();

        // 1. Select and Cut everything
        await page.keyboard.press('ControlOrMeta+a');
        await page.waitForTimeout(200);
        await page.keyboard.press('ControlOrMeta+x');
        await page.waitForTimeout(500);

        // 2. Verify it's gone
        const afterCutText = await page.textContent('#svg-container');
        expect(afterCutText.trim()).toBe('');

        // 3. Paste at default cursor (0,0)
        await page.keyboard.press('ControlOrMeta+v');
        await page.waitForTimeout(1200);

        // 4. Verify 'Story Editor' is present again (pasted from clipboard)
        const afterPasteText = await page.textContent('#svg-container');
        expect(afterPasteText.replace(/\s+/g, "")).toContain('StoryEditorPrototype');
    });
});
