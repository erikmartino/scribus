// @ts-check

/**
 * Minimal TIFF IFD parser — extracts metadata, raw strip data,
 * and embedded ICC profile.
 *
 * @module tiff-parse
 */

const TAG = {
  ImageWidth: 256,
  ImageLength: 257,
  BitsPerSample: 258,
  Compression: 259,
  Photometric: 262,
  StripOffsets: 273,
  SamplesPerPixel: 277,
  RowsPerStrip: 278,
  StripByteCounts: 279,
  JPEGTables: 347,
  ICCProfile: 34675,
};

const COMP_NONE = 1;
const COMP_CCITT_G3 = 3;
const COMP_CCITT_G4 = 4;
const COMP_JPEG = 7;
const COMP_DEFLATE = 8;
const COMP_DEFLATE2 = 32946;

/** Human-readable compression names */
const COMP_NAMES = {
  [COMP_NONE]: 'Uncompressed',
  2: 'CCITT Group 3 (1D)',
  [COMP_CCITT_G3]: 'CCITT T.4',
  [COMP_CCITT_G4]: 'CCITT T.6 (Group 4)',
  5: 'LZW',
  6: 'Old-style JPEG',
  [COMP_JPEG]: 'JPEG',
  [COMP_DEFLATE]: 'Deflate',
  [COMP_DEFLATE2]: 'Deflate',
  32773: 'PackBits',
};

/**
 * Derive the number of color components from an ICC profile header.
 * Returns 0 if the profile is too short or unrecognized.
 *
 * @param {Uint8Array} profile
 * @returns {number}
 */
function iccComponents(profile) {
  if (profile.length < 20) return 0;
  // Bytes 16-19: color space signature (big-endian ASCII)
  const sig = String.fromCharCode(profile[16], profile[17], profile[18], profile[19]);
  switch (sig) {
    case 'RGB ': return 3;
    case 'CMYK': return 4;
    case 'GRAY': return 1;
    case 'Lab ': return 3;
    case 'YCbr': return 3;
    default: return 0;
  }
}

/**
 * @typedef {Object} TiffInfo
 * @property {number} width
 * @property {number} height
 * @property {number} compression
 * @property {string} compressionName
 * @property {number} photometric
 * @property {number[]} bitsPerSample
 * @property {number} samplesPerPixel
 * @property {boolean} canPassthrough  - true if we can embed raw data directly in PDF
 * @property {string} pdfFilter        - PDF filter name for passthrough
 * @property {string} pdfColorSpace    - PDF color space name (fallback when no ICC)
 * @property {Uint8Array|null} imageData - raw compressed data for passthrough
 * @property {Object|null} ccittParams  - CCITT parameters if applicable
 * @property {Uint8Array|null} iccProfile - embedded ICC profile bytes
 * @property {number} iccN              - number of ICC color components (0 if none)
 */

/**
 * Parse a TIFF buffer and extract metadata + raw image data when passthrough is possible.
 *
 * @param {ArrayBuffer} buffer
 * @returns {TiffInfo}
 */
export function parseTiff(buffer) {
  const bytes = new Uint8Array(buffer);
  const view = new DataView(buffer);
  const le = bytes[0] === 0x49; // 'II' = little-endian

  const read16 = (off) => view.getUint16(off, le);
  const read32 = (off) => view.getUint32(off, le);

  if (read16(2) !== 42) throw new Error('Not a TIFF file');

  const ifdOffset = read32(4);
  const numEntries = read16(ifdOffset);
  const tags = new Map();

  for (let i = 0; i < numEntries; i++) {
    const e = ifdOffset + 2 + i * 12;
    const tag = read16(e);
    const type = read16(e + 2);
    const count = read32(e + 4);
    const typeSizes = [0, 1, 1, 2, 4, 8, 1, 1, 2, 4, 8, 4, 8];
    const tSize = typeSizes[type] || 1;
    const totalSize = tSize * count;
    const valOff = totalSize <= 4 ? e + 8 : read32(e + 8);

    tags.set(tag, { type, count, offset: valOff });
  }

  /** Read a single numeric value from a tag */
  function readOne(tagId, fallback = 0) {
    const t = tags.get(tagId);
    if (!t) return fallback;
    if (t.type === 3) return read16(t.offset);
    if (t.type === 4) return read32(t.offset);
    if (t.type === 1) return bytes[t.offset];
    return read32(t.offset);
  }

  /** Read an array of SHORT or LONG values */
  function readArray(tagId) {
    const t = tags.get(tagId);
    if (!t) return [];
    const result = [];
    for (let i = 0; i < t.count; i++) {
      if (t.type === 3) result.push(read16(t.offset + i * 2));
      else result.push(read32(t.offset + i * 4));
    }
    return result;
  }

  const width = readOne(TAG.ImageWidth);
  const height = readOne(TAG.ImageLength);
  const compression = readOne(TAG.Compression, 1);
  const photometric = readOne(TAG.Photometric, 2);
  const samplesPerPixel = readOne(TAG.SamplesPerPixel, 1);
  const bitsPerSample = readArray(TAG.BitsPerSample);
  if (bitsPerSample.length === 0) bitsPerSample.push(8);

  const stripOffsets = readArray(TAG.StripOffsets);
  const stripByteCounts = readArray(TAG.StripByteCounts);

  const compressionName = COMP_NAMES[compression] || `Unknown (${compression})`;

  // --- ICC profile (tag 34675) ---
  /** @type {Uint8Array|null} */
  let iccProfile = null;
  let iccN = 0;
  const iccTag = tags.get(TAG.ICCProfile);
  if (iccTag && iccTag.count > 0) {
    iccProfile = new Uint8Array(buffer, iccTag.offset, iccTag.count);
    iccN = iccComponents(iccProfile);
  }

  // Determine fallback PDF color space from photometric interpretation
  // (used when no ICC profile is available)
  let pdfColorSpace = '/DeviceRGB';
  if (photometric === 0 || photometric === 1) pdfColorSpace = '/DeviceGray';
  else if (photometric === 5) pdfColorSpace = '/DeviceCMYK';
  else if (photometric === 6) pdfColorSpace = '/DeviceRGB'; // YCbCr JPEG → RGB after DCT

  // --- Try passthrough ---

  let canPassthrough = false;
  let pdfFilter = '';
  /** @type {Uint8Array|null} */
  let imageData = null;
  /** @type {Object|null} */
  let ccittParams = null;

  if (compression === COMP_JPEG && stripOffsets.length > 0) {
    // JPEG-in-TIFF: each strip is a standalone JPEG (compression 7).
    // For single-strip images we can embed directly.
    // For multi-strip, concatenation is not valid JPEG — fall through.
    if (stripOffsets.length === 1) {
      let stripData = new Uint8Array(buffer, stripOffsets[0], stripByteCounts[0]);

      // Merge JPEGTables if present
      const jt = tags.get(TAG.JPEGTables);
      if (jt && jt.count > 4) {
        const tables = new Uint8Array(buffer, jt.offset, jt.count);
        // tables: FFD8 <markers> FFD9 — strip: FFD8 <SOF/SOS+data> FFD9
        // merged: FFD8 <markers from tables> <rest of strip after SOI>
        const merged = new Uint8Array(tables.length - 2 + stripData.length - 2);
        merged.set(tables.subarray(0, tables.length - 2), 0);           // tables without trailing FFD9
        merged.set(stripData.subarray(2), tables.length - 2);           // strip without leading FFD8
        stripData = merged;
      }

      canPassthrough = true;
      pdfFilter = '/DCTDecode';
      imageData = stripData;
    }
  } else if (compression === COMP_CCITT_G4 && stripOffsets.length > 0) {
    // CCITT Group 4 — strips can be concatenated (sequential bilevel rows)
    const totalLen = stripByteCounts.reduce((s, n) => s + n, 0);
    const merged = new Uint8Array(totalLen);
    let off = 0;
    for (let i = 0; i < stripOffsets.length; i++) {
      merged.set(new Uint8Array(buffer, stripOffsets[i], stripByteCounts[i]), off);
      off += stripByteCounts[i];
    }

    canPassthrough = true;
    pdfFilter = '/CCITTFaxDecode';
    pdfColorSpace = '/DeviceGray';
    imageData = merged;
    ccittParams = {
      K: -1,  // Group 4
      Columns: width,
      Rows: height,
      BlackIs1: photometric === 0,
    };
  }

  return {
    width,
    height,
    compression,
    compressionName,
    photometric,
    bitsPerSample,
    samplesPerPixel,
    canPassthrough,
    pdfFilter,
    pdfColorSpace,
    imageData,
    ccittParams,
    iccProfile,
    iccN,
  };
}
