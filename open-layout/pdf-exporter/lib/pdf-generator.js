// pdf-generator.js — high-level PDF document renderer
//
// Imports the DOM-free layout pipeline from svg-generator and drives PdfWriter
// to produce a streaming PDF.
//
// Font strategy: PDF standard Type1 fonts (Times-Roman) are used as fallbacks.
// When possible, EB Garamond (or other requested fonts) are subsetted via
// hb-subset.wasm and embedded as TrueType font streams, keeping file size small.

import { layoutDocument, createLayoutEngine } from '../../doc-renderer/lib/layout-document.js';
import {
  PdfWriter,
  standardFontForStyle,
  textOp,
  imageOp,
} from './pdf-writer.js';
import { createSubsetter } from './subsetter.js';
import { extFromMime } from '../../document-store/lib/document-store.js';

export { createLayoutEngine };

let vips = null;

async function initVips() {
  if (vips) return;

  const origin = typeof location !== 'undefined' ? location.origin : '';
  const vipsUrl = origin + '/vendor/wasm-vips/vips-es6.js';
  const Vips = (await import(vipsUrl)).default;

  const workerCode = `import "${vipsUrl}";`;
  const blob = new Blob([workerCode], { type: 'application/javascript' });
  const blobUrl = URL.createObjectURL(blob);

  vips = await Vips({
    mainScriptUrlOrBlob: blobUrl,
    locateFile: (fileName) => origin + `/vendor/wasm-vips/${fileName}`
  });

  URL.revokeObjectURL(blobUrl);
}

async function deflate(data) {
  const cs = new CompressionStream('deflate');
  const writer = cs.writable.getWriter();
  const writePromise = writer.write(data).then(() => writer.close());

  const chunks = [];
  const reader = cs.readable.getReader();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }

  await writePromise;

  const totalLen = chunks.reduce((s, c) => s + c.length, 0);
  const result = new Uint8Array(totalLen);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result;
}

// ---------------------------------------------------------------------------
// Image helpers
// ---------------------------------------------------------------------------

/**
 * Detect MIME type from the first bytes of an ArrayBuffer.
 * @param {Uint8Array} bytes
 * @returns {'jpeg'|'png'|'unknown'}
 */
function detectImageType(bytes) {
  if (bytes[0] === 0xFF && bytes[1] === 0xD8) return 'jpeg';
  if (bytes[0] === 0x89 && bytes[1] === 0x50) return 'png';
  return 'unknown';
}

/**
 * Decode a PNG to raw RGB bytes via OffscreenCanvas.
 * @param {Uint8Array} pngBytes
 * @returns {Promise<{ rgb: Uint8Array, width: number, height: number }>}
 */
async function decodePngToRgb(pngBytes) {
  const blob = new Blob([pngBytes], { type: 'image/png' });
  const bmp = await createImageBitmap(blob);
  const { width, height } = bmp;
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(bmp, 0, 0);
  bmp.close();
  const imageData = ctx.getImageData(0, 0, width, height);
  // Strip alpha: RGBA → RGB
  const rgba = imageData.data; // Uint8ClampedArray
  const rgb = new Uint8Array(width * height * 3);
  for (let i = 0, j = 0; i < rgba.length; i += 4, j += 3) {
    rgb[j]     = rgba[i];
    rgb[j + 1] = rgba[i + 1];
    rgb[j + 2] = rgba[i + 2];
  }
  return { rgb, width, height };
}

// ---------------------------------------------------------------------------
// Object-ID allocator
// ---------------------------------------------------------------------------

class IdAllocator {
  constructor(start = 1) { this._next = start; }
  next() { return this._next++; }
  get current() { return this._next - 1; }
  get total() { return this._next - 1; }
}

// ---------------------------------------------------------------------------
// Collect all font variants used across all pages
// ---------------------------------------------------------------------------

/**
 * @param {import('../../doc-renderer/lib/layout-document.js').PageLayoutData[]} pages
 * @param {string} defaultFamily
 * @returns {Map<string, { family: string, variant: string, unicodes: Set<number> }>}
 */
function collectFontData(pages, defaultFamily) {
  const fontData = new Map();
  for (const page of pages) {
    for (const { lines } of page.textBoxes) {
      for (const line of lines) {
        for (const word of line.words) {
          for (const frag of word.fragments) {
            if (!frag.text || !frag.text.trim()) continue;

            const { alias } = standardFontForStyle(frag.style);
            
            if (!fontData.has(alias)) {
              const bold = !!frag.style.bold;
              const italic = !!frag.style.italic;
              let variant = 'regular';
              if (bold && italic) variant = 'bolditalic';
              else if (bold) variant = 'bold';
              else if (italic) variant = 'italic';
              
              const family = frag.style.fontFamily || defaultFamily;
              fontData.set(alias, { family, variant, unicodes: new Set() });
            }
            
            const data = fontData.get(alias);
            for (const char of frag.text) {
              data.unicodes.add(char.codePointAt(0));
            }

            // Proactively include ligature codepoints in TrueType font subset if they are used in the text run
            if (frag.text.includes('ffi')) data.unicodes.add(0xFB03);
            if (frag.text.includes('ffl')) data.unicodes.add(0xFB04);
            if (frag.text.includes('ff'))  data.unicodes.add(0xFB00);
            if (frag.text.includes('fi'))  data.unicodes.add(0xFB01);
            if (frag.text.includes('fl'))  data.unicodes.add(0xFB02);
          }
        }
      }
    }
  }
  return fontData;
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

/**
 * Stream a complete PDF document for the given store path.
 *
 * The returned ReadableStream emits Uint8Array chunks.
 * Use showSaveFilePicker() or accumulate into a Blob for download.
 *
 * @param {import('../../story-editor/lib/layout-engine.js').LayoutEngine} engine
 * @param {string}   docPath  — e.g. "demo/typography-sampler"
 * @param {object}   [opts]
 * @param {function} [opts.onProgress]  — called with (pageIndex, totalPages)
 * @param {number}   [opts.fontSize]
 * @param {number}   [opts.lineHeight]
 * @returns {ReadableStream<Uint8Array>}
 */
export function streamDocument(engine, docPath, opts = {}) {
  // We use a TransformStream trick to kick off async work while immediately
  // returning a ReadableStream to the caller.
  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();

  _generatePdf(engine, docPath, opts, writer).catch(err => {
    console.error('[pdf-generator] error:', err);
    writer.abort(err);
  });

  return readable;
}

async function _generatePdf(engine, docPath, opts, writer) {
  const onProgress = opts.onProgress ?? (() => {});

  // Initialize wasm-vips
  try {
    await initVips();
  } catch (e) {
    console.warn('[pdf-generator] Failed to initialise wasm-vips:', e);
  }

  // 1. Layout all pages (no DOM created)
  const { pages, fontFamily } = await layoutDocument(engine, docPath, opts);
  const totalPages = pages.length;

  if (totalPages === 0) {
    throw new Error('Document has no pages');
  }

  const pageWidth  = pages[0].width;
  const pageHeight = pages[0].height;

  // 2. Allocate object IDs up-front
  //    Strategy:
  //      IDs 1…F  — one font object per variant used
  //      Then per page: [contentStreamId, pageId] + imageXObjectId(s) per image
  //      Then: pageTreeId, catalogId

  const ids = new IdAllocator(1);

  // Font objects
  const fontData = collectFontData(pages, fontFamily);
  let subsetter;
  try {
    subsetter = await createSubsetter();
  } catch (e) {
    console.warn('[pdf-generator] Failed to initialise subsetter:', e);
  }

  /** @type {Map<string, { id: number, pdfName: string, alias: string, subsetBytes?: Uint8Array, descriptorId?: number, streamId?: number, family: string, variant: string }>} */
  const fontMap = new Map();
  for (const [alias, data] of fontData.entries()) {
    const id = ids.next();
    const { pdfName } = _aliasToPdfFont(alias);

    let subsetBytes;
    let descriptorId;
    let streamId;
    
    if (subsetter) {
      const ttfBuffer = engine._fontRegistry.getFontBuffer(data.family, data.variant);
      if (ttfBuffer) {
        try {
          subsetBytes = subsetter.subset(ttfBuffer, data.unicodes);
          descriptorId = ids.next();
          streamId = ids.next();
        } catch (e) {
          console.warn(`[pdf-generator] Subsetting failed for ${data.family} ${data.variant}:`, e);
        }
      } else {
        console.warn(`[pdf-generator] Font buffer not found for ${data.family} ${data.variant}`);
      }
    }

    fontMap.set(alias, { id, pdfName, alias, subsetBytes, descriptorId, streamId, family: data.family, variant: data.variant });
  }

  // Per-page IDs (allocated lazily during the page loop below)
  const pageObjIds = [];

  // 3. Create writer and start emitting
  const pdf = new PdfWriter(pageWidth, pageHeight);

  // Pipe pdf.stream into our writable
  _pipeStream(pdf.stream, writer);

  pdf.writeHeader();

  // 4. Write font objects (before any page content)
  for (const { id, pdfName, alias, subsetBytes, descriptorId, streamId, family, variant } of fontMap.values()) {
    if (subsetBytes) {
      const baseFontName = `${family.replace(/\s+/g, '')}-${variant}`;
      pdf.writeTrueTypeFont(id, descriptorId, streamId, alias, baseFontName, subsetBytes);
    } else {
      pdf.writeStandardFont(id, alias, pdfName);
    }
  }

  const fontRefs = [...fontMap.values()].map(f => ({ alias: f.alias, id: f.id }));

  // 5. Write pages
  const pageTreeId = 0; // will be assigned after pages; use a placeholder object id
  // We need the pageTreeId before writing page dicts so we can set /Parent.
  // Allocate it now, write it later.
  const pageTreeObjId = ids.next();

  for (let pi = 0; pi < pages.length; pi++) {
    const page = pages[pi];
    const imageRefs = [];

    // 5a. Write image XObjects for this page
    for (let ii = 0; ii < page.imageBoxes.length; ii++) {
      const imgBox = page.imageBoxes[ii];
      if (!imgBox.imageUrl && !imgBox.assetRef) continue;

      try {
        let buf = null;
        let mime = null;
        let originalFetched = false;

        if (imgBox.assetRef) {
          try {
            const metaRes = await fetch(`/store/${docPath}/assets/${imgBox.assetRef}/meta.json`);
            if (metaRes.ok) {
              const meta = await metaRes.json();
              mime = meta.mime;
              const ext = extFromMime(mime);
              let originalUrl = `/store/${docPath}/assets/${imgBox.assetRef}/${imgBox.assetRef}.${ext}`;
              let origRes = await fetch(originalUrl);
              if (!origRes.ok && ext === 'tiff') {
                originalUrl = `/store/${docPath}/assets/${imgBox.assetRef}/${imgBox.assetRef}.tif`;
                origRes = await fetch(originalUrl);
              }
              if (origRes.ok) {
                buf = new Uint8Array(await origRes.arrayBuffer());
                originalFetched = true;
              }
            }
          } catch (metaErr) {
            console.warn(`[pdf-generator] failed to fetch original asset for ${imgBox.assetRef}:`, metaErr);
          }
        }

        // Fallback to preview JPEG if original asset fetch failed or wasn't tried
        if (!originalFetched) {
          const res = await fetch(imgBox.imageUrl);
          if (!res.ok) continue;
          buf = new Uint8Array(await res.arrayBuffer());
          mime = 'image/jpeg';
        }

        const imageObjId = ids.next();
        const alias = `Im${pi}_${ii}`;

        let useVips = false;
        let imgWidth = 0;
        let imgHeight = 0;
        let vipsImg = null;

        if (vips) {
          try {
            vipsImg = vips.Image.newFromBuffer(buf);
            imgWidth = vipsImg.width;
            imgHeight = vipsImg.height;
            useVips = true;
          } catch (vipsErr) {
            console.warn('[pdf-generator] failed to load image into vips:', vipsErr);
          }
        }

        // Calculate DPI
        let dpiX = 72;
        let dpiY = 72;
        if (useVips) {
          dpiX = (imgWidth / imgBox.width) * 72;
          dpiY = (imgHeight / imgBox.height) * 72;
        }

        const isTooLarge = (dpiX > 300 || dpiY > 300);
        const isUnsupported = (mime !== 'image/jpeg' && mime !== 'image/png');

        if (useVips && (isTooLarge || isUnsupported)) {
          let toDelete = [];
          try {
            let current = vipsImg;
            if (isTooLarge) {
              const scale = Math.min((imgBox.width * (300 / 72)) / imgWidth, (imgBox.height * (300 / 72)) / imgHeight);
              if (scale < 1) {
                const resized = vipsImg.resize(scale);
                toDelete.push(resized);
                current = resized;
              }
            }

            if (current.interpretation !== 'srgb') {
              const srgb = current.colourspace('srgb');
              toDelete.push(srgb);
              current = srgb;
            }

            let noAlpha = current;
            if (current.hasAlpha()) {
              try {
                const nColor = current.bands - 1;
                const colorBands = current.extract_band(0, { n: nColor });
                toDelete.push(colorBands);
                noAlpha = colorBands;
              } catch (err) {
                const flat = current.flatten();
                toDelete.push(flat);
                noAlpha = flat;
              }
            }

            let final = noAlpha;
            if (final.format !== 'uchar') {
              const ucharImg = final.cast('uchar');
              toDelete.push(ucharImg);
              final = ucharImg;
            }

            const outW = final.width;
            const outH = final.height;
            const rawBytes = final.writeToMemory();
            const deflated = await deflate(rawBytes);

            pdf.writePngXObject(imageObjId, deflated, outW, outH);
            imageRefs.push({ alias, id: imageObjId });
          } finally {
            for (const obj of toDelete) {
              try { obj.delete(); } catch (_) {}
            }
            try { vipsImg.delete(); } catch (_) {}
          }
        } else {
          // Pass-through or canvas fallback
          const kind = detectImageType(buf);
          if (kind === 'jpeg') {
            pdf.writeJpegXObject(imageObjId, buf, imgBox.width, imgBox.height);
            imageRefs.push({ alias, id: imageObjId });
          } else if (kind === 'png') {
            const { rgb, width, height } = await decodePngToRgb(buf);
            const deflated = await deflate(rgb);
            pdf.writePngXObject(imageObjId, deflated, width, height);
            imageRefs.push({ alias, id: imageObjId });
          }
          if (vipsImg) {
            try { vipsImg.delete(); } catch (_) {}
          }
        }
      } catch (e) {
        console.warn(`[pdf-generator] failed to process image ${imgBox.imageUrl}:`, e);
      }
    }

    // 5b. Build content stream
    const padding = 16; // matches SvgRenderer._padding default
    let ops = '';

    // Image placement operators
    for (let ii = 0; ii < imageRefs.length; ii++) {
      const imgBox = page.imageBoxes[ii];
      const { alias } = imageRefs[ii];
      // PDF y: flip from top-left to bottom-left
      const pdfY = pageHeight - imgBox.y - imgBox.height;
      ops += imageOp(alias, imgBox.x, pdfY, imgBox.width, imgBox.height);
    }

    // Text operators
    for (const { box, lines } of page.textBoxes) {
      for (const line of lines) {
        const pdfY = pageHeight - line.y;
        for (const word of line.words) {
          if (word.glyphData && word.glyphData.length > 0) {
            // Per-glyph positioning: uses HarfBuzz advances including GPOS kerning,
            // so the PDF matches the SVG renderer exactly.
            let xOffset = 0;
            for (const g of word.glyphData) {
              if (g.text && g.text.trim()) {
                const { alias } = standardFontForStyle(g.style);
                const absX = box.x + padding + word.x + xOffset + g.dx;
                const fontInfo = fontMap.get(alias);
                const useLigatures = !!fontInfo?.subsetBytes;
                ops += textOp(g.text, alias, line.fontSize, absX, pdfY, useLigatures);
              }
              xOffset += g.ax;
            }
          } else {
            // Fallback: fragment-level positioning (no intra-word kerning)
            for (const frag of word.fragments) {
              if (!frag.text || !frag.text.trim()) continue;
              const { alias } = standardFontForStyle(frag.style);
              const absX = box.x + padding + word.x;
              const fontInfo = fontMap.get(alias);
              const useLigatures = !!fontInfo?.subsetBytes;
              ops += textOp(frag.text, alias, line.fontSize, absX, pdfY, useLigatures);
            }
          }
        }
      }
    }

    // 5c. Write content stream and page dict
    const contentId = ids.next();
    pdf.writeContentStream(contentId, ops);

    const pageId = ids.next();
    pageObjIds.push(pageId);
    pdf.writePageDict(pageId, {
      parentRef: pageTreeObjId,
      contentRef: contentId,
      width: page.width,
      height: page.height,
      fontRefs,
      imageRefs,
    });

    onProgress(pi + 1, totalPages);
  }

  // 6. Write Pages tree and Catalog
  const catalogId = ids.next();
  pdf.writePageTree(pageTreeObjId, pageObjIds, pageWidth, pageHeight);
  pdf.writeCatalog(catalogId, pageTreeObjId);

  // 7. Write xref + trailer
  pdf.writeXref(catalogId, ids.total);

  // writer is closed by PdfWriter via controller.close() → pipe ends
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Pipe a ReadableStream into a WritableStream writer (no pipeTo available on writer). */
async function _pipeStream(readable, writer) {
  const reader = readable.getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) { writer.close(); return; }
      await writer.write(value);
    }
  } catch (e) {
    writer.abort(e);
  }
}

/** Recover PDF font name from alias string. */
function _aliasToPdfFont(alias) {
  const map = {
    FT:   'Times-Roman',
    FTB:  'Times-Bold',
    FTI:  'Times-Italic',
    FTBi: 'Times-BoldItalic',
    FH:   'Helvetica',
    FHB:  'Helvetica-Bold',
    FHI:  'Helvetica-Oblique',
    FHBi: 'Helvetica-BoldOblique',
  };
  return { pdfName: map[alias] ?? 'Times-Roman' };
}
