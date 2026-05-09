# PDF Exporter Module Plan

## Goal

Create a `pdf-exporter` module that loads a document from the store and
streams a downloadable PDF one page at a time. Images are fetched and
written to the stream on demand, never held in memory all at once.

## Library Evaluation

### Option A — `svg2pdf.js` + `jsPDF`

| | |
|---|---|
| **Streaming** | ✗ — builds entire document in memory |
| **Image streaming** | ✗ |
| **ESM** | ✗ — jsPDF is UMD only |
| **License** | MIT ✓ |

### Option B — `pdf-lib`

| | |
|---|---|
| **Streaming** | ✗ — `pdfDoc.save()` returns the full bytes at once |
| **Image streaming** | ✗ — images embedded upfront |
| **ESM** | ✓ |
| **License** | MIT ✓ |

### Option C — `PDFKit` (Node streaming library with browser build)

| | |
|---|---|
| **Streaming** | ✓ — chunk-based output via piped streams |
| **Image streaming** | Partial — images must still be `Buffer` objects |
| **ESM** | ✗ — UMD only, no clean CDN ESM build |
| **Own layout** | ✗ — would conflict with HarfBuzz positioning |
| **License** | MIT ✓ |

### Option D — Write our own streaming PDF generator ✅

| | |
|---|---|
| **Streaming** | ✓ — `ReadableStream` of `Uint8Array` chunks, one page at a time |
| **Image streaming** | ✓ — fetch each image at page-render time, write to stream, then GC |
| **ESM** | ✓ — we write it |
| **License** | MIT / project license ✓ |
| **Flexibility** | Maximum — bleeds, marks, ICC, spot colours all achievable |
| **Dependencies** | Zero |

> [!IMPORTANT]
> **Recommendation: Option D — write our own streaming PDF generator.**
>
> Every library either builds the document in memory before writing or
> requires managing the whole image set upfront. Since the streaming and
> per-image memory constraint is a hard requirement, the cleanest solution
> is a small, focused PDF writer. The PDF format is straightforward for
> our use case (text + raster images), and we already have all the data
> in exactly the right form from HarfBuzz.

---

## PDF Streaming Strategy

PDF allows objects to appear in any order before the cross-reference
table at the end. We exploit this:

```
%PDF-1.4 header
[font stream objects — written once at start]
for each page:
  fetch image(s) for this page → write as XObject stream → free
  write content stream (text operators)
  write page dictionary
[Pages dictionary]
[Catalog]
[xref table — byte offsets accumulated during write]
%%EOF
```

Each step emits a `Uint8Array` chunk into a `ReadableStream`. The
browser can download via `StreamSaver` pattern
(`showSaveFilePicker()` + `WritableStream`) or fall back to buffering
for small documents.

### PDF text operators used

```
BT          % begin text block
  /F0 20 Tf % select font + size
  x y Tm    % position (y flipped: pdf_y = pageH - svg_y)
  (text) Tj % show string
ET          % end text
```

### Image handling

- **JPEG images**: pass through using `/DCTDecode` — zero re-encoding,
  zero color-space conversion.
- **PNG images**: decoded via `createImageBitmap()` + `OffscreenCanvas`,
  raw RGBA bytes deflated with `CompressionStream` and embedded as
  `/DeviceRGB` XObject.
- **TIFF images (including CMYK)**: decoded using `wasm-vips` (already
  in the vendor cache from `streaming-downscale-demo`).
  - **CMYK TIFFs** are extracted as raw 4-channel bytes and embedded
    directly as a `/DeviceCMYK` image XObject with `/FlateDecode` — no
    color-space conversion, preserving the original CMYK values for
    print-accurate output.
  - **RGB TIFFs** follow the same path as PNG.
  - `wasm-vips` is loaded lazily, only when a TIFF frame is encountered,
    so documents without TIFFs pay no loading cost.

> [!NOTE]
> Embedding CMYK data directly in PDF is only possible with a custom PDF
> writer. This is a key reason why the DIY approach (Option D) is the
> right choice — no existing browser PDF library exposes this level of
> image colorspace control.

---

## Proposed Architecture

### Renamed Module: `doc-renderer` (formerly `svg-exporter`)

The `svg-exporter` module will be renamed to `doc-renderer` to reflect its expanded role. It will serve as the core orchestration pipeline that feeds into multiple rendering backends:
- **SVG Backend**: Used for live rendering and editing in the browser.
- **PDF Backend**: Used for exporting high-fidelity documents to print.

#### [RENAME/MODIFY] `doc-renderer/lib/layout-document.js` (formerly `svg-generator.js`)
Acts as the central orchestrator that produces a complete **intermediate layout format** (representing layout boxes, image frames, and text runs).
- **No Duplicate Styling Logic**: All styling resolution (e.g., font family, weight, italics, colors) is performed exactly once during this step. The intermediate representation holds the *final computed styling data* so both the SVG renderer and the PDF exporter can consume it directly without duplicating the interpretation of story styles.

#### [NEW] `doc-renderer/lib/svg-renderer.js`
Extract the SVG generation logic out of the old `svg-generator.js` into a dedicated SVG backend. This module takes the intermediate layout format from `layout-document.js` and serializes it into SVG DOM nodes for the browser.

### New Module: `pdf-exporter`

#### [NEW] [pdf-writer.js](file:///Users/martino/git/scribus/open-layout/pdf-exporter/lib/pdf-writer.js)

Low-level streaming PDF primitive.

- `PdfWriter` class wraps a `ReadableStream` controller.
- Tracks byte offset as it emits chunks.
- Methods: `writeHeader()`, `beginObject(id)`, `endObject()`,
  `writeFontStream(id, ttfBytes)`, `writeContentStream(id, ops)`,
  `writeImageXObject(id, jpegBytes, w, h)`, `writePage(id, ...)`,
  `writeXref()`, `writeTrailer()`.

#### [NEW] [pdf-generator.js](file:///Users/martino/git/scribus/open-layout/pdf-exporter/lib/pdf-generator.js)

High-level PDF backend. Imports `layoutDocument` (or the intermediate layout orchestrator) from the `doc-renderer` module and `PdfWriter`.

- `streamDocument(engine, docPath, opts)` → `ReadableStream`.
- Per spread/page loop:
  1. Call `layoutDocument()` to get the intermediate layout object for the pages.
  2. Extract font subsetting data directly from the text runs in the intermediate format.
  3. Fetch each image URL (only images on this page, sequentially).
  4. Write image XObjects to stream → let GC collect the data.
  5. Walk the intermediate layout boxes (text frames, image frames), emitting corresponding PDF operators.
  6. Write page dictionary and move to next page.

#### [NEW] [index.html](file:///Users/martino/git/scribus/open-layout/pdf-exporter/index.html)

- `?doc=` param, defaults to `demo/typography-sampler`.
- "Download PDF" button calls `streamDocument()`.
- Uses `showSaveFilePicker()` if available, else falls back to
  accumulating the stream into a Blob for a standard `<a download>`.
- Progress indicator (page N of total).

---

## Verification Plan

### Automated Tests
- Playwright test navigates to `/pdf-exporter/?doc=demo/typography-sampler`.
- Clicks "Download PDF" and intercepts the generated blob/download.
- Confirms the blob starts with `%PDF` and has non-zero size.
- During development, use a validator (for example, `/usr/bin/verapdf`) against the exported files to ensure structural correctness and valid syntax.

### Manual Verification
- Open the generated PDF in a PDF viewer and confirm:
  - Text is selectable and searchable.
  - Fonts render as EB Garamond.
  - Page geometry matches the spread editor.
  - (If image frames exist) images render correctly.
