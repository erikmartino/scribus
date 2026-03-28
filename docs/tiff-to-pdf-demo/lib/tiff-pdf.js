// @ts-check

/**
 * TIFF loading, preview (via wasm-vips) and PDF export.
 *
 * When the TIFF's compression is natively supported by PDF (JPEG, CCITT G4)
 * the compressed data is embedded unprocessed.  Otherwise wasm-vips decodes
 * to raw pixels and we deflate-compress them for the PDF.
 *
 * Embedded ICC profiles (TIFF tag 34675) are passed through to the PDF
 * as /ICCBased color spaces.
 *
 * @module tiff-pdf
 */

import { parseTiff } from './tiff-parse.js';
import { buildPdf } from './pdf-build.js';
import { srgbIcc } from './srgb-icc.js';

let vips = null;

/**
 * Initialize wasm-vips (cached after first call).
 */
export async function initVips() {
  if (vips) return;

  const vipsUrl = 'https://cdn.jsdelivr.net/npm/wasm-vips@0.0.17/lib/vips-es6.js';
  const Vips = (await import(vipsUrl)).default;

  const workerCode = `import "${vipsUrl}";`;
  const blob = new Blob([workerCode], { type: 'application/javascript' });
  const blobUrl = URL.createObjectURL(blob);

  vips = await Vips({
    mainScriptUrlOrBlob: blobUrl,
    locateFile: (fileName) => `https://cdn.jsdelivr.net/npm/wasm-vips@0.0.17/lib/${fileName}`
  });

  URL.revokeObjectURL(blobUrl);
}

/**
 * Load a TIFF buffer and return metadata (including passthrough info from the parser)
 * plus a vips image handle for preview.
 *
 * @param {ArrayBuffer} buffer
 */
export function loadTiff(buffer) {
  if (!vips) throw new Error('Call initVips() first');

  const parsed = parseTiff(buffer);
  const image = vips.Image.newFromBuffer(buffer);

  const pdfMode = parsed.canPassthrough ? 'passthrough' : 'decode + deflate';
  const hasEmbeddedIcc = !!(parsed.iccProfile && parsed.iccN > 0);

  return {
    image,
    width: image.width,
    height: image.height,
    bands: image.bands,
    hasAlpha: image.hasAlpha(),
    interpretation: image.interpretation,
    compressionName: parsed.compressionName,
    pdfMode,
    hasEmbeddedIcc,
    iccSource: hasEmbeddedIcc ? 'embedded' : 'sRGB fallback',
    iccColorSpace: hasEmbeddedIcc
      ? (parsed.iccN === 4 ? 'CMYK' : parsed.iccN === 1 ? 'Gray' : 'RGB')
      : 'RGB (sRGB)',
  };
}

/**
 * @typedef {Object} TiffToPdfOpts
 * @property {boolean} [cmyk=false]  force conversion to CMYK
 */

/**
 * Convert a TIFF buffer to PDF bytes.
 * Uses passthrough when the compression is PDF-native, otherwise decodes and
 * re-compresses with deflate.  Embedded ICC profiles are included in both paths.
 *
 * @param {ArrayBuffer} tiffBuffer
 * @param {TiffToPdfOpts} [opts]
 * @returns {Promise<Uint8Array>}
 */
export async function tiffToPdf(tiffBuffer, opts = {}) {
  if (!vips) throw new Error('Call initVips() first');
  const forceCmyk = !!opts.cmyk;

  const parsed = parseTiff(tiffBuffer);

  const embeddedIcc = parsed.iccProfile && parsed.iccN > 0;

  console.log('[tiffToPdf] parsed:', {
    w: parsed.width, h: parsed.height,
    compression: parsed.compressionName,
    photometric: parsed.photometric,
    samplesPerPixel: parsed.samplesPerPixel,
    bitsPerSample: parsed.bitsPerSample,
    canPassthrough: parsed.canPassthrough,
    pdfFilter: parsed.pdfFilter,
    pdfColorSpace: parsed.pdfColorSpace,
    embeddedIcc: !!embeddedIcc,
    iccN: parsed.iccN || 0,
    forceCmyk,
  });

  // Passthrough is only possible when we don't need to convert colour space
  const alreadyCmyk = parsed.photometric === 5;
  const canPassthrough = parsed.canPassthrough && (!forceCmyk || alreadyCmyk);

  if (canPassthrough && parsed.imageData) {
    const bpc = parsed.ccittParams ? 1 : parsed.bitsPerSample[0];
    const useIcc = !parsed.ccittParams;
    const isRgbPdf = parsed.pdfColorSpace === '/DeviceRGB';
    const outIcc = useIcc
      ? (embeddedIcc ? parsed.iccProfile : (isRgbPdf ? srgbIcc() : null))
      : null;
    const outIccN = outIcc ? (embeddedIcc ? parsed.iccN : 3) : 0;
    console.log('[tiffToPdf] passthrough path:', {
      filter: parsed.pdfFilter, bpc, useIcc,
      iccN: outIccN,
      dataBytes: parsed.imageData.length,
    });
    return buildPdf({
      width: parsed.width,
      height: parsed.height,
      bitsPerComponent: bpc,
      colorSpace: parsed.pdfColorSpace,
      filter: parsed.pdfFilter,
      data: parsed.imageData,
      decodeParms: parsed.ccittParams || undefined,
      iccProfile: outIcc,
      iccN: outIccN,
    });
  }

  // Fallback: decode with wasm-vips → raw pixels → deflate → PDF
  //
  // Build a vips pipeline using the same chaining pattern as the downscale
  // demo (which is known to work with wasm-vips 0.0.17).  Each step
  // produces a new Image; we track intermediates for cleanup.
  const image = vips.Image.newFromBuffer(tiffBuffer);
  const toDelete = [];
  try {
    const interp = image.interpretation;
    const isGray = interp === 'b-w' || interp === 'grey16';
    const isCmyk = interp === 'cmyk';
    let colorModelPreserved = true;

    console.log('[tiffToPdf] decode path — loaded image:', {
      width: image.width, height: image.height,
      bands: image.bands, format: image.format,
      interpretation: interp,
      hasAlpha: image.hasAlpha(),
      isGray, isCmyk,
    });

    // --- colour-space conversion ---
    let rgb = image;
    if (!isGray && !isCmyk && interp !== 'srgb') {
      console.log(`[tiffToPdf] colourspace: ${interp} → srgb`);
      rgb = image.colourspace('srgb');
      toDelete.push(rgb);
      colorModelPreserved = false;
      console.log('[tiffToPdf] after colourspace:', {
        bands: rgb.bands, format: rgb.format,
        interpretation: rgb.interpretation,
        hasAlpha: rgb.hasAlpha(),
        typeof: typeof rgb, constructor: rgb?.constructor?.name,
      });
    } else {
      console.log(`[tiffToPdf] keeping colour space: ${interp}`);
    }

    // --- separate alpha (if any) into a soft-mask ---
    let alphaMask = null;
    let noAlpha = rgb;

    if (rgb.hasAlpha()) {
      console.log('[tiffToPdf] stripping alpha, bands:', rgb.bands);
      try {
        const nColor = rgb.bands - 1;
        const colorBands = rgb.extract_band(0, { n: nColor });
        toDelete.push(colorBands);
        const alphaBand = rgb.extract_band(nColor, { n: 1 });
        toDelete.push(alphaBand);
        let aUchar = alphaBand;
        if (alphaBand.format !== 'uchar') {
          console.log('[tiffToPdf] casting alpha to uchar from:', alphaBand.format);
          aUchar = alphaBand.cast('uchar');
          toDelete.push(aUchar);
        }
        alphaMask = aUchar.writeToMemory();
        noAlpha = colorBands;
        console.log('[tiffToPdf] alpha extracted, color bands:', noAlpha.bands);
      } catch (err) {
        console.warn('[tiffToPdf] extract_band failed, flattening:', err.message);
        const flat = rgb.flatten();
        toDelete.push(flat);
        noAlpha = flat;
        console.log('[tiffToPdf] after flatten:', { bands: flat.bands, format: flat.format });
      }
    } else {
      console.log('[tiffToPdf] no alpha to strip');
    }

    // --- ensure grayscale is single-band ---
    let final = noAlpha;
    if (isGray && final.bands > 1) {
      console.log('[tiffToPdf] reducing gray to 1 band from:', final.bands);
      try {
        const g = final.extract_band(0, { n: 1 });
        toDelete.push(g);
        final = g;
      } catch (err) {
        console.warn('[tiffToPdf] gray extract_band failed:', err.message);
      }
    }

    // --- force CMYK if requested ---
    let outputCmyk = isCmyk;
    if (forceCmyk && !isCmyk) {
      console.log(`[tiffToPdf] converting ${final.interpretation} → cmyk`);
      const cmykImg = final.colourspace('cmyk');
      toDelete.push(cmykImg);
      final = cmykImg;
      outputCmyk = true;
      console.log('[tiffToPdf] after cmyk conversion:', {
        bands: final.bands, format: final.format,
        interpretation: final.interpretation,
      });
    }

    // --- ensure uchar ---
    if (final.format !== 'uchar') {
      console.log(`[tiffToPdf] cast: ${final.format} → uchar`);
      const u = final.cast('uchar');
      toDelete.push(u);
      final = u;
    }

    const w = final.width;
    const h = final.height;
    const bands = final.bands;
    const raw = final.writeToMemory();

    console.log('[tiffToPdf] final image:', { w, h, bands, rawBytes: raw.length });

    const colorSpace = outputCmyk ? '/DeviceCMYK'
      : (isGray || bands === 1) ? '/DeviceGray'
      : '/DeviceRGB';

    let outIcc = null;
    let outIccN = 0;
    let iccSource = 'none';
    if (!forceCmyk && colorModelPreserved && embeddedIcc) {
      outIcc = parsed.iccProfile;
      outIccN = parsed.iccN;
      iccSource = 'embedded';
    } else if (!outputCmyk && !isGray) {
      outIcc = srgbIcc();
      outIccN = 3;
      iccSource = 'sRGB fallback';
    }

    console.log('[tiffToPdf] PDF output:', {
      colorSpace, colorModelPreserved,
      iccSource, iccN: outIccN,
      hasAlpha: !!alphaMask,
    });

    const compressed = await deflate(raw);
    const compressedAlpha = alphaMask ? await deflate(alphaMask) : null;

    console.log('[tiffToPdf] compressed:', {
      rawBytes: raw.length,
      deflatedBytes: compressed.length,
      alphaBytes: compressedAlpha?.length ?? 0,
    });

    return buildPdf({
      width: w,
      height: h,
      bitsPerComponent: 8,
      colorSpace,
      filter: '/FlateDecode',
      data: compressed,
      alphaMask: compressedAlpha,
      iccProfile: outIcc,
      iccN: outIccN,
    });
  } finally {
    for (const obj of toDelete) {
      try { obj.delete(); } catch (_) {}
    }
    image.delete();
  }
}

/**
 * Compress data using the browser's CompressionStream (zlib/deflate format).
 *
 * @param {Uint8Array} data
 * @returns {Promise<Uint8Array>}
 */
async function deflate(data) {
  const cs = new CompressionStream('deflate');
  const writer = cs.writable.getWriter();
  await writer.write(data);
  await writer.close();

  const chunks = [];
  const reader = cs.readable.getReader();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }

  const totalLen = chunks.reduce((s, c) => s + c.length, 0);
  const result = new Uint8Array(totalLen);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result;
}

/**
 * Create a downscaled RGBA preview of a vips image for canvas display.
 *
 * @param {any} image  vips image (not freed — caller owns it)
 * @param {number} maxDim  max width or height for the preview
 * @returns {{ rgba: Uint8Array, width: number, height: number }}
 */
export function imageToPreview(image, maxDim) {
  const scale = Math.min(1, maxDim / Math.max(image.width, image.height));

  let preview = image;
  let needsDelete = false;

  if (scale < 1) {
    preview = image.resize(scale);
    needsDelete = true;
  }

  if (preview.interpretation !== 'srgb') {
    const t = preview.colourspace('srgb');
    if (needsDelete) preview.delete();
    preview = t;
    needsDelete = true;
  }

  if (!preview.hasAlpha()) {
    const t = preview.bandjoin(255);
    if (needsDelete) preview.delete();
    preview = t;
    needsDelete = true;
  }

  if (preview.format !== 'uchar') {
    const t = preview.cast('uchar');
    if (needsDelete) preview.delete();
    preview = t;
    needsDelete = true;
  }

  if (preview.bands > 4) {
    const t = preview.extract_band(0, { n: 4 });
    if (needsDelete) preview.delete();
    preview = t;
    needsDelete = true;
  }

  const width = preview.width;
  const height = preview.height;
  const rgba = preview.writeToMemory();

  if (needsDelete) preview.delete();

  return { rgba, width, height };
}
