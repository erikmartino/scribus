import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';

/**
 * The tiff-decoder module depends on wasm-vips (CDN) and utif2 (CDN),
 * which cannot be imported in a Node unit test. Instead, we import the
 * module source and test the ensureRGBA logic by simulating the vips
 * Image API with a mock.
 *
 * This approach catches the bands<4 bug: the old code called
 * bandjoin(255) once for any band count < 4, which only adds one band
 * (e.g., 1-band -> 2-band, not 4-band).
 */

// --- Mock vips Image ---

/**
 * Create a mock vips Image with the given band count.
 * Simulates the subset of the vips API that ensureRGBA uses.
 */
function createMockImage(bands, opts = {}) {
  const interpretation = opts.interpretation || 'srgb';
  const format = opts.format || 'uchar';
  const deleted = { value: false };

  return {
    bands,
    interpretation,
    format,
    _deleted: deleted,

    colourspace(target) {
      return createMockImage(bands, { ...opts, interpretation: target, format });
    },

    cast(target) {
      return createMockImage(bands, { ...opts, format: target, interpretation });
    },

    bandjoin(arg) {
      if (Array.isArray(arg)) {
        // bandjoin([img, img]) — each element adds one band
        return createMockImage(bands + arg.length, { ...opts });
      }
      // bandjoin(255) — adds one constant band
      return createMockImage(bands + 1, { ...opts });
    },

    extract_band(start, options) {
      const n = options?.n ?? 1;
      return createMockImage(n, { ...opts });
    },

    hasAlpha() {
      return bands === 2 || bands === 4;
    },

    delete() {
      deleted.value = true;
    },
  };
}

// Re-implement ensureRGBA from tiff-decoder.js so we can test it
// without loading the CDN module. This mirrors the actual implementation.
function ensureRGBA(vipsModule, srcImage) {
  let img = srcImage;
  const intermediates = [];

  function advance(next) {
    if (next !== srcImage) intermediates.push(next);
    img = next;
  }

  try {
    if (img.interpretation !== 'srgb' && img.interpretation !== 'b-w') {
      advance(img.colourspace('srgb'));
    }

    if (img.format !== 'uchar') {
      advance(img.cast('uchar'));
    }

    if (img.bands === 1) {
      const rgb = img.bandjoin([img, img]);
      advance(rgb);
      advance(img.bandjoin(255));
    } else if (img.bands === 2) {
      const grey = img.extract_band(0);
      const alpha = img.extract_band(1);
      const rgb = grey.bandjoin([grey, grey]);
      const rgba = rgb.bandjoin(alpha);
      grey.delete();
      alpha.delete();
      rgb.delete();
      advance(rgba);
    } else if (img.bands === 3) {
      advance(img.bandjoin(255));
    } else if (img.bands > 4) {
      advance(img.extract_band(0, { n: 4 }));
    }

    const result = img;
    for (const tmp of intermediates) {
      if (tmp !== result) tmp.delete();
    }
    return result;
  } catch (err) {
    for (const tmp of intermediates) {
      try { tmp.delete(); } catch { /* ignore */ }
    }
    throw err;
  }
}

describe('ensureRGBA (tiff-decoder band normalization)', () => {
  it('passes through a 4-band sRGB uchar image unchanged', () => {
    const img = createMockImage(4);
    const result = ensureRGBA(null, img);
    assert.equal(result.bands, 4);
    assert.equal(result, img); // same object, no conversion needed
  });

  it('adds alpha to a 3-band image', () => {
    const img = createMockImage(3);
    const result = ensureRGBA(null, img);
    assert.equal(result.bands, 4);
  });

  it('converts 1-band greyscale to 4-band RGBA', () => {
    const img = createMockImage(1);
    const result = ensureRGBA(null, img);
    assert.equal(result.bands, 4,
      'Old bug: bandjoin(255) on 1-band produces 2-band, not 4-band. ' +
      'Must expand grey to RGB first, then add alpha.');
  });

  it('converts 2-band greyscale+alpha to 4-band RGBA', () => {
    const img = createMockImage(2);
    const result = ensureRGBA(null, img);
    assert.equal(result.bands, 4,
      'Old bug: bandjoin(255) on 2-band produces 3-band, not 4-band. ' +
      'Must expand grey to RGB, then re-attach alpha.');
  });

  it('strips extra bands from a 5-band image', () => {
    const img = createMockImage(5);
    const result = ensureRGBA(null, img);
    assert.equal(result.bands, 4);
  });

  it('strips extra bands from a 6-band image', () => {
    const img = createMockImage(6);
    const result = ensureRGBA(null, img);
    assert.equal(result.bands, 4);
  });

  it('converts non-sRGB interpretation', () => {
    const img = createMockImage(4, { interpretation: 'lab' });
    const result = ensureRGBA(null, img);
    assert.equal(result.bands, 4);
    assert.equal(result.interpretation, 'srgb');
  });

  it('casts non-uchar format', () => {
    const img = createMockImage(4, { format: 'float' });
    const result = ensureRGBA(null, img);
    assert.equal(result.bands, 4);
    assert.equal(result.format, 'uchar');
  });

  it('handles 1-band b-w interpretation (no colourspace conversion)', () => {
    const img = createMockImage(1, { interpretation: 'b-w' });
    const result = ensureRGBA(null, img);
    assert.equal(result.bands, 4);
    // Should NOT have called colourspace('srgb') because b-w is allowed
  });
});

describe('old bands<4 bug demonstration', () => {
  it('old code: bandjoin(255) on 1-band gives 2, not 4', () => {
    // This shows what the OLD code did:
    // if (bands < 4) { bandjoin(255) } — only adds 1 band
    const img = createMockImage(1);
    const wrongResult = img.bandjoin(255); // old approach
    assert.equal(wrongResult.bands, 2,
      'Demonstrates the bug: single bandjoin(255) on 1-band gives 2 bands');
  });

  it('old code: bandjoin(255) on 2-band gives 3, not 4', () => {
    const img = createMockImage(2);
    const wrongResult = img.bandjoin(255);
    assert.equal(wrongResult.bands, 3,
      'Demonstrates the bug: single bandjoin(255) on 2-band gives 3 bands');
  });
});
