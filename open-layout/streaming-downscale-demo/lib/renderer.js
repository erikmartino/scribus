// @ts-check

/**
 * Progressive canvas renderer. Batches output rows and flushes them
 * to the canvas in a single putImageData call for better performance.
 *
 * @module renderer
 */

const BATCH_SIZE = 32;

/**
 * @typedef {Object} Renderer
 * @property {(rowIndex: number, rgba: Uint8Array) => void} drawRow
 * @property {() => void} flush
 * @property {(x: number, y: number, rgba: Uint8Array, w: number, h: number) => void} drawTile
 */

/**
 * Create a progressive renderer that batches rows before drawing.
 *
 * @param {HTMLCanvasElement} canvas
 * @param {number} outWidth - output image width
 * @param {number} outHeight - output image height
 * @returns {Renderer}
 */
export function createRenderer(canvas, outWidth, outHeight) {
  canvas.width = outWidth;
  canvas.height = outHeight;
  const ctx = canvas.getContext('2d', { willReadFrequently: false });
  if (!ctx) {
    throw new Error('2D canvas context is not available');
  }
  ctx.clearRect(0, 0, outWidth, outHeight);

  const rowBytes = outWidth * 4;
  const imgData = ctx.createImageData(outWidth, BATCH_SIZE);
  let batchStart = -1;
  let batchCount = 0;

  /**
   * Flush accumulated rows to the canvas.
   */
  function flush() {
    if (batchCount === 0) return;
    if (batchCount === BATCH_SIZE) {
      ctx.putImageData(imgData, 0, batchStart);
    } else {
      // Partial batch — create a correctly-sized ImageData
      const partial = ctx.createImageData(outWidth, batchCount);
      partial.data.set(imgData.data.subarray(0, batchCount * rowBytes));
      ctx.putImageData(partial, 0, batchStart);
    }
    batchCount = 0;
    batchStart = -1;
  }

  /**
   * Queue a single output row. Flushes automatically when the batch
   * is full or when a non-contiguous row arrives.
   *
   * @param {number} rowIndex - row position (0-based from top)
   * @param {Uint8Array} rgba - RGBA pixel data for this row
   */
  function drawRow(rowIndex, rgba) {
    // Flush if this row doesn't continue the current batch
    if (batchCount > 0 && rowIndex !== batchStart + batchCount) {
      flush();
    }
    if (batchCount === 0) {
      batchStart = rowIndex;
    }
    imgData.data.set(rgba.subarray(0, rowBytes), batchCount * rowBytes);
    batchCount++;
    if (batchCount === BATCH_SIZE) {
      flush();
    }
  }

  /**
   * Draw a pre-downscaled tile at a given canvas position.
   *
   * @param {number} x - canvas X offset
   * @param {number} y - canvas Y offset
   * @param {Uint8Array} rgba - RGBA pixel data for the tile
   * @param {number} w - tile width in pixels
   * @param {number} h - tile height in pixels
   */
  function drawTile(x, y, rgba, w, h) {
    flush(); // flush any pending row batch first
    const tileImg = ctx.createImageData(w, h);
    tileImg.data.set(rgba.subarray(0, w * h * 4));
    ctx.putImageData(tileImg, x, y);
  }

  return { drawRow, flush, drawTile };
}
