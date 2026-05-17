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

export { createLayoutEngine };

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
      if (!imgBox.imageUrl) continue;

      try {
        const res = await fetch(imgBox.imageUrl);
        if (!res.ok) continue;
        const buf = new Uint8Array(await res.arrayBuffer());
        const kind = detectImageType(buf);
        const imageObjId = ids.next();
        const alias = `Im${pi}_${ii}`;

        if (kind === 'jpeg') {
          pdf.writeJpegXObject(imageObjId, buf, imgBox.width, imgBox.height);
          imageRefs.push({ alias, id: imageObjId });
        } else if (kind === 'png') {
          const { rgb, width, height } = await decodePngToRgb(buf);
          // Deflate the RGB bytes
          const cs = new CompressionStream('deflate');
          const cw = cs.writable.getWriter();
          cw.write(rgb);
          cw.close();
          const deflatedChunks = [];
          const cr = cs.readable.getReader();
          while (true) {
            const { done, value } = await cr.read();
            if (done) break;
            deflatedChunks.push(value);
          }
          const total = deflatedChunks.reduce((n, c) => n + c.length, 0);
          const deflated = new Uint8Array(total);
          let off = 0;
          for (const c of deflatedChunks) { deflated.set(c, off); off += c.length; }
          pdf.writePngXObject(imageObjId, deflated, width, height);
          imageRefs.push({ alias, id: imageObjId });
        }
        // unknown type: skip
      } catch (e) {
        console.warn(`[pdf-generator] failed to fetch image ${imgBox.imageUrl}:`, e);
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
                ops += textOp(g.text, alias, line.fontSize, absX, pdfY);
              }
              xOffset += g.ax;
            }
          } else {
            // Fallback: fragment-level positioning (no intra-word kerning)
            for (const frag of word.fragments) {
              if (!frag.text || !frag.text.trim()) continue;
              const { alias } = standardFontForStyle(frag.style);
              const absX = box.x + padding + word.x;
              ops += textOp(frag.text, alias, line.fontSize, absX, pdfY);
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
