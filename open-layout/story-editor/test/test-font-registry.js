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
    const buffer = new Uint8Array([1, 2, 3]);
    globalThis.fetch = async () => ({
      ok: true,
      arrayBuffer: async () => buffer.buffer,
    });

    const registry = new FontRegistry(makeHb());
    const out = await registry.loadFont('Roboto', 'https://example.com/font.ttf', [
      { variant: 'regular', bold: false },
      { variant: 'bold', bold: true },
    ]);

    assert.deepEqual(out, buffer);
    assert.ok(registry.getFont('Roboto', 'regular'));
    assert.ok(registry.getFont('Roboto', 'bold'));
    assert.deepEqual(registry.getFont('Roboto', 'regular').hbFont.setVariationsCalls, []);
    assert.deepEqual(registry.getFont('Roboto', 'bold').hbFont.setVariationsCalls, [{ wght: 700 }]);
  });

  it('throws descriptive error when fetch response is not ok', async () => {
    globalThis.fetch = async () => ({ ok: false, status: 404 });
    const registry = new FontRegistry(makeHb());

    await assert.rejects(
      () => registry.loadFont('Roboto', 'https://example.com/missing.ttf', [{ variant: 'regular', bold: false }]),
      /Font fetch failed: 404 https:\/\/example\.com\/missing\.ttf/,
    );
  });
});

describe('FontRegistry.registerFontFace', () => {
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

  it('loads face and registers it on document.fonts', async () => {
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
    const buffer = new Uint8Array([1]);

    await registry.registerFontFace('Test Family', buffer, 'normal', 'normal');

    assert.equal(loaded.length, 1);
    assert.deepEqual(loaded[0], { family: 'Test Family', options: { style: 'normal', weight: 'normal' } });

    assert.equal(added.length, 1);
    assert.ok(registry._fontFaces.has('Test Family:normal:normal'));
  });
});
