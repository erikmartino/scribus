
import { test, expect } from '@playwright/test';

test('dump layout data', async ({ page }) => {
  await page.goto('/pdf-exporter/?doc=demo/typography-sampler');
  const btn = page.locator('#btn-export');
  await expect(btn).toBeEnabled({ timeout: 30000 });

  const layoutData = await page.evaluate(async () => {
    // We need to access the engine and docPath. 
    // In pdf-exporter/app/main.js, they might not be global.
    // But we can just run the logic here since we have the imports.
    
    // Actually, let's just use what's already on the page if possible.
    // Or we can import them.
    
    const { createLayoutEngine, layoutDocument } = await import('./lib/pdf-generator.js');
    const engine = await createLayoutEngine();
    const params = new URLSearchParams(location.search);
    const docPath = params.get('doc');
    const { pages } = await layoutDocument(engine, docPath, { fontSize: 20 });
    
    const dump = [];
    for (const page of pages) {
      const pDump = { index: page.pageIndex, frames: [] };
      for (const frame of page.frames) {
        if (frame.type === 'text') {
          const { box, lines } = frame.data;
          const fDump = { x: box.x, y: box.y, lines: [] };
          for (const line of lines) {
            const lDump = { y: line.y, fontSize: line.fontSize, words: [] };
            for (const word of line.words) {
              let xOffset = 0;
              const wDump = { x: word.x, glyphs: [] };
              for (const g of word.glyphData) {
                const absX = box.x + 16 + word.x + xOffset + g.dx;
                wDump.glyphs.push({ text: g.text, absX, ax: g.ax, dx: g.dx, ay: g.ay, dy: g.dy });
                xOffset += g.ax;
              }
              lDump.words.push(wDump);
            }
            fDump.lines.push(lDump);
          }
          pDump.frames.push(fDump);
        }
      }
      dump.push(pDump);
    }
    return dump;
  });

  console.log(JSON.stringify(layoutData, null, 2));
});
