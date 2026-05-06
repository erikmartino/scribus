// test-pdf-writer.js — unit tests for PdfWriter
// Run with:  npm test  (Node built-in test runner)
//
// PdfWriter has no DOM dependency so all tests run in Node.
// CompressionStream is available in Node >= 18.

import { test } from 'node:test';
import assert from 'node:assert/strict';

// We need ReadableStream + TextEncoder available in Node >=18 (global).
// CompressionStream is also global in Node >=18.

// Dynamic import so Node can parse the ESM module
const { PdfWriter, standardFontForStyle, textOp, imageOp } =
  await import('../lib/pdf-writer.js');

// ---------------------------------------------------------------------------
// Helper: drain a ReadableStream into a single Buffer
// ---------------------------------------------------------------------------

async function drain(stream) {
  const chunks = [];
  const reader = stream.getReader();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks);
}

// ---------------------------------------------------------------------------
// PdfWriter tests
// ---------------------------------------------------------------------------

test('writeHeader emits %PDF-1.4', async () => {
  const pdf = new PdfWriter(595, 841);
  pdf.writeHeader();
  // Manually close xref so the stream ends (minimal valid structure)
  pdf.writeXref(0, 0);
  const buf = await drain(pdf.stream);
  assert.ok(buf.toString('ascii').startsWith('%PDF-1.4'), 'should start with %PDF-1.4');
});

test('writeStandardFont emits a /Font dictionary object', async () => {
  const pdf = new PdfWriter(595, 841);
  pdf.writeHeader();
  pdf.writeStandardFont(1, 'FT', 'Times-Roman');
  pdf.writeXref(0, 1);
  const buf = await drain(pdf.stream);
  const text = buf.toString('latin1');
  assert.ok(text.includes('/Type /Font'), 'should contain /Type /Font');
  assert.ok(text.includes('/Times-Roman'), 'should contain /Times-Roman');
  assert.ok(text.includes('1 0 obj'), 'should start object 1');
  assert.ok(text.includes('endobj'), 'should close object');
});

test('writeContentStream emits correct /Length', async () => {
  const pdf = new PdfWriter(595, 841);
  pdf.writeHeader();
  const ops = 'BT /FT 12 Tf 100 700 Td (Hello) Tj ET\n';
  const expectedLen = Buffer.from(ops, 'utf-8').length;
  pdf.writeContentStream(1, ops);
  pdf.writeXref(0, 1);
  const buf = await drain(pdf.stream);
  const text = buf.toString('latin1');
  assert.ok(text.includes(`/Length ${expectedLen}`), `should contain /Length ${expectedLen}`);
  assert.ok(text.includes('stream\n'), 'should contain stream keyword');
  assert.ok(text.includes('endstream'), 'should contain endstream');
});

test('writePageDict emits /Type /Page with /Parent reference', async () => {
  const pdf = new PdfWriter(595, 841);
  pdf.writeHeader();
  pdf.writePageDict(1, {
    parentRef: 2,
    contentRef: 3,
    width: 595,
    height: 841,
    fontRefs: [{ alias: 'FT', id: 4 }],
    imageRefs: [],
  });
  pdf.writeXref(0, 1);
  const buf = await drain(pdf.stream);
  const text = buf.toString('latin1');
  assert.ok(text.includes('/Type /Page'), 'should contain /Type /Page');
  assert.ok(text.includes('/Parent 2 0 R'), 'should reference parent tree');
  assert.ok(text.includes('/Contents 3 0 R'), 'should reference content stream');
  assert.ok(text.includes('/FT 4 0 R'), 'should reference font');
});

test('writeXref byte offsets match actual object positions', async () => {
  const pdf = new PdfWriter(595, 841);
  pdf.writeHeader();
  pdf.writeStandardFont(1, 'FT', 'Times-Roman');
  pdf.writeXref(0, 1);
  const buf = await drain(pdf.stream);
  const text = buf.toString('latin1');

  // Find the offset recorded in the xref table for object 1
  // xref entry format: "0000000NNN 00000 n "
  // The free-entry line contains 'f' so we match it with [^\n]+ instead of [\d ]+
  const xrefMatch = text.match(/xref\n0 2\n[^\n]+\n(\d{10}) 00000 n /);
  assert.ok(xrefMatch, 'should have xref entry for object 1');
  const recordedOffset = parseInt(xrefMatch[1], 10);

  // The actual position of "1 0 obj" in the buffer
  const actualOffset = buf.indexOf(Buffer.from('1 0 obj'));
  assert.equal(recordedOffset, actualOffset, 'xref offset should match actual object position');
});

test('round-trip: minimal 1-page PDF is valid structure', async () => {
  const pdf = new PdfWriter(595, 841);
  pdf.writeHeader();
  pdf.writeStandardFont(1, 'FT', 'Times-Roman');
  pdf.writeContentStream(2, 'BT /FT 12 Tf 72 769 Td (Hello PDF) Tj ET\n');
  pdf.writePageDict(3, {
    parentRef: 4,
    contentRef: 2,
    width: 595,
    height: 841,
    fontRefs: [{ alias: 'FT', id: 1 }],
    imageRefs: [],
  });
  pdf.writePageTree(4, [3], 595, 841);
  pdf.writeCatalog(5, 4);
  pdf.writeXref(5, 5);

  const buf = await drain(pdf.stream);
  const text = buf.toString('latin1');

  assert.ok(buf.length > 300, `should be >300 bytes, got ${buf.length}`);
  assert.ok(text.startsWith('%PDF-1.4'), 'should start with %PDF-1.4');
  assert.ok(text.includes('%%EOF'), 'should end with %%EOF');
  assert.ok(text.includes('startxref'), 'should contain startxref');
  assert.ok(text.includes('/Type /Catalog'), 'should contain Catalog');
  assert.ok(text.includes('/Type /Pages'), 'should contain Pages tree');
  assert.ok(text.includes('(Hello PDF)'), 'should contain text content');
});

// ---------------------------------------------------------------------------
// Helper function tests
// ---------------------------------------------------------------------------

test('standardFontForStyle returns correct variants', () => {
  assert.equal(standardFontForStyle({}).pdfName,                    'Times-Roman');
  assert.equal(standardFontForStyle({ bold: true }).pdfName,        'Times-Bold');
  assert.equal(standardFontForStyle({ italic: true }).pdfName,      'Times-Italic');
  assert.equal(standardFontForStyle({ bold: true, italic: true }).pdfName, 'Times-BoldItalic');
  assert.equal(standardFontForStyle({}, 'Helvetica').pdfName,       'Helvetica');
});

test('textOp produces valid BT...ET block', () => {
  const op = textOp('Hello', 'FT', 12, 72, 769);
  assert.ok(op.includes('BT'), 'should start with BT');
  assert.ok(op.includes('ET'), 'should end with ET');
  assert.ok(op.includes('/FT 12.00 Tf'), 'should set font');
  assert.ok(op.includes('72.00 769.00 Td'), 'should set position');
  assert.ok(op.includes('(Hello) Tj'), 'should show text');
});

test('textOp escapes PDF special characters', () => {
  const op = textOp('(test)', 'FT', 12, 0, 0);
  assert.ok(op.includes('(\\(test\\))'), 'should escape parentheses');
});

test('imageOp produces valid q/cm/Do/Q block', () => {
  const op = imageOp('Im0', 10, 20, 200, 100);
  assert.ok(op.includes('q\n'), 'should save graphics state');
  assert.ok(op.includes('/Im0 Do'), 'should invoke XObject');
  assert.ok(op.includes('Q\n'), 'should restore graphics state');
  assert.ok(op.includes('200.00 0 0 100.00 10.00 20.00 cm'), 'should set transform');
});
