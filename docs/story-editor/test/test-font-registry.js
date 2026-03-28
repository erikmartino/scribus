import { describe, it, beforeEach, afterEach } from 'node:test';
import { strict as assert } from 'node:assert';
import { FontRegistry } from '../lib/font-registry.js';

function makeHb() {
  return {
    createBlob(buffer) {
      return { buffer };
    },
    createFace(blob) {
      return { blob, upem: 1000 };
    },
    createFont(face) {
      return {
        face,
        setVariationsCalls: [],
        setVariations(v) {
          this.setVariationsCalls.push(v);
        },
      };
    },
  };
}

describe('FontRegistry.loadFont', () => {
  let originalFetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('registers variants and applies bold variation only for bold variants', async () => {
    const buffer = new Uint8Array([1, 2, 3]).buffer;
    globalThis.fetch = async () => ({
      ok: true,
      arrayBuffer: async () => buffer,
    });

    const registry = new FontRegistry(makeHb());
    const out = await registry.loadFont('https://example.com/font.ttf', [
      { key: 'regular', bold: false },
      { key: 'bold', bold: true },
    ]);

    assert.equal(out, buffer);
    assert.ok(registry.getFont('regular'));
    assert.ok(registry.getFont('bold'));
    assert.deepEqual(registry.getFont('regular').hbFont.setVariationsCalls, []);
    assert.deepEqual(registry.getFont('bold').hbFont.setVariationsCalls, [{ wght: 700 }]);
  });

  it('throws descriptive error when fetch response is not ok', async () => {
    globalThis.fetch = async () => ({ ok: false, status: 404 });
    const registry = new FontRegistry(makeHb());

    await assert.rejects(
      () => registry.loadFont('https://example.com/missing.ttf', [{ key: 'regular', bold: false }]),
      /Font fetch failed: 404 https:\/\/example\.com\/missing\.ttf/,
    );
  });
});

describe('FontRegistry.registerFontFaces', () => {
  let originalFontFace;
  let originalDocument;

  beforeEach(() => {
    originalFontFace = globalThis.FontFace;
    originalDocument = globalThis.document;
  });

  afterEach(() => {
    globalThis.FontFace = originalFontFace;
    globalThis.document = originalDocument;
  });

  it('loads each face and registers it on document.fonts', async () => {
    const loaded = [];
    const added = [];

    globalThis.FontFace = class {
      constructor(family, buffer, options) {
        this.family = family;
        this.buffer = buffer;
        this.options = options;
      }
      async load() {
        loaded.push({ family: this.family, options: this.options });
        return this;
      }
    };

    globalThis.document = {
      fonts: {
        add(face) {
          added.push(face);
        },
      },
    };

    const registry = new FontRegistry(makeHb());
    const entries = [
      { buffer: new Uint8Array([1]).buffer, style: 'normal', weight: 'normal' },
      { buffer: new Uint8Array([2]).buffer, style: 'italic', weight: 'bold' },
    ];

    await registry.registerFontFaces(entries, 'Test Family');

    assert.equal(loaded.length, 2);
    assert.deepEqual(loaded[0], { family: 'Test Family', options: { style: 'normal', weight: 'normal' } });
    assert.deepEqual(loaded[1], { family: 'Test Family', options: { style: 'italic', weight: 'bold' } });

    assert.equal(added.length, 2);
    assert.equal(registry._fontFaces.length, 2);
    assert.equal(registry._fontFaces[0], added[0]);
    assert.equal(registry._fontFaces[1], added[1]);
  });
});
