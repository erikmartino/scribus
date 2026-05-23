import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { createDownscaler } from '../lib/downscaler.js';

describe('createDownscaler', () => {
  it('reports correct output dimensions', () => {
    const ds = createDownscaler(100, 200, 4, () => {});
    assert.equal(ds.outWidth, 25);
    assert.equal(ds.outHeight, 50);
  });

  it('floors output dimensions (discards remainder pixels)', () => {
    const ds = createDownscaler(101, 203, 4, () => {});
    assert.equal(ds.outWidth, 25); // floor(101/4)
    assert.equal(ds.outHeight, 50); // floor(203/4)
  });

  it('produces correct output for uniform 2x2 red image scaled 2x', () => {
    const outputRows = [];
    const ds = createDownscaler(2, 2, 2, (idx, rgba) => {
      outputRows.push({ idx, rgba: new Uint8Array(rgba) }); // copy!
    });

    assert.equal(ds.outWidth, 1);
    assert.equal(ds.outHeight, 1);

    // Two rows of 2px red (255,0,0,255)
    const row = new Uint8Array([255, 0, 0, 255, 255, 0, 0, 255]);
    ds.pushRow(0, row);
    ds.pushRow(1, row);

    assert.equal(outputRows.length, 1);
    assert.equal(outputRows[0].idx, 0);
    assert.equal(outputRows[0].rgba[0], 255); // R
    assert.equal(outputRows[0].rgba[1], 0);   // G
    assert.equal(outputRows[0].rgba[2], 0);   // B
    assert.equal(outputRows[0].rgba[3], 255); // A
  });

  it('averages pixel values correctly (box filter)', () => {
    const outputRows = [];
    const ds = createDownscaler(2, 2, 2, (idx, rgba) => {
      outputRows.push({ idx, rgba: new Uint8Array(rgba) });
    });

    // Row 0: pixel(0,0)=black, pixel(1,0)=white
    const row0 = new Uint8Array([0, 0, 0, 255, 255, 255, 255, 255]);
    // Row 1: pixel(0,1)=black, pixel(1,1)=white
    const row1 = new Uint8Array([0, 0, 0, 255, 255, 255, 255, 255]);

    ds.pushRow(0, row0);
    ds.pushRow(1, row1);

    assert.equal(outputRows.length, 1);
    // Average of (0+255+0+255)/4 = 127.5 -> 128 (with +0.5 rounding)
    assert.equal(outputRows[0].rgba[0], 128); // R
    assert.equal(outputRows[0].rgba[1], 128); // G
    assert.equal(outputRows[0].rgba[2], 128); // B
    assert.equal(outputRows[0].rgba[3], 255); // A (all 255)
  });

  it('discards extra rows beyond outHeight * scale', () => {
    const outputRows = [];
    const ds = createDownscaler(2, 5, 2, (idx, rgba) => {
      outputRows.push({ idx, rgba: new Uint8Array(rgba) });
    });

    // outHeight = floor(5/2) = 2, so we need 4 rows for 2 output rows
    // The 5th row should be ignored
    const row = new Uint8Array([128, 128, 128, 255, 128, 128, 128, 255]);
    for (let i = 0; i < 5; i++) {
      ds.pushRow(i, row);
    }

    assert.equal(outputRows.length, 2);
    assert.equal(outputRows[0].idx, 0);
    assert.equal(outputRows[1].idx, 1);
  });

  it('handles scale factor of 1 (no downscaling)', () => {
    const outputRows = [];
    const ds = createDownscaler(3, 2, 1, (idx, rgba) => {
      outputRows.push({ idx, rgba: new Uint8Array(rgba) });
    });

    assert.equal(ds.outWidth, 3);
    assert.equal(ds.outHeight, 2);

    const row0 = new Uint8Array([10, 20, 30, 255, 40, 50, 60, 255, 70, 80, 90, 255]);
    const row1 = new Uint8Array([100, 110, 120, 255, 130, 140, 150, 255, 160, 170, 180, 255]);
    ds.pushRow(0, row0);
    ds.pushRow(1, row1);

    assert.equal(outputRows.length, 2);
    assert.deepEqual(Array.from(outputRows[0].rgba), [10, 20, 30, 255, 40, 50, 60, 255, 70, 80, 90, 255]);
  });

  it('reuses the same output buffer (shared buffer behavior)', () => {
    // This test documents that the downscaler reuses the same Uint8Array
    // for every onOutputRow call. Consumers must copy the data.
    const bufferRefs = [];
    const ds = createDownscaler(2, 4, 2, (_idx, rgba) => {
      bufferRefs.push(rgba); // store reference, not copy
    });

    const row = new Uint8Array([100, 0, 0, 255, 200, 0, 0, 255]);
    for (let i = 0; i < 4; i++) {
      ds.pushRow(i, row);
    }

    assert.equal(bufferRefs.length, 2);
    // Both references point to the same underlying buffer
    assert.equal(bufferRefs[0], bufferRefs[1],
      'onOutputRow receives the same buffer reference each time — consumers must copy');
  });

  it('produces multiple output rows for larger images', () => {
    const outputRows = [];
    const ds = createDownscaler(4, 6, 2, (idx, rgba) => {
      outputRows.push({ idx, rgba: new Uint8Array(rgba) });
    });

    assert.equal(ds.outWidth, 2);
    assert.equal(ds.outHeight, 3);

    // 6 rows of 4 pixels, all same value
    const row = new Uint8Array(4 * 4);
    for (let x = 0; x < 4; x++) {
      row[x * 4] = 60;
      row[x * 4 + 1] = 120;
      row[x * 4 + 2] = 180;
      row[x * 4 + 3] = 240;
    }
    for (let y = 0; y < 6; y++) {
      ds.pushRow(y, row);
    }

    assert.equal(outputRows.length, 3);
    for (const out of outputRows) {
      assert.equal(out.rgba[0], 60);
      assert.equal(out.rgba[1], 120);
      assert.equal(out.rgba[2], 180);
      assert.equal(out.rgba[3], 240);
    }
  });

  it('handles large scale factor', () => {
    const outputRows = [];
    const ds = createDownscaler(64, 64, 64, (idx, rgba) => {
      outputRows.push({ idx, rgba: new Uint8Array(rgba) });
    });

    assert.equal(ds.outWidth, 1);
    assert.equal(ds.outHeight, 1);

    // All white
    const row = new Uint8Array(64 * 4);
    for (let x = 0; x < 64; x++) {
      row[x * 4] = 255;
      row[x * 4 + 1] = 255;
      row[x * 4 + 2] = 255;
      row[x * 4 + 3] = 255;
    }
    for (let y = 0; y < 64; y++) {
      ds.pushRow(y, row);
    }

    assert.equal(outputRows.length, 1);
    assert.equal(outputRows[0].rgba[0], 255);
  });

  it('accumulator does not overflow with large scale and high values', () => {
    // With scale=64, we sum 64*64=4096 pixels. Max sum per channel = 4096*255 = 1,044,480.
    // Float64Array handles this fine but a Uint32Array would also be okay.
    // This test ensures the accumulator type (Float64Array) is sufficient.
    const outputRows = [];
    const ds = createDownscaler(64, 64, 64, (idx, rgba) => {
      outputRows.push({ idx, rgba: new Uint8Array(rgba) });
    });

    const row = new Uint8Array(64 * 4);
    row.fill(255);
    for (let y = 0; y < 64; y++) {
      ds.pushRow(y, row);
    }

    assert.equal(outputRows.length, 1);
    assert.equal(outputRows[0].rgba[0], 255);
    assert.equal(outputRows[0].rgba[1], 255);
    assert.equal(outputRows[0].rgba[2], 255);
    assert.equal(outputRows[0].rgba[3], 255);
  });
});
