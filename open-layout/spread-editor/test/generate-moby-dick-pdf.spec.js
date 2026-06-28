import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const STORE_DIR = path.resolve(import.meta.dirname, '../../store');
const DOC_PATH = 'alice/moby-dick';
const ABSOLUTE_DOC_DIR = path.join(STORE_DIR, DOC_PATH);

test.describe('Generate Moby-Dick Spreads and PDF', () => {
  test('should generate enough spreads and export PDF', async ({ page }) => {
    // Allow up to 4 minutes for this large book layout & rendering task
    test.setTimeout(240000);

    // 1. Create a large chunk of spreads upfront (e.g. 180 spreads)
    const totalSpreadsToCreate = 180;

    console.log(`Pre-creating ${totalSpreadsToCreate} spreads...`);
    for (let k = 2; k <= totalSpreadsToCreate; k++) {
      const spreadJson = {
        id: `spread-${k}`,
        pages: [
          { index: 0, label: String(2 * (k - 1) + 1) },
          { index: 1, label: String(2 * (k - 1) + 2) }
        ],
        frames: [
          {
            id: `p${2 * (k - 1) + 1}-c1`,
            type: 'text',
            x: 50,
            y: 50,
            width: 495.28,
            height: 741.89,
            storyRef: 'story-main'
          },
          {
            id: `p${2 * (k - 1) + 2}-c1`,
            type: 'text',
            x: 645.28,
            y: 50,
            width: 495.28,
            height: 741.89,
            storyRef: 'story-main'
          }
        ]
      };

      const filePath = path.join(ABSOLUTE_DOC_DIR, `spreads/spread-${k}.json`);
      fs.writeFileSync(filePath, JSON.stringify(spreadJson, null, 2));
    }

    console.log('Spreads written to disk.');

    // 2. Open pdf-exporter to run layout
    await page.goto(`/pdf-exporter/?doc=${DOC_PATH}`);
    await expect(page.locator('#btn-export')).toBeEnabled({ timeout: 40000 });

    // 3. Extract layout results from page context to see where the text actually ends
    const layoutDetails = await page.evaluate(async (docPath) => {
      const { createLayoutEngine, layoutDocument } = await import('/doc-renderer/lib/layout-document.js');
      const engine = await createLayoutEngine();
      const result = await layoutDocument(engine, docPath);

      // Track if a spread has any text on any of its pages
      const spreadHasTextMap = {};

      for (const p of result.pages) {
        let pageHasText = false;
        for (const box of p.textBoxes) {
          if (box.lines && box.lines.length > 0) {
            pageHasText = true;
          }
        }
        
        const pageNum = parseInt(p.label, 10);
        const spreadNum = Math.ceil(pageNum / 2);
        
        if (spreadHasTextMap[spreadNum] === undefined) {
          spreadHasTextMap[spreadNum] = false;
        }
        if (pageHasText) {
          spreadHasTextMap[spreadNum] = true;
        }
      }

      const unusedSpreadIds = [];
      for (const [spreadNum, hasText] of Object.entries(spreadHasTextMap)) {
        const num = parseInt(spreadNum, 10);
        if (!hasText && num > 1) {
          unusedSpreadIds.push(`spread-${num}`);
        }
      }

      return {
        totalPages: result.pages.length,
        unusedSpreadIds
      };
    }, DOC_PATH);

    console.log(`Layout details: Total pages computed: ${layoutDetails.totalPages}`);
    console.log(`Unused spreads identified: ${layoutDetails.unusedSpreadIds.length}`);

    // 4. Delete unused spreads from filesystem so the document is perfectly tight
    for (const spreadId of layoutDetails.unusedSpreadIds) {
      const filePath = path.join(ABSOLUTE_DOC_DIR, `spreads/${spreadId}.json`);
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
      const jpgPath = path.join(ABSOLUTE_DOC_DIR, `spreads/${spreadId}.jpg`);
      if (fs.existsSync(jpgPath)) {
        fs.unlinkSync(jpgPath);
      }
    }
    console.log('Unused spreads deleted.');

    // 5. Reload the PDF exporter page now that spreads are trimmed to fit exactly
    await page.goto(`/pdf-exporter/?doc=${DOC_PATH}`);
    await expect(page.locator('#btn-export')).toBeEnabled({ timeout: 40000 });

    // Intercept the file download stream to save the PDF
    await page.evaluate(() => {
      window.__pdfChunks = [];
      window.showSaveFilePicker = async () => ({
        createWritable: async () => {
          const chunks = window.__pdfChunks;
          return new WritableStream({
            write(chunk) { chunks.push(chunk); },
            close() { window.__pdfDone = true; },
          });
        },
      });
    });

    // Start export
    console.log('Exporting PDF...');
    await page.locator('#btn-export').click();

    // Wait for export to finish
    await expect(page.locator('#status')).toContainText('Done', { timeout: 120000 });

    // Extract PDF bytes
    const pdfBase64 = await page.evaluate(() => {
      const chunks = window.__pdfChunks;
      const total = chunks.reduce((n, c) => n + c.length, 0);
      const out = new Uint8Array(total);
      let off = 0;
      for (const c of chunks) { out.set(c, off); off += c.length; }

      // Convert to base64 to send back to node environment
      let binary = '';
      const len = out.byteLength;
      for (let i = 0; i < len; i++) {
        binary += String.fromCharCode(out[i]);
      }
      return btoa(binary);
    });

    const pdfBuffer = Buffer.from(pdfBase64, 'base64');
    const pdfPath = path.join(ABSOLUTE_DOC_DIR, 'moby-dick.pdf');
    fs.writeFileSync(pdfPath, pdfBuffer);

    console.log(`Successfully generated PDF. Saved to ${pdfPath} (${pdfBuffer.length} bytes)`);

    // Verify PDF header
    const header = pdfBuffer.slice(0, 8).toString('utf8');
    expect(header).toBe('%PDF-1.4');
  });
});
