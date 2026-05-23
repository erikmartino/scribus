// @ts-check

/**
 * Detect image format from the first bytes of a buffer.
 *
 * @module format-detect
 */

/**
 * Detect the image format from a header buffer (at least 8 bytes).
 *
 * @param {Uint8Array | ArrayBuffer} header - first bytes of the file
 * @returns {'png' | 'tiff' | 'jp2' | null}
 */
export function detectFormat(header) {
  const b = header instanceof Uint8Array ? header : new Uint8Array(header, 0, Math.min(header.byteLength, 12));

  if (b.length < 4) return null;

  // PNG: 137 80 78 71
  if (b[0] === 137 && b[1] === 80 && b[2] === 78 && b[3] === 71) {
    return 'png';
  }

  // TIFF: II (little-endian) or MM (big-endian)
  if ((b[0] === 73 && b[1] === 73) || (b[0] === 77 && b[1] === 77)) {
    return 'tiff';
  }

  // JPEG2000 JP2 box: 00 00 00 0C 6A 50
  if (b.length >= 6 &&
      b[0] === 0 && b[1] === 0 && b[2] === 0 && b[3] === 12 &&
      b[4] === 106 && b[5] === 80) {
    return 'jp2';
  }

  // JPEG2000 raw codestream: FF 4F FF 51
  if (b[0] === 255 && b[1] === 79 && b[2] === 255 && b[3] === 81) {
    return 'jp2';
  }

  return null;
}
