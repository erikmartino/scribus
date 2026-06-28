// pdf-exporter.spec.js — Playwright E2E test for the PDF exporter
//
// Verifies that the exporter page loads, accepts the ?doc= parameter,
// initialises the layout engine, and produces valid PDF output.

import { test, expect } from '@playwright/test';

test.describe('PDF Exporter', () => {
  /** Capture console and page errors for every test. */
  let consoleErrors = [];

  test.beforeEach(({ page }) => {
    consoleErrors = [];
    page.on('console', msg => {
      console.log(`BROWSER [${msg.type()}]: ${msg.text()}`);
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });
    page.on('pageerror', err => {
      console.error(`BROWSER [error]: ${err.message}`);
      consoleErrors.push(err.message);
    });
    page.on('requestfailed', request => {
      console.log(`FAILED REQUEST: ${request.url()} - ${request.failure()?.errorText || 'Unknown'}`);
    });
    page.on('response', response => {
      if (!response.ok()) {
        console.log(`FAILED RESPONSE: ${response.url()} - ${response.status()}`);
      }
    });
  });

  test('page loads and initialises the layout engine', async ({ page }) => {
    await page.goto('/pdf-exporter/?doc=demo/typography-sampler');

    // Wait for the engine to initialise (button becomes enabled)
    const btn = page.locator('#btn-export');
    await expect(btn).toBeEnabled({ timeout: 30_000 });

    // Status should say "Ready"
    const status = page.locator('#status');
    await expect(status).toContainText('Ready', { timeout: 5_000 });

    // No browser errors during load
    expect(consoleErrors, `console errors: ${consoleErrors.join('; ')}`).toHaveLength(0);
  });

  test('?doc= parameter is reflected in the page title and doc label', async ({ page }) => {
    await page.goto('/pdf-exporter/?doc=demo/typography-sampler');
    await expect(page.locator('#btn-export')).toBeEnabled({ timeout: 30_000 });

    await expect(page.locator('#doc-label')).toHaveText('demo/typography-sampler');
    const title = await page.title();
    expect(title).toContain('demo/typography-sampler');
  });

  test('export produces valid PDF bytes', async ({ page }) => {
    await page.goto('/pdf-exporter/?doc=demo/typography-sampler');
    await expect(page.locator('#btn-export')).toBeEnabled({ timeout: 30_000 });

    // We intercept the download by overriding showSaveFilePicker so we can
    // capture the streamed bytes in the test.  We replace the save-picker with
    // a writable WritableStream that accumulates chunks into window.__pdfBytes.
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

    await page.locator('#btn-export').click();

    // Wait for export to complete (status says "Done")
    await expect(page.locator('#status')).toContainText('Done', { timeout: 60_000 });

    // Collect bytes and validate
    const pdfBytes = await page.evaluate(async () => {
      // Concatenate chunks into a single Uint8Array
      const chunks = window.__pdfChunks;
      const total = chunks.reduce((n, c) => n + c.length, 0);
      const out = new Uint8Array(total);
      let off = 0;
      for (const c of chunks) { out.set(c, off); off += c.length; }
      return Array.from(out.slice(0, 16)); // return first 16 bytes for header check
    });

    // First 8 bytes must be "%PDF-1.4"
    const header = String.fromCharCode(...pdfBytes.slice(0, 8));
    expect(header).toBe('%PDF-1.4');

    // Total size should be non-trivial
    const totalSize = await page.evaluate(() =>
      window.__pdfChunks.reduce((n, c) => n + c.length, 0)
    );
    expect(totalSize).toBeGreaterThan(1024);

    // The PDF should end with %%EOF (check last 64 bytes)
    const tail = await page.evaluate(() => {
      const chunks = window.__pdfChunks;
      const total = chunks.reduce((n, c) => n + c.length, 0);
      const out = new Uint8Array(total);
      let off = 0;
      for (const c of chunks) { out.set(c, off); off += c.length; }
      return new TextDecoder('latin1').decode(out.slice(-64));
    });
    expect(tail).toContain('%%EOF');

    // No browser console errors during export.
    // Image 404s are non-fatal (caught by pdf-generator) — filter them out.
    const fatalErrors = consoleErrors.filter(e =>
      !e.includes('[pdf-writer]') && !e.includes('404')
    );
    expect(fatalErrors, `console errors: ${fatalErrors.join('; ')}`).toHaveLength(0);
  });

  test('exporting a multispread document produces correct page count and page content', async ({ page }) => {
    await page.goto('/pdf-exporter/?doc=alice/brochure-q2');
    await expect(page.locator('#btn-export')).toBeEnabled({ timeout: 30_000 });

    // Mock showSaveFilePicker to capture the PDF stream chunks
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

    await page.locator('#btn-export').click();

    // Wait for export to complete (status says "Done")
    await expect(page.locator('#status')).toContainText('Done', { timeout: 60_000 });

    // Collect all PDF bytes as a latin1 (binary-safe ASCII) string
    const pdfText = await page.evaluate(() => {
      const chunks = window.__pdfChunks;
      const total = chunks.reduce((n, c) => n + c.length, 0);
      const out = new Uint8Array(total);
      let off = 0;
      for (const c of chunks) { out.set(c, off); off += c.length; }
      return new TextDecoder('latin1').decode(out);
    });

    // Verify first 8 bytes
    expect(pdfText.startsWith('%PDF-1.4')).toBe(true);

    // Verify page count (number of "/Type /Page" instances, excluding "/Type /Pages")
    const pageMatches = pdfText.match(/\/Type\s*\/Page\b/g);
    const pageCount = pageMatches ? pageMatches.length : 0;
    expect(pageCount).toBe(3);

    // Extract all Tj text strings and join them to reconstruct the document text
    const tjText = [...pdfText.matchAll(/\(([^)]*)\)\s*Tj/g)].map(m => m[1]).join('');
    const cleanText = tjText.replace(/\s+/g, '').replace(/-/g, '');

    // Verify that the correct content from different stories is present in the PDF
    expect(cleanText).toContain('excitedtosharethreenewproducts');
    expect(cleanText).toContain('License:GPL');

    // No fatal browser console errors during export
    const fatalErrors = consoleErrors.filter(e =>
      !e.includes('[pdf-writer]') && !e.includes('404')
    );
    expect(fatalErrors, `console errors: ${fatalErrors.join('; ')}`).toHaveLength(0);
  });
});

