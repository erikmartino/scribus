// @ts-check

/**
 * Shared pixel-format conversion helpers.
 *
 * Converts decoded image rows from various channel layouts to RGBA 8-bit.
 * Used by png-stream, tiff-decoder, and jp2-decoder so that conversion
 * logic lives in one place.
 *
 * @module pixel-convert
 */

/**
 * Naive CMYK -> RGB: R = 255 * (1 - C/255) * (1 - K/255), etc.
 * No ICC profile support.
 *
 * @param {Uint8Array} src  - CMYK pixels (4 bytes per pixel)
 * @param {Uint8Array} dst  - RGBA output (4 bytes per pixel)
 * @param {number} width
 */
export function cmykRowToRGBA(src, dst, width) {
  for (let x = 0; x < width; x++) {
    const si = x * 4;
    const c = src[si] / 255;
    const m = src[si + 1] / 255;
    const y = src[si + 2] / 255;
    const k = src[si + 3] / 255;
    dst[si]     = (255 * (1 - c) * (1 - k) + 0.5) | 0;
    dst[si + 1] = (255 * (1 - m) * (1 - k) + 0.5) | 0;
    dst[si + 2] = (255 * (1 - y) * (1 - k) + 0.5) | 0;
    dst[si + 3] = 255;
  }
}

/**
 * Convert a row of decoded pixel data to RGBA 8-bit.
 *
 * @param {Uint8Array} src       - source pixel data for one row
 * @param {Uint8Array} dst       - RGBA output buffer (width * 4 bytes)
 * @param {number} width         - pixels per row
 * @param {number} numComponents - components per pixel in src (1-4)
 * @param {object} [opts]
 * @param {boolean} [opts.isCMYK]     - treat 4-component data as CMYK
 * @param {boolean} [opts.hasAlpha]    - last component is alpha (for 2-comp greyscale+alpha, or 4-comp RGBA)
 * @param {number}  [opts.bitDepth]    - 8 or 16 (default 8). 16-bit uses high byte.
 * @param {Uint8Array} [opts.palette]  - palette for indexed color (3 bytes per entry)
 * @param {Uint8Array} [opts.trns]     - transparency table for indexed color
 */
export function rowToRGBA(src, dst, width, numComponents, opts = {}) {
  const bitDepth = opts.bitDepth ?? 8;
  const is16 = bitDepth === 16;
  const step = is16 ? numComponents * 2 : numComponents;

  if (opts.isCMYK && numComponents === 4) {
    if (is16) {
      // 16-bit CMYK: take high bytes, then convert
      const tmp = new Uint8Array(width * 4);
      for (let x = 0; x < width; x++) {
        const s = x * 8;
        tmp[x * 4]     = src[s];
        tmp[x * 4 + 1] = src[s + 2];
        tmp[x * 4 + 2] = src[s + 4];
        tmp[x * 4 + 3] = src[s + 6];
      }
      cmykRowToRGBA(tmp, dst, width);
    } else {
      cmykRowToRGBA(src, dst, width);
    }
    return;
  }

  if (opts.palette && numComponents === 1) {
    // Indexed color
    for (let x = 0; x < width; x++) {
      const idx = src[x];
      dst[x * 4]     = opts.palette[idx * 3];
      dst[x * 4 + 1] = opts.palette[idx * 3 + 1];
      dst[x * 4 + 2] = opts.palette[idx * 3 + 2];
      dst[x * 4 + 3] = opts.trns && idx < opts.trns.length ? opts.trns[idx] : 255;
    }
    return;
  }

  for (let x = 0; x < width; x++) {
    const si = x * step;
    const di = x * 4;

    if (numComponents === 4) {
      // RGBA
      if (is16) {
        dst[di]     = src[si];
        dst[di + 1] = src[si + 2];
        dst[di + 2] = src[si + 4];
        dst[di + 3] = src[si + 6];
      } else {
        dst[di]     = src[si];
        dst[di + 1] = src[si + 1];
        dst[di + 2] = src[si + 2];
        dst[di + 3] = src[si + 3];
      }
    } else if (numComponents === 3) {
      // RGB -> RGBA
      if (is16) {
        dst[di]     = src[si];
        dst[di + 1] = src[si + 2];
        dst[di + 2] = src[si + 4];
      } else {
        dst[di]     = src[si];
        dst[di + 1] = src[si + 1];
        dst[di + 2] = src[si + 2];
      }
      dst[di + 3] = 255;
    } else if (numComponents === 2) {
      // Greyscale + Alpha
      if (is16) {
        const v = src[si];
        dst[di]     = v;
        dst[di + 1] = v;
        dst[di + 2] = v;
        dst[di + 3] = src[si + 2];
      } else {
        const v = src[si];
        dst[di]     = v;
        dst[di + 1] = v;
        dst[di + 2] = v;
        dst[di + 3] = src[si + 1];
      }
    } else if (numComponents === 1) {
      // Greyscale
      if (is16) {
        const v = src[si];
        dst[di]     = v;
        dst[di + 1] = v;
        dst[di + 2] = v;
      } else {
        const v = src[si];
        dst[di]     = v;
        dst[di + 1] = v;
        dst[di + 2] = v;
      }
      dst[di + 3] = 255;
    }
  }
}

/**
 * Determine the best interpretation for decoded pixel data.
 *
 * JPEG2000 and some raw decoders report only a component count with no
 * explicit color space. This helper disambiguates based on available metadata.
 *
 * @param {number} numComponents
 * @param {object} [meta]
 * @param {string} [meta.colorSpace] - e.g. 'sRGB', 'CMYK', 'greyscale', 'YCbCr'
 * @returns {{ isCMYK: boolean, hasAlpha: boolean, displayComponents: number }}
 */
export function interpretComponents(numComponents, meta = {}) {
  const cs = (meta.colorSpace || '').toLowerCase();

  if (numComponents === 4) {
    // Only treat as CMYK if explicitly tagged
    if (cs === 'cmyk' || cs === 'ycck') {
      return { isCMYK: true, hasAlpha: false, displayComponents: 4 };
    }
    // Default: RGBA
    return { isCMYK: false, hasAlpha: true, displayComponents: 4 };
  }

  if (numComponents === 3) {
    return { isCMYK: false, hasAlpha: false, displayComponents: 3 };
  }

  if (numComponents === 2) {
    return { isCMYK: false, hasAlpha: true, displayComponents: 2 };
  }

  // 1 component = greyscale
  return { isCMYK: false, hasAlpha: false, displayComponents: 1 };
}
