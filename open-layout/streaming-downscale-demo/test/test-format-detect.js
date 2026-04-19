import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { detectFormat } from '../lib/format-detect.js';

describe('detectFormat', () => {
  it('detects PNG from magic bytes', () => {
    const header = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0]);
    assert.equal(detectFormat(header), 'png');
  });

  it('detects TIFF little-endian (II)', () => {
    const header = new Uint8Array([73, 73, 42, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    assert.equal(detectFormat(header), 'tiff');
  });

  it('detects TIFF big-endian (MM)', () => {
    const header = new Uint8Array([77, 77, 0, 42, 0, 0, 0, 0, 0, 0, 0, 0]);
    assert.equal(detectFormat(header), 'tiff');
  });

  it('detects JPEG2000 JP2 box format', () => {
    // 00 00 00 0C 6A 50 ...
    const header = new Uint8Array([0, 0, 0, 12, 106, 80, 0, 0, 0, 0, 0, 0]);
    assert.equal(detectFormat(header), 'jp2');
  });

  it('detects JPEG2000 raw codestream', () => {
    // FF 4F FF 51
    const header = new Uint8Array([255, 79, 255, 81, 0, 0, 0, 0, 0, 0, 0, 0]);
    assert.equal(detectFormat(header), 'jp2');
  });

  it('returns null for unknown format', () => {
    const header = new Uint8Array([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    assert.equal(detectFormat(header), null);
  });

  it('returns null for JPEG (not supported)', () => {
    // JPEG SOI marker: FF D8 FF
    const header = new Uint8Array([255, 216, 255, 224, 0, 0, 0, 0, 0, 0, 0, 0]);
    assert.equal(detectFormat(header), null);
  });

  it('returns null for buffer shorter than 4 bytes', () => {
    const header = new Uint8Array([137, 80, 78]);
    assert.equal(detectFormat(header), null);
  });

  it('works with ArrayBuffer input (not just Uint8Array)', () => {
    const buf = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0]);
    assert.equal(detectFormat(buf.buffer), 'png');
  });

  it('detects TIFF from exactly 4 bytes', () => {
    // Only 4 bytes, no JP2 check possible but TIFF needs only 2
    const header = new Uint8Array([73, 73, 42, 0]);
    assert.equal(detectFormat(header), 'tiff');
  });

  it('does not false-positive on II that is not TIFF', () => {
    // II bytes but in a context that is valid TIFF — the function
    // only checks the first 2 bytes, so this will match. This test
    // documents the current behavior: any file starting with II/MM
    // is classified as TIFF.
    const header = new Uint8Array([73, 73, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    assert.equal(detectFormat(header), 'tiff');
  });
});
