// @ts-check

/**
 * CMYK -> RGB color conversion.
 *
 * This module now delegates to the shared pixel-convert module.
 * Kept for backward compatibility with existing imports.
 *
 * @module color-management
 */

import { cmykRowToRGBA } from './pixel-convert.js';

/**
 * @typedef {Object} ColorManager
 * @property {(cmykRow: Uint8Array, width: number) => Uint8Array} transformRow
 */

/**
 * Create a color manager for CMYK -> RGB conversion.
 *
 * @returns {ColorManager}
 */
export function createColorManager() {
  return {
    transformRow(cmykRow, width) {
      const rgba = new Uint8Array(width * 4);
      cmykRowToRGBA(cmykRow, rgba, width);
      return rgba;
    }
  };
}
