// @ts-check

/**
 * Streaming box-filter downscaler.
 * Accumulates N source rows, averages them both vertically and horizontally
 * to produce a single output row, then discards the source data.
 *
 * @module downscaler
 */

/**
 * @typedef {Object} Downscaler
 * @property {(rowIndex: number, rgba: Uint8Array) => void} pushRow
 * @property {number} outWidth
 * @property {number} outHeight
 */

/**
 * Create a streaming downscaler that box-filter averages NxN source pixels
 * into one output pixel.
 *
 * **Shared buffer contract:** The `rgba` buffer passed to `onOutputRow` is
 * reused across calls. Consumers must copy the data (e.g. via
 * `new Uint8Array(rgba)`) if they need to retain it beyond the callback.
 *
 * @param {number} srcWidth - source image width in pixels
 * @param {number} srcHeight - source image height in pixels
 * @param {number} scale - downscale factor (e.g. 4 means 4x smaller)
 * @param {(outRowIndex: number, rgba: Uint8Array) => void} onOutputRow - called for each output row; buffer is reused
 * @returns {Downscaler}
 */
export function createDownscaler(srcWidth, srcHeight, scale, onOutputRow) {
  const outWidth = Math.floor(srcWidth / scale);
  const outHeight = Math.floor(srcHeight / scale);

  // Accumulator: stores running sums for the current output row.
  // For each output pixel we sum R, G, B, A across (scale x scale) source pixels.
  // Using Float64Array to avoid overflow.
  const accum = new Float64Array(outWidth * 4);
  let rowsInBatch = 0;
  let outRowIndex = 0;

  // Reusable output buffer
  const outRow = new Uint8Array(outWidth * 4);

  /**
   * Push a single source scanline into the downscaler.
   *
   * @param {number} _rowIndex - source row index (unused, rows arrive in order)
   * @param {Uint8Array} rgba - RGBA pixel data for this row
   */
  function pushRow(_rowIndex, rgba) {
    if (outRowIndex >= outHeight) return;

    // Accumulate this row's contribution (horizontal sum)
    for (let ox = 0; ox < outWidth; ox++) {
      const srcXStart = ox * scale;
      const base = ox * 4;
      for (let dx = 0; dx < scale; dx++) {
        const si = (srcXStart + dx) * 4;
        accum[base] += rgba[si];
        accum[base + 1] += rgba[si + 1];
        accum[base + 2] += rgba[si + 2];
        accum[base + 3] += rgba[si + 3];
      }
    }

    rowsInBatch++;

    // When we've collected `scale` rows, emit one output row
    if (rowsInBatch === scale) {
      const totalPixels = scale * scale;
      for (let ox = 0; ox < outWidth; ox++) {
        const base = ox * 4;
        outRow[base] = (accum[base] / totalPixels + 0.5) | 0;
        outRow[base + 1] = (accum[base + 1] / totalPixels + 0.5) | 0;
        outRow[base + 2] = (accum[base + 2] / totalPixels + 0.5) | 0;
        outRow[base + 3] = (accum[base + 3] / totalPixels + 0.5) | 0;
      }

      onOutputRow(outRowIndex, outRow);
      outRowIndex++;

      // Reset accumulator
      accum.fill(0);
      rowsInBatch = 0;
    }
  }

  return { pushRow, outWidth, outHeight };
}
