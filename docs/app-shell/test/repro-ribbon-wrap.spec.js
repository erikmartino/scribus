import { test, expect } from '@playwright/test';

test.describe('Ribbon Cleanup Verification', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto('/story-editor/index.html');
        await page.waitForSelector('scribus-ribbon-section', { timeout: 60000 });
    });

    test('verify ribbon sections and redundant labels are removed', async ({ page }) => {
        await page.setViewportSize({ width: 800, height: 600 });
        await page.waitForSelector('scribus-ribbon-section[label="Font"]', { timeout: 60000 });
        
        const sections = page.locator('scribus-ribbon-section');
        const count = await sections.count();
        
        let foundStoryEditor = false;
        let foundFont = false;

        for (let i = 0; i < count; i++) {
            const labelText = await sections.nth(i).locator('.ribbon-label').textContent();
            const cleanLabel = labelText.trim();
            console.log(`Found section: "${cleanLabel}"`);
            
            if (cleanLabel === 'Story Editor') foundStoryEditor = true;
            if (cleanLabel === 'Font') {
                foundFont = true;
                const fontSelector = sections.nth(i).locator('scribus-font-selector');
                
                // Verify no internal label exists or is visible
                const internalLabel = fontSelector.locator('label');
                const labelVisible = await internalLabel.isVisible().catch(() => false);
                const labelTextInternal = labelVisible ? await internalLabel.textContent() : '';
                
                console.log(`  Font Selector label visible: ${labelVisible} (text: "${labelTextInternal}")`);
                expect(labelVisible === false || labelTextInternal.trim() === '').toBe(true);
            }
        }

        expect(foundStoryEditor).toBe(false);
        expect(foundFont).toBe(true);
    });
});
