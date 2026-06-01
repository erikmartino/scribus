# Implementation Plan: Correct PDF Glyph Metrics and Ligature Rendering

**Date:** 2026-06-01  
**Status:** In Progress  

## Context
When exporting a document to PDF (such as `/pdf-exporter/index.html?doc=alice/typography-sampler`), the rendered text spacing and alignment can be incorrect. In particular:
1. Standard PDF `TrueType` fonts do not include a `/Widths`, `/FirstChar`, or `/LastChar` array in their font dictionary. According to the PDF specification, these are required for non-standard fonts so that PDF viewers can measure and space characters correctly.
2. Ligatures (like `fi`, `fl`, `ff`, `ffi`, `ffl`) are shaped into single glyphs by HarfBuzz, but if the PDF viewer doesn't know their correct metrics or if they are improperly mapped, the subsequent characters overlap or collide with them.
3. Subsetting might discard ligature glyphs if they are not explicitly included, or if the PDF Differences encoding is not aligned with the subsetted font's actual glyphs and widths.

## Objectives
1. Implement dynamic calculation of the `/Widths` array for subsetted TrueType fonts by shaping characters at `fontSize = 1000` via HarfBuzz in JavaScript. This will provide the exact design-unit widths of all characters (from ASCII 32 to ligature 244).
2. Modify `PdfWriter.writeTrueTypeFont` to accept and write `/FirstChar`, `/LastChar`, and `/Widths` in the generated PDF `/Font` object.
3. Ensure that ligature codepoints are correctly preserved during TrueType font subsetting.
4. Run Playwright E2E and unit tests to verify regression-free operation.
5. Solve spacing/overlap for unmapped cursive ligatures (like `th`, `sh` etc.) in script fonts by dynamically scaling coordinate advances based on character widths to match the PDF reader's fallback rendering.

## Proposed Changes

### 1. `pdf-exporter/lib/pdf-writer.js`
- Modify `writeTrueTypeFont` signature to accept `widths`, `firstChar`, and `lastChar` parameters.
- If `widths` is provided, emit `/FirstChar`, `/LastChar`, and `/Widths [...]` inside the TrueType `/Font` dictionary object.

### 2. `pdf-exporter/lib/pdf-generator.js`
- In `_generatePdf`, when writing subsetted font objects, dynamically calculate the `widths` array using the HarfBuzz shaper:
  - Loop character codes `C` from `32` to `244`.
  - For standard ASCII (32-239), shape `String.fromCharCode(C)`.
  - For custom ligatures (240-244), shape the corresponding ligature string (`fi`, `fl`, `ff`, `ffi`, `ffl`).
  - Shape each string at `fontSize = 1000` using `engine._shaper.shapeRun`.
  - Collect the summed advance (`g.ax`) for each glyph to form the `widths` array.
  - Cache the calculated widths in the `fontMap` so they can be retrieved.
- Pass this `widths`, `firstChar = 32`, and `lastChar = 244` to `writeTrueTypeFont`.
- In the rendering loop of `pdf-generator.js`, if a shaped ligature is not one of the mapped 5 ligatures (so it renders as separate standard characters in the PDF viewer):
  - Compute its printed width as the scaled sum of individual standard character widths.
  - Advance the position counter by this adjusted width instead of `g.ax`, ensuring there are no collisions with subsequent text.

### 3. Verification & Testing
- Run all existing unit tests (`npm test`).
- Update `test-pdf-writer.js` to assert that `writeTrueTypeFont` emits the correct `/Widths`, `/FirstChar`, and `/LastChar` when provided.
- Run Playwright E2E tests (`npx playwright test`) to ensure everything is functional and verify that PDF generation is successful.

## Remaining Work
- [x] Update `pdf-writer.js` to support `/Widths`, `/FirstChar`, and `/LastChar`.
- [x] Update `pdf-generator.js` to calculate widths at `fontSize = 1000` and pass them to `writeTrueTypeFont`.
- [x] Update `test-pdf-writer.js` to verify `/Widths` emissions.
- [x] Implement spacing adjustment for unmapped cursive ligatures in `pdf-generator.js` and save the widths in the map.
- [x] Execute `npm test` and Playwright tests to verify the changes.
