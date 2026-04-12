// @ts-check

/**
 * JPEG2000 decoder — decodes JP2/J2K files and emits rows.
 * Uses openjpeg WASM via CDN, with fallback error messaging.
 *
 * @module jp2-decoder
 */

import { createColorManager } from './color-management.js';

/**
 * @typedef {Object} Jp2Callbacks
 * @property {(header: { width: number, height: number }) => void} onHeader
 * @property {(rowIndex: number, rgba: Uint8Array) => void} onRow
 * @property {() => void} onEnd
 */

/**
 * Decode a JPEG2000 file and emit rows one at a time.
 *
 * @param {ArrayBuffer} buffer
 * @param {Jp2Callbacks} callbacks
 */
export async function decodeJp2(buffer, callbacks) {
  /** @type {any} */
  let openjpeg;
  try {
    openjpeg = await import('openjpeg');
  } catch {
    throw new Error(
      'JPEG2000 decoding requires openjpeg. ' +
      'Add it to the importmap or provide a WASM build URL.'
    );
  }

  const decoder = openjpeg.default ? openjpeg.default : openjpeg;

  // Initialize decoder — API varies by build
  let result;
  if (typeof decoder.decode === 'function') {
    result = decoder.decode(new Uint8Array(buffer));
  } else if (typeof decoder === 'function') {
    const instance = await decoder();
    result = instance.decode(new Uint8Array(buffer));
  } else {
    throw new Error('Unsupported openjpeg module format');
  }

  const width = result.width;
  const height = result.height;
  const numComps = result.numComps || result.components || result.nbChannels || 3;
  const pixelData = result.data instanceof Uint8Array
    ? result.data
    : new Uint8Array(result.data);

  callbacks.onHeader({ width, height });

  // Check if CMYK (4 components, no alpha indication)
  const isCMYK = numComps === 4;

  /** @type {import('./color-management.js').ColorManager | null} */
  let colorManager = null;
  if (isCMYK) {
    colorManager = createColorManager();
  }

  // Emit rows
  for (let y = 0; y < height; y++) {
    const rowStride = width * numComps;
    const rowStart = y * rowStride;
    const rowData = pixelData.subarray(rowStart, rowStart + rowStride);

    let rgba;
    if (isCMYK && colorManager) {
      rgba = colorManager.transformRow(rowData, width);
    } else if (numComps >= 3) {
      rgba = new Uint8Array(width * 4);
      for (let x = 0; x < width; x++) {
        const si = x * numComps;
        rgba[x * 4]     = rowData[si];
        rgba[x * 4 + 1] = rowData[si + 1];
        rgba[x * 4 + 2] = rowData[si + 2];
        rgba[x * 4 + 3] = numComps >= 4 ? rowData[si + 3] : 255;
      }
    } else {
      // Grayscale
      rgba = new Uint8Array(width * 4);
      for (let x = 0; x < width; x++) {
        const v = rowData[x * numComps];
        rgba[x * 4]     = v;
        rgba[x * 4 + 1] = v;
        rgba[x * 4 + 2] = v;
        rgba[x * 4 + 3] = numComps === 2 ? rowData[x * numComps + 1] : 255;
      }
    }

    callbacks.onRow(y, rgba);
  }

  callbacks.onEnd();
}
