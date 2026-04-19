import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { createColorManager } from '../lib/color-management.js';

describe('createColorManager', () => {
  it('converts pure white (C=0, M=0, Y=0, K=0) to RGB white', () => {
    const cm = createColorManager();
    const cmyk = new Uint8Array([0, 0, 0, 0]); // C=0 M=0 Y=0 K=0
    const rgba = cm.transformRow(cmyk, 1);
    assert.equal(rgba[0], 255); // R
    assert.equal(rgba[1], 255); // G
    assert.equal(rgba[2], 255); // B
    assert.equal(rgba[3], 255); // A
  });

  it('converts pure black (K=255) to RGB black', () => {
    const cm = createColorManager();
    const cmyk = new Uint8Array([0, 0, 0, 255]); // K=100%
    const rgba = cm.transformRow(cmyk, 1);
    assert.equal(rgba[0], 0);
    assert.equal(rgba[1], 0);
    assert.equal(rgba[2], 0);
    assert.equal(rgba[3], 255);
  });

  it('converts pure cyan (C=255, K=0) to RGB cyan', () => {
    const cm = createColorManager();
    const cmyk = new Uint8Array([255, 0, 0, 0]);
    const rgba = cm.transformRow(cmyk, 1);
    assert.equal(rgba[0], 0);   // R = 255*(1-1)*(1-0) = 0
    assert.equal(rgba[1], 255); // G
    assert.equal(rgba[2], 255); // B
    assert.equal(rgba[3], 255);
  });

  it('converts pure magenta (M=255, K=0)', () => {
    const cm = createColorManager();
    const cmyk = new Uint8Array([0, 255, 0, 0]);
    const rgba = cm.transformRow(cmyk, 1);
    assert.equal(rgba[0], 255); // R
    assert.equal(rgba[1], 0);   // G
    assert.equal(rgba[2], 255); // B
    assert.equal(rgba[3], 255);
  });

  it('converts pure yellow (Y=255, K=0)', () => {
    const cm = createColorManager();
    const cmyk = new Uint8Array([0, 0, 255, 0]);
    const rgba = cm.transformRow(cmyk, 1);
    assert.equal(rgba[0], 255); // R
    assert.equal(rgba[1], 255); // G
    assert.equal(rgba[2], 0);   // B
    assert.equal(rgba[3], 255);
  });

  it('handles multiple pixels in a row', () => {
    const cm = createColorManager();
    // 3 pixels: white, black, cyan
    const cmyk = new Uint8Array([
      0, 0, 0, 0,       // white
      0, 0, 0, 255,     // black
      255, 0, 0, 0,     // cyan
    ]);
    const rgba = cm.transformRow(cmyk, 3);
    assert.equal(rgba.length, 12);
    // white
    assert.equal(rgba[0], 255);
    assert.equal(rgba[1], 255);
    assert.equal(rgba[2], 255);
    // black
    assert.equal(rgba[4], 0);
    assert.equal(rgba[5], 0);
    assert.equal(rgba[6], 0);
    // cyan
    assert.equal(rgba[8], 0);
    assert.equal(rgba[9], 255);
    assert.equal(rgba[10], 255);
  });

  it('handles mid-tone CMYK values', () => {
    const cm = createColorManager();
    // C=128, M=64, Y=32, K=16
    const cmyk = new Uint8Array([128, 64, 32, 16]);
    const rgba = cm.transformRow(cmyk, 1);
    // R = 255 * (1 - 128/255) * (1 - 16/255) ≈ 255 * 0.498 * 0.937 ≈ 119
    // G = 255 * (1 - 64/255) * (1 - 16/255) ≈ 255 * 0.749 * 0.937 ≈ 179
    // B = 255 * (1 - 32/255) * (1 - 16/255) ≈ 255 * 0.875 * 0.937 ≈ 209
    // Allow ±1 for rounding
    assert.ok(Math.abs(rgba[0] - 119) <= 1, `R=${rgba[0]} expected ~119`);
    assert.ok(Math.abs(rgba[1] - 179) <= 1, `G=${rgba[1]} expected ~179`);
    assert.ok(Math.abs(rgba[2] - 209) <= 1, `B=${rgba[2]} expected ~209`);
    assert.equal(rgba[3], 255);
  });

  it('always sets alpha to 255', () => {
    const cm = createColorManager();
    const cmyk = new Uint8Array([100, 100, 100, 100]);
    const rgba = cm.transformRow(cmyk, 1);
    assert.equal(rgba[3], 255);
  });
});
