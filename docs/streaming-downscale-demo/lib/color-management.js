// @ts-check

/**
 * Naive CMYK → RGB color conversion (no external dependencies).
 *
 * @module color-management
 */

/**
 * @typedef {Object} ColorManager
 * @property {(cmykRow: Uint8Array, width: number) => Uint8Array} transformRow
 */

/**
 * Naive CMYK → RGB: R = 255 * (1 - C/255) * (1 - K/255), etc.
 *
 * @param {Uint8Array} cmykRow - CMYK pixels (4 bytes per pixel)
 * @param {number} width
 * @returns {Uint8Array} RGBA pixels (4 bytes per pixel)
 */
function naiveTransformRow(cmykRow, width) {
  const rgba = new Uint8Array(width * 4);
  for (let x = 0; x < width; x++) {
    const si = x * 4;
    const c = cmykRow[si] / 255;
    const m = cmykRow[si + 1] / 255;
    const y = cmykRow[si + 2] / 255;
    const k = cmykRow[si + 3] / 255;
    rgba[si]     = (255 * (1 - c) * (1 - k) + 0.5) | 0;
    rgba[si + 1] = (255 * (1 - m) * (1 - k) + 0.5) | 0;
    rgba[si + 2] = (255 * (1 - y) * (1 - k) + 0.5) | 0;
    rgba[si + 3] = 255;
  }
  return rgba;
}

/**
 * Create a color manager for CMYK → RGB conversion.
 *
 * @returns {ColorManager}
 */
export function createColorManager() {
  return { transformRow: naiveTransformRow };
}
