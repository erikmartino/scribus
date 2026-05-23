// @ts-check

/**
 * Minimal streaming PNG decoder using browser built-in DecompressionStream.
 * Parses PNG chunks from fetch stream, decompresses IDAT data, reconstructs
 * and unfilters scanlines — never holding the full image in memory.
 *
 * @module png-stream
 */

import { rowToRGBA } from './pixel-convert.js';

/** @typedef {{ width: number, height: number, bitDepth: number, colorType: number, channels: number, bytesPerPixel: number, stride: number }} PngHeader */
/** @typedef {(header: PngHeader) => void} OnHeader */
/** @typedef {(rowIndex: number, rgba: Uint8Array) => void} OnRow */
/** @typedef {() => void} OnEnd */

const PNG_SIGNATURE = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);

/**
 * Parse a 4-byte big-endian unsigned integer from a buffer.
 * @param {Uint8Array} buf
 * @param {number} offset
 * @returns {number}
 */
function readU32(buf, offset) {
  return (
    ((buf[offset] << 24) |
      (buf[offset + 1] << 16) |
      (buf[offset + 2] << 8) |
      buf[offset + 3]) >>>
    0
  );
}

/**
 * Paeth predictor used in PNG filter type 4.
 * @param {number} a - left
 * @param {number} b - above
 * @param {number} c - upper-left
 * @returns {number}
 */
function paethPredictor(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

/**
 * Channels for each PNG color type.
 * @param {number} colorType
 * @returns {number}
 */
function channelsForColorType(colorType) {
  switch (colorType) {
    case 0:
      return 1; // greyscale
    case 2:
      return 3; // RGB
    case 3:
      return 1; // indexed
    case 4:
      return 2; // greyscale + alpha
    case 6:
      return 4; // RGBA
    default:
      throw new Error(`Unsupported PNG color type: ${colorType}`);
  }
}

/**
 * Stream-download a PNG and emit decoded scanlines one at a time.
 * Peak memory: ~2 scanlines + fetch buffer.
 *
 * @param {string | ReadableStream<Uint8Array>} source - URL or ReadableStream
 * @param {OnHeader} onHeader - called once when IHDR is parsed
 * @param {OnRow} onRow - called for each decoded scanline (RGBA)
 * @param {OnEnd} onEnd - called when the image is fully decoded
 * @param {{ signal?: AbortSignal, onProgress?: (bytes: number) => void }} [opts]
 */
export async function streamPng(source, onHeader, onRow, onEnd, opts = {}) {
  /** @type {ReadableStream<Uint8Array>} */
  let stream;
  if (typeof source === 'string') {
    const response = await fetch(source, { signal: opts.signal });
    if (!response.ok) throw new Error(`Fetch failed: ${response.status}`);
    if (!response.body) throw new Error('ReadableStream not supported');
    stream = response.body;
  } else {
    stream = source;
  }

  const reader = stream.getReader();

  /** @type {PngHeader | null} */
  let header = null;

  // Chunk-level parser state
  /** @type {Uint8Array[]} */
  const pending = [];
  let pendingLen = 0;
  let signatureChecked = false;

  // IDAT decompression pipeline
  /** @type {WritableStreamDefaultWriter<Uint8Array> | null} */
  let deflateWriter = null;
  /** @type {ReadableStreamDefaultReader<Uint8Array> | null} */
  let inflateReader = null;
  /** @type {Promise<void> | null} */
  let drainPromise = null;

  // Scanline reconstruction state
  let currentRow = 0;
  /** @type {Uint8Array | null} */
  let prevRowRaw = null; // previous raw (unfiltered) scanline for filter reference
  /** @type {Uint8Array | null} */
  let rowBuf = null; // accumulates bytes for current scanline (1 filter byte + stride)
  let rowBufPos = 0;
  /** @type {Uint8Array | null} */
  let rgbaBuf = null; // output RGBA row
  /** @type {Uint8Array | null} */
  let palette = null;
  /** @type {Uint8Array | null} */
  let trns = null;

  let totalBytes = 0;

  /**
   * Append data to the pending buffer.
   * @param {Uint8Array} chunk
   */
  function pushPending(chunk) {
    pending.push(chunk);
    pendingLen += chunk.length;
  }

  /**
   * Consume exactly `n` bytes from pending, or return null if not enough.
   * @param {number} n
   * @returns {Uint8Array | null}
   */
  function consumePending(n) {
    if (pendingLen < n) return null;
    const out = new Uint8Array(n);
    let written = 0;
    while (written < n) {
      const front = pending[0];
      const need = n - written;
      if (front.length <= need) {
        out.set(front, written);
        written += front.length;
        pendingLen -= front.length;
        pending.shift();
      } else {
        out.set(front.subarray(0, need), written);
        pending[0] = front.subarray(need);
        pendingLen -= need;
        written += need;
      }
    }
    return out;
  }

  /**
   * Set up the decompression pipeline (DecompressionStream for raw deflate).
   */
  function initDecompression() {
    const ds = new DecompressionStream('deflate');
    deflateWriter = ds.writable.getWriter();
    inflateReader = ds.readable.getReader();
    drainPromise = drainInflated();
  }

  /**
   * Continuously read decompressed bytes and feed them into scanline reconstruction.
   */
  async function drainInflated() {
    if (!inflateReader || !header) return;
    try {
      while (true) {
        const { value, done } = await inflateReader.read();
        if (done) break;
        if (value) processScanlineBytes(value);
      }
    } catch {
      // stream closed or aborted
    }
  }

  /**
   * Feed raw decompressed bytes into scanline reconstruction.
   * @param {Uint8Array} data
   */
  function processScanlineBytes(data) {
    if (!header || !rowBuf || !rgbaBuf) return;
    const scanlineLen = 1 + header.stride; // 1 filter byte + pixel data
    let offset = 0;

    while (offset < data.length) {
      const space = scanlineLen - rowBufPos;
      const available = data.length - offset;
      const take = Math.min(space, available);
      rowBuf.set(data.subarray(offset, offset + take), rowBufPos);
      rowBufPos += take;
      offset += take;

      if (rowBufPos === scanlineLen) {
        unfilterAndEmit();
        rowBufPos = 0;
      }
    }
  }

  /**
   * Unfilter the current scanline and emit it as RGBA.
   */
  function unfilterAndEmit() {
    if (!header || !rowBuf || !rgbaBuf || !prevRowRaw) return;
    const filterType = rowBuf[0];
    const raw = rowBuf.subarray(1);
    const bpp = header.bytesPerPixel;
    const stride = header.stride;

    // Unfilter in place on `raw`
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? raw[i - bpp] : 0;
      const b = prevRowRaw[i];
      const c = i >= bpp ? prevRowRaw[i - bpp] : 0;

      switch (filterType) {
        case 0:
          break; // None
        case 1:
          raw[i] = (raw[i] + a) & 0xff;
          break; // Sub
        case 2:
          raw[i] = (raw[i] + b) & 0xff;
          break; // Up
        case 3:
          raw[i] = (raw[i] + ((a + b) >>> 1)) & 0xff;
          break; // Average
        case 4:
          raw[i] = (raw[i] + paethPredictor(a, b, c)) & 0xff;
          break; // Paeth
        default:
          throw new Error(`Unknown PNG filter type: ${filterType}`);
      }
    }

    // Save unfiltered row for next row's filter reference
    prevRowRaw.set(raw);

    // Convert to RGBA via shared pixel-convert module
    const w = header.width;
    const convertOpts = {
      bitDepth: header.bitDepth,
      palette: header.colorType === 3 ? palette : undefined,
      trns: header.colorType === 3 ? trns : undefined,
    };
    rowToRGBA(raw, rgbaBuf, w, header.channels, convertOpts);

    onRow(currentRow, rgbaBuf);
    currentRow++;
  }

  /**
   * Parse PNG chunks from pending data.
   */
  async function parseChunks() {
    // Check signature first
    if (!signatureChecked) {
      const sig = consumePending(8);
      if (!sig) return;
      for (let i = 0; i < 8; i++) {
        if (sig[i] !== PNG_SIGNATURE[i]) {
          throw new Error('Not a valid PNG file');
        }
      }
      signatureChecked = true;
    }

    // Parse chunks
    while (pendingLen >= 8) {
      // Peek at length + type (8 bytes)
      const headerBytes = consumePending(8);
      if (!headerBytes) return;
      const chunkLen = readU32(headerBytes, 0);
      const chunkType = String.fromCharCode(
        headerBytes[4],
        headerBytes[5],
        headerBytes[6],
        headerBytes[7]
      );

      // Wait for chunk data + CRC (4 bytes)
      const needed = chunkLen + 4;
      // We need to read the rest of this chunk
      while (pendingLen < needed) {
        // Need more data — put header back and return
        // Actually we already consumed header, so we need to wait for body
        const { value, done } = await reader.read();
        if (done) throw new Error(`Unexpected end of PNG in chunk ${chunkType}`);
        if (value) {
          totalBytes += value.length;
          if (opts.onProgress) opts.onProgress(totalBytes);
          pushPending(value);
        }
      }

      const body = consumePending(chunkLen);
      consumePending(4); // CRC — skip validation for speed

      if (chunkType === 'IHDR' && body) {
        const width = readU32(body, 0);
        const height = readU32(body, 4);
        const bitDepth = body[8];
        const colorType = body[9];
        if (bitDepth !== 8 && bitDepth !== 16) {
          throw new Error(`Only 8-bit and 16-bit PNGs supported (got ${bitDepth}-bit)`);
        }
        const channels = channelsForColorType(colorType);
        const bytesPerPixel = channels * (bitDepth / 8);
        const stride = width * bytesPerPixel;
        header = { width, height, bitDepth, colorType, channels, bytesPerPixel, stride };

        // Allocate scanline buffers
        rowBuf = new Uint8Array(1 + stride);
        prevRowRaw = new Uint8Array(stride);
        rgbaBuf = new Uint8Array(width * 4);

        initDecompression();
        onHeader(header);
      } else if (chunkType === 'PLTE' && body) {
        palette = body;
      } else if (chunkType === 'tRNS' && body) {
        trns = body;
      } else if (chunkType === 'IDAT' && body && deflateWriter) {
        await deflateWriter.write(body);
      } else if (chunkType === 'IEND') {
        if (deflateWriter) {
          await deflateWriter.close();
        }
        return;
      }
    }
  }

  // Main read loop
  while (true) {
    const { value, done } = await reader.read();
    if (value) {
      totalBytes += value.length;
      if (opts.onProgress) opts.onProgress(totalBytes);
      pushPending(value);
    }
    await parseChunks();
    if (done) break;
  }

  // Wait for all decompressed data to be processed
  if (drainPromise) await drainPromise;
  onEnd();
}
