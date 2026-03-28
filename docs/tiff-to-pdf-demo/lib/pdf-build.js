// @ts-check

/**
 * Minimal PDF builder — creates a single-page PDF containing one image
 * scaled to fit an A4 page at native resolution.
 *
 * Supports optional alpha soft-mask and ICC color profiles.
 *
 * @module pdf-build
 */

const A4_W = 595.28;  // points
const A4_H = 841.89;

/**
 * @typedef {Object} PdfImageOpts
 * @property {number} width            pixel width
 * @property {number} height           pixel height
 * @property {number} bitsPerComponent
 * @property {string} colorSpace       fallback e.g. '/DeviceRGB' (used when no ICC)
 * @property {string} filter           e.g. '/FlateDecode', '/DCTDecode'
 * @property {Uint8Array} data         compressed image stream bytes
 * @property {Object} [decodeParms]    optional /DecodeParms dict entries
 * @property {Uint8Array|null} [alphaMask]   FlateDecode-compressed 8-bit grayscale mask
 * @property {Uint8Array|null} [iccProfile]  raw ICC profile bytes
 * @property {number} [iccN]           number of ICC color components (1/3/4)
 */

/**
 * Build a PDF file containing a single image on an A4 page.
 *
 * @param {PdfImageOpts} img
 * @returns {Uint8Array}
 */
export function buildPdf(img) {
  // Scale image to fit A4, maintaining aspect ratio
  const scaleX = A4_W / img.width;
  const scaleY = A4_H / img.height;
  const scale = Math.min(scaleX, scaleY);
  const dispW = img.width * scale;
  const dispH = img.height * scale;
  const offX = (A4_W - dispW) / 2;
  const offY = (A4_H - dispH) / 2;

  const hasAlpha = !!(img.alphaMask && img.alphaMask.length > 0);
  const iccN = img.iccN || 0;
  const hasIcc = !!(img.iccProfile && img.iccProfile.length > 0 && iccN > 0);
  const enc = new TextEncoder();

  // --- Assign object IDs ---
  let nextId = 0;
  const catalogId = ++nextId;  // 1
  const pagesId   = ++nextId;  // 2
  const pageId    = ++nextId;  // 3
  const imageId   = ++nextId;  // 4
  const contentsId = ++nextId; // 5
  const smaskId   = hasAlpha ? ++nextId : 0;
  const iccId     = hasIcc   ? ++nextId : 0;

  const objects = [];

  // Catalog
  objects.push(pdfObj(catalogId, `<< /Type /Catalog /Pages ${pagesId} 0 R >>`));

  // Pages
  objects.push(pdfObj(pagesId, `<< /Type /Pages /Kids [${pageId} 0 R] /Count 1 >>`));

  // Page
  const pageDict = `<< /Type /Page /Parent ${pagesId} 0 R ` +
    `/MediaBox [0 0 ${fmt(A4_W)} ${fmt(A4_H)}] ` +
    `/Contents ${contentsId} 0 R ` +
    `/Resources << /XObject << /Im0 ${imageId} 0 R >> >> >>`;
  objects.push(pdfObj(pageId, pageDict));

  // --- Image XObject ---
  let dpStr = '';
  if (img.decodeParms) {
    const entries = Object.entries(img.decodeParms)
      .map(([k, v]) => `/${k} ${typeof v === 'boolean' ? (v ? 'true' : 'false') : v}`)
      .join(' ');
    dpStr = ` /DecodeParms << ${entries} >>`;
  }

  const smaskRef = hasAlpha ? ` /SMask ${smaskId} 0 R` : '';

  // Color space: prefer ICCBased when available, else fall back to device
  const colorSpaceStr = hasIcc
    ? `[/ICCBased ${iccId} 0 R]`
    : img.colorSpace;

  const imgDict = `<< /Type /XObject /Subtype /Image ` +
    `/Width ${img.width} /Height ${img.height} ` +
    `/ColorSpace ${colorSpaceStr} ` +
    `/BitsPerComponent ${img.bitsPerComponent} ` +
    `/Filter ${img.filter}${dpStr}${smaskRef} ` +
    `/Length ${img.data.length} >>`;
  objects.push(pdfStream(imageId, imgDict, img.data));

  // Page content stream
  const drawCmd = `q ${fmt(dispW)} 0 0 ${fmt(dispH)} ${fmt(offX)} ${fmt(offY)} cm /Im0 Do Q`;
  const drawBytes = enc.encode(drawCmd);
  objects.push(pdfStream(contentsId, `<< /Length ${drawBytes.length} >>`, drawBytes));

  // Soft-mask (optional)
  if (hasAlpha && img.alphaMask) {
    const maskDict = `<< /Type /XObject /Subtype /Image ` +
      `/Width ${img.width} /Height ${img.height} ` +
      `/ColorSpace /DeviceGray /BitsPerComponent 8 ` +
      `/Filter /FlateDecode ` +
      `/Length ${img.alphaMask.length} >>`;
    objects.push(pdfStream(smaskId, maskDict, img.alphaMask));
  }

  // ICC profile stream (optional)
  if (hasIcc && img.iccProfile) {
    const alternate = iccN === 4 ? ' /Alternate /DeviceCMYK'
      : iccN === 1 ? ' /Alternate /DeviceGray'
      : ' /Alternate /DeviceRGB';
    const iccDict = `<< /N ${iccN}${alternate} ` +
      `/Length ${img.iccProfile.length} >>`;
    objects.push(pdfStream(iccId, iccDict, img.iccProfile));
  }

  // --- Assemble PDF ---
  const header = enc.encode('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n');

  let totalSize = header.length;
  for (const obj of objects) totalSize += obj.length;

  const offsets = [];
  let pos = header.length;
  for (const obj of objects) {
    offsets.push(pos);
    pos += obj.length;
  }

  const xrefStart = pos;
  const xrefLines = [`xref\n0 ${objects.length + 1}\n0000000000 65535 f \r\n`];
  for (const off of offsets) {
    xrefLines.push(String(off).padStart(10, '0') + ' 00000 n \r\n');
  }
  const trailer = `trailer\n<< /Size ${objects.length + 1} /Root ${catalogId} 0 R >>\n` +
    `startxref\n${xrefStart}\n%%EOF\n`;

  const xrefBytes = enc.encode(xrefLines.join('') + trailer);
  totalSize += xrefBytes.length;

  const pdf = new Uint8Array(totalSize);
  let offset = 0;
  pdf.set(header, offset); offset += header.length;
  for (const obj of objects) {
    pdf.set(obj, offset); offset += obj.length;
  }
  pdf.set(xrefBytes, offset);

  return pdf;
}

/**
 * Format a number to a reasonable precision for PDF
 * @param {number} n
 * @returns {string}
 */
function fmt(n) {
  return n % 1 === 0 ? String(n) : n.toFixed(2);
}

/**
 * Build a simple PDF object (no stream)
 * @param {number} id
 * @param {string} dict
 * @returns {Uint8Array}
 */
function pdfObj(id, dict) {
  return new TextEncoder().encode(`${id} 0 obj\n${dict}\nendobj\n`);
}

/**
 * Build a PDF stream object
 * @param {number} id
 * @param {string} dict
 * @param {Uint8Array} data
 * @returns {Uint8Array}
 */
function pdfStream(id, dict, data) {
  const enc = new TextEncoder();
  const head = enc.encode(`${id} 0 obj\n${dict}\nstream\n`);
  const tail = enc.encode(`\nendstream\nendobj\n`);
  const result = new Uint8Array(head.length + data.length + tail.length);
  result.set(head, 0);
  result.set(data, head.length);
  result.set(tail, head.length + data.length);
  return result;
}
