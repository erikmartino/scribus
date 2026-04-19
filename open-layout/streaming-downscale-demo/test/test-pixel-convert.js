import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { rowToRGBA, cmykRowToRGBA, interpretComponents } from '../lib/pixel-convert.js';

describe('rowToRGBA', () => {
  it('copies RGBA 4-component data through unchanged', () => {
    const src = new Uint8Array([10, 20, 30, 128]);
    const dst = new Uint8Array(4);
    rowToRGBA(src, dst, 1, 4);
    assert.deepEqual(Array.from(dst), [10, 20, 30, 128]);
  });

  it('converts RGB 3-component to RGBA with alpha=255', () => {
    const src = new Uint8Array([10, 20, 30]);
    const dst = new Uint8Array(4);
    rowToRGBA(src, dst, 1, 3);
    assert.deepEqual(Array.from(dst), [10, 20, 30, 255]);
  });

  it('converts greyscale+alpha 2-component', () => {
    const src = new Uint8Array([100, 200]);
    const dst = new Uint8Array(4);
    rowToRGBA(src, dst, 1, 2);
    assert.deepEqual(Array.from(dst), [100, 100, 100, 200]);
  });

  it('converts greyscale 1-component to RGBA', () => {
    const src = new Uint8Array([77]);
    const dst = new Uint8Array(4);
    rowToRGBA(src, dst, 1, 1);
    assert.deepEqual(Array.from(dst), [77, 77, 77, 255]);
  });

  it('handles multiple pixels in a row', () => {
    const src = new Uint8Array([10, 20, 30, 40, 50, 60]);
    const dst = new Uint8Array(8);
    rowToRGBA(src, dst, 2, 3);
    assert.deepEqual(Array.from(dst), [10, 20, 30, 255, 40, 50, 60, 255]);
  });

  it('handles CMYK when isCMYK flag is set', () => {
    // Pure white CMYK: C=0 M=0 Y=0 K=0
    const src = new Uint8Array([0, 0, 0, 0]);
    const dst = new Uint8Array(4);
    rowToRGBA(src, dst, 1, 4, { isCMYK: true });
    assert.equal(dst[0], 255);
    assert.equal(dst[1], 255);
    assert.equal(dst[2], 255);
    assert.equal(dst[3], 255);
  });

  it('does NOT treat 4-component as CMYK without flag', () => {
    // RGBA pixel (255, 0, 0, 128) should pass through as-is
    const src = new Uint8Array([255, 0, 0, 128]);
    const dst = new Uint8Array(4);
    rowToRGBA(src, dst, 1, 4);
    assert.deepEqual(Array.from(dst), [255, 0, 0, 128]);
  });

  it('converts indexed color with palette', () => {
    const palette = new Uint8Array([
      255, 0, 0,     // index 0 = red
      0, 255, 0,     // index 1 = green
      0, 0, 255,     // index 2 = blue
    ]);
    const src = new Uint8Array([2, 0, 1]); // 3 pixels: blue, red, green
    const dst = new Uint8Array(12);
    rowToRGBA(src, dst, 3, 1, { palette });
    assert.deepEqual(Array.from(dst), [
      0, 0, 255, 255,   // blue
      255, 0, 0, 255,   // red
      0, 255, 0, 255,   // green
    ]);
  });

  it('converts indexed color with transparency table', () => {
    const palette = new Uint8Array([255, 0, 0, 0, 255, 0]);
    const trns = new Uint8Array([128, 64]);
    const src = new Uint8Array([0, 1]);
    const dst = new Uint8Array(8);
    rowToRGBA(src, dst, 2, 1, { palette, trns });
    assert.deepEqual(Array.from(dst), [255, 0, 0, 128, 0, 255, 0, 64]);
  });

  it('handles 16-bit RGBA (takes high bytes)', () => {
    // 16-bit RGBA: R=0x8000, G=0x4000, B=0xC000, A=0xFF00
    const src = new Uint8Array([0x80, 0x00, 0x40, 0x00, 0xC0, 0x00, 0xFF, 0x00]);
    const dst = new Uint8Array(4);
    rowToRGBA(src, dst, 1, 4, { bitDepth: 16 });
    assert.deepEqual(Array.from(dst), [0x80, 0x40, 0xC0, 0xFF]);
  });

  it('handles 16-bit RGB', () => {
    const src = new Uint8Array([0x80, 0x00, 0x40, 0x00, 0xC0, 0x00]);
    const dst = new Uint8Array(4);
    rowToRGBA(src, dst, 1, 3, { bitDepth: 16 });
    assert.deepEqual(Array.from(dst), [0x80, 0x40, 0xC0, 255]);
  });

  it('handles 16-bit greyscale', () => {
    const src = new Uint8Array([0xAB, 0xCD]);
    const dst = new Uint8Array(4);
    rowToRGBA(src, dst, 1, 1, { bitDepth: 16 });
    assert.deepEqual(Array.from(dst), [0xAB, 0xAB, 0xAB, 255]);
  });

  it('handles 16-bit greyscale+alpha', () => {
    const src = new Uint8Array([0x80, 0x00, 0x40, 0x00]);
    const dst = new Uint8Array(4);
    rowToRGBA(src, dst, 1, 2, { bitDepth: 16 });
    assert.deepEqual(Array.from(dst), [0x80, 0x80, 0x80, 0x40]);
  });
});

describe('cmykRowToRGBA', () => {
  it('converts pure black (K=255)', () => {
    const src = new Uint8Array([0, 0, 0, 255]);
    const dst = new Uint8Array(4);
    cmykRowToRGBA(src, dst, 1);
    assert.equal(dst[0], 0);
    assert.equal(dst[1], 0);
    assert.equal(dst[2], 0);
    assert.equal(dst[3], 255);
  });

  it('converts pure cyan', () => {
    const src = new Uint8Array([255, 0, 0, 0]);
    const dst = new Uint8Array(4);
    cmykRowToRGBA(src, dst, 1);
    assert.equal(dst[0], 0);
    assert.equal(dst[1], 255);
    assert.equal(dst[2], 255);
    assert.equal(dst[3], 255);
  });
});

describe('interpretComponents', () => {
  it('treats 4 components as RGBA by default (not CMYK)', () => {
    const result = interpretComponents(4);
    assert.equal(result.isCMYK, false);
    assert.equal(result.hasAlpha, true);
    assert.equal(result.displayComponents, 4);
  });

  it('treats 4 components as CMYK when colorSpace is "cmyk"', () => {
    const result = interpretComponents(4, { colorSpace: 'cmyk' });
    assert.equal(result.isCMYK, true);
    assert.equal(result.hasAlpha, false);
  });

  it('treats 4 components as CMYK when colorSpace is "CMYK" (case-insensitive)', () => {
    const result = interpretComponents(4, { colorSpace: 'CMYK' });
    assert.equal(result.isCMYK, true);
  });

  it('treats 4 components as CMYK for YCCK color space', () => {
    const result = interpretComponents(4, { colorSpace: 'ycck' });
    assert.equal(result.isCMYK, true);
  });

  it('treats 3 components as RGB', () => {
    const result = interpretComponents(3);
    assert.equal(result.isCMYK, false);
    assert.equal(result.hasAlpha, false);
    assert.equal(result.displayComponents, 3);
  });

  it('treats 2 components as greyscale+alpha', () => {
    const result = interpretComponents(2);
    assert.equal(result.hasAlpha, true);
    assert.equal(result.displayComponents, 2);
  });

  it('treats 1 component as greyscale', () => {
    const result = interpretComponents(1);
    assert.equal(result.hasAlpha, false);
    assert.equal(result.displayComponents, 1);
  });

  it('treats 4 components as RGBA when colorSpace is "sRGB"', () => {
    const result = interpretComponents(4, { colorSpace: 'sRGB' });
    assert.equal(result.isCMYK, false);
    assert.equal(result.hasAlpha, true);
  });

  it('treats 4 components as RGBA when no colorSpace metadata', () => {
    // This is the bug scenario: JP2 decoder assumed 4 components = CMYK.
    // Now it should default to RGBA unless explicitly tagged.
    const result = interpretComponents(4, {});
    assert.equal(result.isCMYK, false,
      '4 components without colorSpace metadata must NOT be treated as CMYK');
  });
});
