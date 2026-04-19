import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { createHash } from 'node:crypto';
import { streamPng } from '../lib/png-stream.js';

// --- PNG builder helpers ---
// Constructs minimal valid PNG files in memory for testing.

/** Write a 32-bit big-endian unsigned integer into buf at offset. */
function writeU32(buf, offset, value) {
  buf[offset]     = (value >>> 24) & 0xff;
  buf[offset + 1] = (value >>> 16) & 0xff;
  buf[offset + 2] = (value >>>  8) & 0xff;
  buf[offset + 3] =  value         & 0xff;
}

/** CRC32 for PNG chunk validation. */
function crc32(data) {
  // Use Node's zlib-based CRC
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i++) {
    crc ^= data[i];
    for (let j = 0; j < 8; j++) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/** Build a PNG chunk: 4-byte length, 4-byte type, data, 4-byte CRC. */
function makeChunk(type, data) {
  const typeBytes = new TextEncoder().encode(type);
  const chunk = new Uint8Array(4 + 4 + data.length + 4);
  writeU32(chunk, 0, data.length);
  chunk.set(typeBytes, 4);
  chunk.set(data, 8);
  // CRC covers type + data
  const crcInput = new Uint8Array(4 + data.length);
  crcInput.set(typeBytes, 0);
  crcInput.set(data, 4);
  writeU32(chunk, 8 + data.length, crc32(crcInput));
  return chunk;
}

/** Build IHDR chunk data. */
function makeIHDR(width, height, bitDepth, colorType) {
  const data = new Uint8Array(13);
  writeU32(data, 0, width);
  writeU32(data, 4, height);
  data[8] = bitDepth;
  data[9] = colorType;
  data[10] = 0; // compression
  data[11] = 0; // filter
  data[12] = 0; // interlace
  return makeChunk('IHDR', data);
}

/** Compress raw scanline data (with filter bytes) using deflate for IDAT. */
async function compressIDAT(rawScanlines) {
  const cs = new CompressionStream('deflate');
  const writer = cs.writable.getWriter();
  const reader = cs.readable.getReader();

  const chunks = [];
  const readAll = (async () => {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      chunks.push(value);
    }
  })();

  await writer.write(rawScanlines);
  await writer.close();
  await readAll;

  let totalLen = 0;
  for (const c of chunks) totalLen += c.length;
  const compressed = new Uint8Array(totalLen);
  let offset = 0;
  for (const c of chunks) {
    compressed.set(c, offset);
    offset += c.length;
  }
  return makeChunk('IDAT', compressed);
}

/** Build IEND chunk. */
function makeIEND() {
  return makeChunk('IEND', new Uint8Array(0));
}

/** PNG file signature. */
const PNG_SIG = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);

/** Concatenate multiple Uint8Arrays. */
function concat(...arrays) {
  let total = 0;
  for (const a of arrays) total += a.length;
  const result = new Uint8Array(total);
  let offset = 0;
  for (const a of arrays) {
    result.set(a, offset);
    offset += a.length;
  }
  return result;
}

/**
 * Build a minimal valid PNG from raw RGBA pixel rows.
 * @param {number} width
 * @param {number} height
 * @param {Uint8Array} rgbaPixels - width*height*4 bytes of RGBA data
 * @param {object} [opts]
 * @param {number} [opts.colorType] - PNG color type (default 6 = RGBA)
 * @param {number} [opts.bitDepth] - bit depth (default 8)
 * @param {Uint8Array} [opts.rawData] - pre-built raw scanlines with filter bytes (overrides rgbaPixels)
 * @returns {Promise<Uint8Array>}
 */
async function buildPng(width, height, rgbaPixels, opts = {}) {
  const colorType = opts.colorType ?? 6;
  const bitDepth = opts.bitDepth ?? 8;

  const ihdr = makeIHDR(width, height, bitDepth, colorType);

  let rawScanlines;
  if (opts.rawData) {
    rawScanlines = opts.rawData;
  } else {
    // Add filter byte (0 = None) before each row
    const channels = colorType === 6 ? 4 : colorType === 2 ? 3 : colorType === 4 ? 2 : 1;
    const bytesPerPixel = channels * (bitDepth / 8);
    const stride = width * bytesPerPixel;
    rawScanlines = new Uint8Array(height * (1 + stride));
    for (let y = 0; y < height; y++) {
      rawScanlines[y * (1 + stride)] = 0; // filter = None
      const rowStart = y * width * channels;
      // For RGBA colorType 6, rgbaPixels is already in the right format
      if (colorType === 6) {
        rawScanlines.set(
          rgbaPixels.subarray(y * width * 4, y * width * 4 + stride),
          y * (1 + stride) + 1
        );
      } else if (colorType === 2) {
        // RGB: strip alpha
        for (let x = 0; x < width; x++) {
          const srcOff = (y * width + x) * 4;
          const dstOff = y * (1 + stride) + 1 + x * 3;
          rawScanlines[dstOff]     = rgbaPixels[srcOff];
          rawScanlines[dstOff + 1] = rgbaPixels[srcOff + 1];
          rawScanlines[dstOff + 2] = rgbaPixels[srcOff + 2];
        }
      } else if (colorType === 0) {
        // Greyscale: take R channel
        for (let x = 0; x < width; x++) {
          rawScanlines[y * (1 + stride) + 1 + x] = rgbaPixels[(y * width + x) * 4];
        }
      } else if (colorType === 4) {
        // Greyscale+Alpha: take R and A
        for (let x = 0; x < width; x++) {
          const srcOff = (y * width + x) * 4;
          const dstOff = y * (1 + stride) + 1 + x * 2;
          rawScanlines[dstOff]     = rgbaPixels[srcOff];
          rawScanlines[dstOff + 1] = rgbaPixels[srcOff + 3];
        }
      }
    }
  }

  const idat = await compressIDAT(rawScanlines);
  const iend = makeIEND();

  return concat(PNG_SIG, ihdr, idat, iend);
}

/** Create a ReadableStream from a Uint8Array, optionally splitting into chunks. */
function arrayToStream(data, chunkSize) {
  if (!chunkSize) {
    return new ReadableStream({
      start(controller) {
        controller.enqueue(data);
        controller.close();
      }
    });
  }
  let offset = 0;
  return new ReadableStream({
    pull(controller) {
      if (offset >= data.length) {
        controller.close();
        return;
      }
      const end = Math.min(offset + chunkSize, data.length);
      controller.enqueue(data.slice(offset, end));
      offset = end;
    }
  });
}

// --- Tests ---

describe('streamPng', () => {
  it('decodes a 1x1 red RGBA PNG', async () => {
    const pixels = new Uint8Array([255, 0, 0, 255]);
    const png = await buildPng(1, 1, pixels);

    let receivedHeader = null;
    const rows = [];
    let ended = false;

    await streamPng(
      arrayToStream(png),
      (header) => { receivedHeader = header; },
      (rowIdx, rgba) => { rows.push({ rowIdx, rgba: new Uint8Array(rgba) }); },
      () => { ended = true; }
    );

    assert.ok(receivedHeader);
    assert.equal(receivedHeader.width, 1);
    assert.equal(receivedHeader.height, 1);
    assert.equal(receivedHeader.colorType, 6);
    assert.equal(receivedHeader.bitDepth, 8);

    assert.equal(rows.length, 1);
    assert.equal(rows[0].rowIdx, 0);
    assert.deepEqual(Array.from(rows[0].rgba), [255, 0, 0, 255]);

    assert.ok(ended);
  });

  it('decodes a 2x2 image with varying pixel values', async () => {
    const pixels = new Uint8Array([
      255, 0,   0,   255,  // red
      0,   255, 0,   255,  // green
      0,   0,   255, 255,  // blue
      255, 255, 0,   255,  // yellow
    ]);
    const png = await buildPng(2, 2, pixels);

    const rows = [];
    await streamPng(
      arrayToStream(png),
      () => {},
      (rowIdx, rgba) => { rows.push({ rowIdx, rgba: new Uint8Array(rgba) }); },
      () => {}
    );

    assert.equal(rows.length, 2);
    assert.deepEqual(Array.from(rows[0].rgba), [255, 0, 0, 255, 0, 255, 0, 255]);
    assert.deepEqual(Array.from(rows[1].rgba), [0, 0, 255, 255, 255, 255, 0, 255]);
  });

  it('decodes an RGB (colorType 2) PNG, adding alpha=255', async () => {
    const pixels = new Uint8Array([
      128, 64, 32, 255, // the builder will strip alpha for colorType 2
    ]);
    const png = await buildPng(1, 1, pixels, { colorType: 2 });

    const rows = [];
    await streamPng(
      arrayToStream(png),
      () => {},
      (rowIdx, rgba) => { rows.push(new Uint8Array(rgba)); },
      () => {}
    );

    assert.equal(rows.length, 1);
    assert.deepEqual(Array.from(rows[0]), [128, 64, 32, 255]);
  });

  it('decodes a greyscale (colorType 0) PNG', async () => {
    const pixels = new Uint8Array([
      100, 0, 0, 255,
      200, 0, 0, 255,
    ]);
    const png = await buildPng(2, 1, pixels, { colorType: 0 });

    const rows = [];
    await streamPng(
      arrayToStream(png),
      () => {},
      (rowIdx, rgba) => { rows.push(new Uint8Array(rgba)); },
      () => {}
    );

    assert.equal(rows.length, 1);
    // Greyscale 100 -> RGBA (100,100,100,255)
    assert.deepEqual(Array.from(rows[0]), [100, 100, 100, 255, 200, 200, 200, 255]);
  });

  it('decodes a greyscale+alpha (colorType 4) PNG', async () => {
    const pixels = new Uint8Array([
      150, 0, 0, 128, // grey=150, alpha=128
    ]);
    const png = await buildPng(1, 1, pixels, { colorType: 4 });

    const rows = [];
    await streamPng(
      arrayToStream(png),
      () => {},
      (rowIdx, rgba) => { rows.push(new Uint8Array(rgba)); },
      () => {}
    );

    assert.equal(rows.length, 1);
    assert.deepEqual(Array.from(rows[0]), [150, 150, 150, 128]);
  });

  it('handles stream delivered in small chunks', async () => {
    const pixels = new Uint8Array([
      10, 20, 30, 255,
      40, 50, 60, 255,
      70, 80, 90, 255,
      100, 110, 120, 255,
    ]);
    const png = await buildPng(2, 2, pixels);

    // Deliver in 7-byte chunks to stress the pending buffer logic
    const rows = [];
    await streamPng(
      arrayToStream(png, 7),
      () => {},
      (rowIdx, rgba) => { rows.push({ rowIdx, rgba: new Uint8Array(rgba) }); },
      () => {}
    );

    assert.equal(rows.length, 2);
    assert.deepEqual(Array.from(rows[0].rgba), [10, 20, 30, 255, 40, 50, 60, 255]);
    assert.deepEqual(Array.from(rows[1].rgba), [70, 80, 90, 255, 100, 110, 120, 255]);
  });

  it('handles stream delivered one byte at a time', async () => {
    const pixels = new Uint8Array([255, 128, 64, 200]);
    const png = await buildPng(1, 1, pixels);

    const rows = [];
    await streamPng(
      arrayToStream(png, 1),
      () => {},
      (rowIdx, rgba) => { rows.push(new Uint8Array(rgba)); },
      () => {}
    );

    assert.equal(rows.length, 1);
    assert.deepEqual(Array.from(rows[0]), [255, 128, 64, 200]);
  });

  it('decodes a larger image (10x10) correctly', async () => {
    const w = 10, h = 10;
    const pixels = new Uint8Array(w * h * 4);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        pixels[i]     = x * 25;     // R
        pixels[i + 1] = y * 25;     // G
        pixels[i + 2] = (x + y) * 12; // B
        pixels[i + 3] = 255;
      }
    }
    const png = await buildPng(w, h, pixels);

    const rows = [];
    await streamPng(
      arrayToStream(png),
      () => {},
      (rowIdx, rgba) => { rows.push({ rowIdx, rgba: new Uint8Array(rgba) }); },
      () => {}
    );

    assert.equal(rows.length, h);
    // Check first pixel of row 5
    const row5 = rows[5].rgba;
    assert.equal(row5[0], 0);        // x=0, R=0*25=0
    assert.equal(row5[1], 125);      // y=5, G=5*25=125
    assert.equal(row5[2], 60);       // B=(0+5)*12=60
    assert.equal(row5[3], 255);
  });

  it('calls onProgress with byte counts', async () => {
    const pixels = new Uint8Array([255, 0, 0, 255]);
    const png = await buildPng(1, 1, pixels);

    const progressValues = [];
    await streamPng(
      arrayToStream(png, 10),
      () => {},
      () => {},
      () => {},
      { onProgress: (bytes) => { progressValues.push(bytes); } }
    );

    assert.ok(progressValues.length > 0);
    // Last progress value should equal total file size
    assert.equal(progressValues[progressValues.length - 1], png.length);
  });

  it('reports correct header fields for RGBA', async () => {
    const pixels = new Uint8Array(4 * 3 * 4); // 4x3 image
    const png = await buildPng(4, 3, pixels);

    let header = null;
    await streamPng(
      arrayToStream(png),
      (h) => { header = h; },
      () => {},
      () => {}
    );

    assert.equal(header.width, 4);
    assert.equal(header.height, 3);
    assert.equal(header.bitDepth, 8);
    assert.equal(header.colorType, 6);
    assert.equal(header.channels, 4);
    assert.equal(header.bytesPerPixel, 4);
    assert.equal(header.stride, 16); // 4 * 4
  });

  it('handles PNG filter type Sub (filter=1)', async () => {
    // Manually construct scanlines with Sub filter
    // For Sub filter: each byte = original - left_byte
    // Row: pixels [100, 0, 0, 255, 200, 0, 0, 255] (2px RGBA)
    // Sub-filtered: filter=1, then:
    //   byte[0..3] = [100, 0, 0, 255] (no left neighbor)
    //   byte[4..7] = [200-100, 0-0, 0-0, 255-255] = [100, 0, 0, 0]
    const rawScanlines = new Uint8Array([
      1, // filter type = Sub
      100, 0, 0, 255,   // first pixel (no left)
      100, 0, 0, 0,     // delta from left
    ]);
    const png = await buildPng(2, 1, null, { colorType: 6, rawData: rawScanlines });

    const rows = [];
    await streamPng(
      arrayToStream(png),
      () => {},
      (rowIdx, rgba) => { rows.push(new Uint8Array(rgba)); },
      () => {}
    );

    assert.equal(rows.length, 1);
    assert.deepEqual(Array.from(rows[0]), [100, 0, 0, 255, 200, 0, 0, 255]);
  });

  it('handles PNG filter type Up (filter=2) across rows', async () => {
    // Row 0: filter=0 (None), pixels [50, 100, 150, 255]
    // Row 1: filter=2 (Up), deltas [10, 20, 30, 0]
    //   Result: [50+10, 100+20, 150+30, 255+0] = [60, 120, 180, 255]
    const rawScanlines = new Uint8Array([
      0, 50, 100, 150, 255,  // row 0: filter=None
      2, 10,  20,  30,   0,  // row 1: filter=Up
    ]);
    const png = await buildPng(1, 2, null, { colorType: 6, rawData: rawScanlines });

    const rows = [];
    await streamPng(
      arrayToStream(png),
      () => {},
      (rowIdx, rgba) => { rows.push(new Uint8Array(rgba)); },
      () => {}
    );

    assert.equal(rows.length, 2);
    assert.deepEqual(Array.from(rows[0].rgba || rows[0]), [50, 100, 150, 255]);
    assert.deepEqual(Array.from(rows[1].rgba || rows[1]), [60, 120, 180, 255]);
  });
});
