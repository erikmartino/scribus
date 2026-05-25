// pdf-writer.js — low-level streaming PDF generator (no external deps)
//
// Emits a standards-conformant PDF 1.4 byte stream via ReadableStream.
// Objects are written in order; byte offsets are tracked for the xref table.
//
// Text encoding: PDF literal strings use PDFDocEncoding (Latin-1 subset).
// Characters outside Latin-1 are replaced with '?' and a console warning
// is emitted — full Unicode support requires embedded font subsets (v2).
//
// Coordinate system note:
//   PDF origin = bottom-left.  SVG/CSS origin = top-left.
//   Caller must flip Y:  pdf_y = pageHeight - svg_baseline_y

const enc = new TextEncoder();

// ---------------------------------------------------------------------------
// PDF string escaping
// ---------------------------------------------------------------------------

/**
 * Escape a JS string for use inside a PDF literal string ( ... ).
 * Only characters ≤ 0xFF are kept; others are replaced with '?'.
 * Supports remapping ligatures to custom characters (240–244) using octal escapes
 * when useLigatures is true.
 * @param {string} s
 * @param {boolean} [useLigatures]
 * @returns {string}
 */
function pdfLiteral(s, useLigatures = false) {
  let mapped = s;
  if (useLigatures) {
    mapped = mapped.replaceAll('ffi', '\\363');
    mapped = mapped.replaceAll('ffl', '\\364');
    mapped = mapped.replaceAll('ff', '\\362');
    mapped = mapped.replaceAll('fi', '\\360');
    mapped = mapped.replaceAll('fl', '\\361');
  }

  let out = '';
  for (let i = 0; i < mapped.length; i++) {
    const c = mapped.charCodeAt(i);
    // If it's a pre-escaped octal sequence (e.g. \360), let it pass through unchanged
    if (c === 0x5C && i + 3 < mapped.length && /^[0-7]{3}$/.test(mapped.slice(i + 1, i + 4))) {
      out += mapped.slice(i, i + 4);
      i += 3;
      continue;
    }

    if (c > 0xFF) {
      console.warn(`[pdf-writer] Non-Latin character U+${c.toString(16).toUpperCase()} replaced with '?'`);
      out += '?';
    } else if (c === 0x28) {  // (
      out += '\\(';
    } else if (c === 0x29) {  // )
      out += '\\)';
    } else if (c === 0x5C) {  // backslash
      out += '\\\\';
    } else {
      out += String.fromCharCode(c);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Deflate helper (PNG images)
// ---------------------------------------------------------------------------

/**
 * Deflate a Uint8Array using the native CompressionStream API.
 * Returns a Promise<Uint8Array> of the compressed bytes.
 * @param {Uint8Array} data
 * @returns {Promise<Uint8Array>}
 */
async function deflate(data) {
  const cs = new CompressionStream('deflate');
  const writer = cs.writable.getWriter();
  writer.write(data);
  writer.close();
  const chunks = [];
  const reader = cs.readable.getReader();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }
  // Concatenate
  const total = chunks.reduce((n, c) => n + c.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) { out.set(c, offset); offset += c.length; }
  return out;
}

// ---------------------------------------------------------------------------
// PdfWriter class
// ---------------------------------------------------------------------------

export class PdfWriter {
  /**
   * @param {number} pageWidth   — default page width in points
   * @param {number} pageHeight  — default page height in points
   */
  constructor(pageWidth, pageHeight) {
    this._pageWidth = pageWidth;
    this._pageHeight = pageHeight;
    this._offset = 0;
    this._offsets = new Map(); // objId -> byte offset
    this._controller = null;

    this._stream = new ReadableStream({
      start: (ctrl) => { this._controller = ctrl; },
    });
  }

  /** @type {ReadableStream<Uint8Array>} */
  get stream() { return this._stream; }

  // ---------- emit primitives ----------

  /** Enqueue raw bytes and advance offset counter. */
  _emit(bytes) {
    this._controller.enqueue(bytes);
    this._offset += bytes.length;
  }

  /** Enqueue a string as UTF-8 bytes. */
  _emitStr(s) {
    this._emit(enc.encode(s));
  }

  // ---------- PDF structure ----------

  /** Write %PDF-1.4 header + binary-safe comment. */
  writeHeader() {
    // The 4 high-bit bytes mark the file as binary (required by some tools).
    this._emitStr('%PDF-1.4\n');
    this._emit(new Uint8Array([0x25, 0xE2, 0xE3, 0xCF, 0xD3, 0x0A])); // %âãÏÓ\n
  }

  /**
   * Begin a PDF object and record its byte offset.
   * @param {number} id
   */
  _beginObj(id) {
    this._offsets.set(id, this._offset);
    this._emitStr(`${id} 0 obj\n`);
  }

  _endObj() {
    this._emitStr('endobj\n');
  }

  /**
   * Write a Type1 standard font object (no font file embedding).
   * @param {number} id      — PDF object id
   * @param {string} alias   — resource name, e.g. "F0"
   * @param {string} pdfName — PDF standard font name, e.g. "Times-Roman"
   */
  writeStandardFont(id, alias, pdfName) {
    this._beginObj(id);
    this._emitStr(
      `<< /Type /Font\n` +
      `   /Subtype /Type1\n` +
      `   /BaseFont /${pdfName}\n` +
      `   /Encoding /WinAnsiEncoding\n` +
      `>>\n`
    );
    this._endObj();
  }

  /**
   * Write a TrueType font with embedded subset bytes.
   * Note: This uses WinAnsiEncoding, which limits strings to Latin-1.
   * @param {number} fontId 
   * @param {number} descriptorId 
   * @param {number} streamId 
   * @param {string} alias 
   * @param {string} baseFontName 
   * @param {Uint8Array} ttfBytes 
   */
  writeTrueTypeFont(fontId, descriptorId, streamId, alias, baseFontName, ttfBytes) {
    // 1. Font Stream (Length1 is required for TrueType, matching Length)
    this._beginObj(streamId);
    this._emitStr(
      `<< /Length ${ttfBytes.length}\n` +
      `   /Length1 ${ttfBytes.length}\n` +
      `>>\n` +
      `stream\n`
    );
    this._emit(ttfBytes);
    this._emitStr('\nendstream\n');
    this._endObj();

    // 2. Font Descriptor (minimal metrics; viewer reads exact from TTF)
    this._beginObj(descriptorId);
    this._emitStr(
      `<< /Type /FontDescriptor\n` +
      `   /FontName /${baseFontName}\n` +
      `   /Flags 32\n` +
      `   /FontBBox [-1000 -1000 3000 3000]\n` +
      `   /ItalicAngle 0\n` +
      `   /Ascent 800\n` +
      `   /Descent -200\n` +
      `   /CapHeight 700\n` +
      `   /StemV 80\n` +
      `   /FontFile2 ${streamId} 0 R\n` +
      `>>\n`
    );
    this._endObj();

    // 3. Font Dictionary (relies on TTF hmtx for widths)
    this._beginObj(fontId);
    this._emitStr(
      `<< /Type /Font\n` +
      `   /Subtype /TrueType\n` +
      `   /BaseFont /${baseFontName}\n` +
      `   /Encoding <<\n` +
      `     /Type /Encoding\n` +
      `     /BaseEncoding /WinAnsiEncoding\n` +
      `     /Differences [\n` +
      `       240 /fi /fl /ff /ffi /ffl\n` +
      `     ]\n` +
      `   >>\n` +
      `   /FontDescriptor ${descriptorId} 0 R\n` +
      `>>\n`
    );
    this._endObj();
  }

  /**
   * Write a JPEG image as an XObject stream (DCTDecode — zero re-encoding).
   * @param {number}     id
   * @param {Uint8Array} jpegBytes
   * @param {number}     w
   * @param {number}     h
   */
  writeJpegXObject(id, jpegBytes, w, h) {
    this._beginObj(id);
    this._emitStr(
      `<< /Type /XObject\n` +
      `   /Subtype /Image\n` +
      `   /Width ${w}\n` +
      `   /Height ${h}\n` +
      `   /ColorSpace /DeviceRGB\n` +
      `   /BitsPerComponent 8\n` +
      `   /Filter /DCTDecode\n` +
      `   /Length ${jpegBytes.length}\n` +
      `>>\n` +
      `stream\n`
    );
    this._emit(jpegBytes);
    this._emitStr('\nendstream\n');
    this._endObj();
  }

  /**
   * Write an RGB PNG image as an XObject stream (FlateDecode).
   * @param {number}     id
   * @param {Uint8Array} deflatedRgb  — deflated 3-channel (RGB) bytes, no alpha
   * @param {number}     w
   * @param {number}     h
   */
  writePngXObject(id, deflatedRgb, w, h) {
    this._beginObj(id);
    this._emitStr(
      `<< /Type /XObject\n` +
      `   /Subtype /Image\n` +
      `   /Width ${w}\n` +
      `   /Height ${h}\n` +
      `   /ColorSpace /DeviceRGB\n` +
      `   /BitsPerComponent 8\n` +
      `   /Filter /FlateDecode\n` +
      `   /Length ${deflatedRgb.length}\n` +
      `>>\n` +
      `stream\n`
    );
    this._emit(deflatedRgb);
    this._emitStr('\nendstream\n');
    this._endObj();
  }

  /**
   * Write a CMYK image as an XObject stream (FlateDecode).
   * @param {number}     id
   * @param {Uint8Array} deflatedCmyk  — deflated 4-channel (CMYK) bytes, no alpha
   * @param {number}     w
   * @param {number}     h
   */
  writeCmykXObject(id, deflatedCmyk, w, h) {
    this._beginObj(id);
    this._emitStr(
      `<< /Type /XObject\n` +
      `   /Subtype /Image\n` +
      `   /Width ${w}\n` +
      `   /Height ${h}\n` +
      `   /ColorSpace /DeviceCMYK\n` +
      `   /BitsPerComponent 8\n` +
      `   /Filter /FlateDecode\n` +
      `   /Length ${deflatedCmyk.length}\n` +
      `>>\n` +
      `stream\n`
    );
    this._emit(deflatedCmyk);
    this._emitStr('\nendstream\n');
    this._endObj();
  }

  /**
   * Write a content stream (text / graphics operators).
   * @param {number} id
   * @param {string} ops  — PDF content stream as a string
   */
  writeContentStream(id, ops) {
    const body = enc.encode(ops);
    this._beginObj(id);
    this._emitStr(
      `<< /Length ${body.length} >>\n` +
      `stream\n`
    );
    this._emit(body);
    this._emitStr('\nendstream\n');
    this._endObj();
  }

  /**
   * Write a page dictionary.
   * @param {number} id
   * @param {{
   *   parentRef: number,
   *   contentRef: number,
   *   width: number,
   *   height: number,
   *   fontRefs: { alias: string, id: number }[],
   *   imageRefs: { alias: string, id: number }[],
   * }} opts
   */
  writePageDict(id, { parentRef, contentRef, width, height, fontRefs = [], imageRefs = [] }) {
    const fontEntries = fontRefs.map(f => `/${f.alias} ${f.id} 0 R`).join(' ');
    const imageEntries = imageRefs.map(r => `/${r.alias} ${r.id} 0 R`).join(' ');
    this._beginObj(id);
    this._emitStr(
      `<< /Type /Page\n` +
      `   /Parent ${parentRef} 0 R\n` +
      `   /MediaBox [0 0 ${width} ${height}]\n` +
      `   /Contents ${contentRef} 0 R\n` +
      `   /Resources <<\n` +
      `     /Font << ${fontEntries} >>\n` +
      `     /XObject << ${imageEntries} >>\n` +
      `   >>\n` +
      `>>\n`
    );
    this._endObj();
  }

  /**
   * Write the Pages tree node.
   * @param {number}   id
   * @param {number[]} pageObjIds
   * @param {number}   pageWidth
   * @param {number}   pageHeight
   */
  writePageTree(id, pageObjIds, pageWidth, pageHeight) {
    const kids = pageObjIds.map(p => `${p} 0 R`).join(' ');
    this._beginObj(id);
    this._emitStr(
      `<< /Type /Pages\n` +
      `   /Kids [${kids}]\n` +
      `   /Count ${pageObjIds.length}\n` +
      `   /MediaBox [0 0 ${pageWidth} ${pageHeight}]\n` +
      `>>\n`
    );
    this._endObj();
  }

  /**
   * Write the document Catalog.
   * @param {number} id
   * @param {number} pageTreeRef
   */
  writeCatalog(id, pageTreeRef) {
    this._beginObj(id);
    this._emitStr(
      `<< /Type /Catalog\n` +
      `   /Pages ${pageTreeRef} 0 R\n` +
      `>>\n`
    );
    this._endObj();
  }

  /**
   * Write cross-reference table + trailer and close the stream.
   * @param {number} catalogId
   * @param {number} totalObjects  — highest object id + 1
   */
  writeXref(catalogId, totalObjects) {
    const xrefOffset = this._offset;

    this._emitStr(`xref\n0 ${totalObjects + 1}\n`);
    // Object 0: free head
    this._emitStr('0000000000 65535 f \n');

    for (let id = 1; id <= totalObjects; id++) {
      const off = this._offsets.get(id) ?? 0;
      this._emitStr(`${String(off).padStart(10, '0')} 00000 n \n`);
    }

    this._emitStr(
      `trailer\n` +
      `<< /Size ${totalObjects + 1}\n` +
      `   /Root ${catalogId} 0 R\n` +
      `>>\n` +
      `startxref\n` +
      `${xrefOffset}\n` +
      `%%EOF\n`
    );

    this._controller.close();
  }
}

// ---------------------------------------------------------------------------
// Font name helpers
// ---------------------------------------------------------------------------

/**
 * Map a character style to a PDF standard font name and resource alias.
 * @param {{ bold?: boolean, italic?: boolean }} style
 * @param {string} [baseFamily]  — 'Times' or 'Helvetica'
 * @returns {{ pdfName: string, alias: string }}
 */
export function standardFontForStyle(style, baseFamily = 'Times') {
  const bold = !!style.bold;
  const italic = !!style.italic;
  if (baseFamily === 'Helvetica') {
    if (bold && italic) return { pdfName: 'Helvetica-BoldOblique', alias: 'FHBi' };
    if (bold)           return { pdfName: 'Helvetica-Bold',        alias: 'FHB'  };
    if (italic)         return { pdfName: 'Helvetica-Oblique',     alias: 'FHI'  };
                        return { pdfName: 'Helvetica',             alias: 'FH'   };
  }
  // Default: Times
  if (bold && italic) return { pdfName: 'Times-BoldItalic', alias: 'FTBi' };
  if (bold)           return { pdfName: 'Times-Bold',        alias: 'FTB'  };
  if (italic)         return { pdfName: 'Times-Italic',      alias: 'FTI'  };
                      return { pdfName: 'Times-Roman',        alias: 'FT'   };
}

/**
 * Build a PDF content-stream text block for a single fragment.
 *
 * @param {string} text
 * @param {string} fontAlias  — e.g. "FT"
 * @param {number} fontSize
 * @param {number} pdfX       — x in PDF coordinates (points from left)
 * @param {number} pdfY       — y in PDF coordinates (points from bottom)
 * @returns {string}
 */
export function textOp(text, fontAlias, fontSize, pdfX, pdfY, useLigatures = false, isFauxBold = false, isFauxItalic = false) {
  const escaped = pdfLiteral(text, useLigatures);
  let ops = `BT\n`;
  ops += `  /${fontAlias} ${fontSize.toFixed(2)} Tf\n`;

  if (isFauxBold) {
    const strokeWidth = fontSize * 0.025;
    ops += `  2 Tr\n`;
    ops += `  ${strokeWidth.toFixed(2)} w\n`;
  }

  if (isFauxItalic) {
    ops += `  1 0 0.212 1 ${pdfX.toFixed(2)} ${pdfY.toFixed(2)} Tm\n`;
  } else {
    ops += `  ${pdfX.toFixed(2)} ${pdfY.toFixed(2)} Td\n`;
  }

  ops += `  (${escaped}) Tj\n`;

  if (isFauxBold) {
    ops += `  0 Tr\n`;
  }
  ops += `ET\n`;
  return ops;
}

/**
 * Build a PDF content-stream image placement block.
 *
 * @param {string} alias     — XObject resource name, e.g. "Im0"
 * @param {number} pdfX
 * @param {number} pdfY      — bottom-left of image in PDF coords
 * @param {number} width
 * @param {number} height
 * @returns {string}
 */
export function imageOp(alias, pdfX, pdfY, width, height) {
  return (
    `q\n` +
    `${width.toFixed(2)} 0 0 ${height.toFixed(2)} ${pdfX.toFixed(2)} ${pdfY.toFixed(2)} cm\n` +
    `/${alias} Do\n` +
    `Q\n`
  );
}
