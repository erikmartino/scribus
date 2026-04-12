import test from 'node:test';
import assert from 'node:assert';
import { GoogleFontManager } from '../google-font-manager.js';
import { normalizeFamilyId, normalizeVariantId } from '../paragraph-font-style.js';

test('GoogleFontManager - catalog loading and filtering', async () => {
  const mockCatalog = {
    items: [
      { family: 'Roboto', files: { regular: 'http://example.com/roboto.ttf' } },
      { family: 'Lato', files: { regular: 'http://example.com/lato.ttf' } }
    ]
  };

  const manager = new GoogleFontManager({
    fetch: async (url) => {
      if (url.includes('webfonts.json')) {
        return {
          ok: true,
          json: async () => mockCatalog
        };
      }
      return { ok: false };
    }
  });

  const families = await manager.getFamilies();
  assert.strictEqual(families.length, 2);
  assert.ok(families.find(f => f.id === 'roboto'));
  assert.ok(families.find(f => f.family === 'Lato'));
});

test('GoogleFontManager - resolving a font binary', async () => {
  const mockCatalog = {
    items: [
      {
        family: 'Roboto',
        files: {
          regular: 'http://example.com/roboto-regular.ttf',
          '700': 'http://example.com/roboto-700.woff2'
        }
      }
    ]
  };

  const manager = new GoogleFontManager({
    fetch: async (url) => {
      if (url.includes('webfonts.json')) return { ok: true, json: async () => mockCatalog };
      if (url.endsWith('.ttf')) return { ok: true, arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer };
      return { ok: false };
    }
  });

  // Regular has truetype (.ttf)
  const binary = await manager.resolveFont('roboto', 'regular');
  assert.ok(binary instanceof Uint8Array);
  assert.strictEqual(binary[0], 1);

  // 700 only has woff2 - should return null
  const missing = await manager.resolveFont('roboto', '700');
  assert.strictEqual(missing, null);
});

test('Style normalization helpers', () => {
  assert.strictEqual(normalizeFamilyId('Open Sans'), 'open-sans');
  assert.strictEqual(normalizeVariantId(400, 'normal'), 'regular');
  assert.strictEqual(normalizeVariantId(700, 'italic'), '700italic');
  assert.strictEqual(normalizeVariantId('400', 'italic'), 'italic');
});

test('LIVE CORS CHECK - ensures real API allows browser access', async () => {
  const manager = new GoogleFontManager();
  const response = await fetch(manager._apiBase, { method: 'GET' });
  
  assert.strictEqual(response.ok, true, `Real API ${manager._apiBase} should be reachable.`);
  
  // Checking the 'access-control-allow-origin' header.
  // Note: response.headers is not exactly a plain object in Node's fetch, but it has a get() method.
  const corsHeader = response.headers.get('access-control-allow-origin');
  assert.ok(corsHeader === '*' || corsHeader?.includes('raw.githubusercontent.com') || corsHeader?.includes('*'), 
    `API ${manager._apiBase} MUST provide CORS headers (found: ${corsHeader})`);
  
  console.log(`  ✓ Verified CORS header: access-control-allow-origin: ${corsHeader}`);
});
