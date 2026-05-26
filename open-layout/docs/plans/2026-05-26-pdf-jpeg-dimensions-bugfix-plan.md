# Plan: Fix Generated PDF Image Metadata and Data Mismatch

This document outlines the plan to address the mismatch between the image size specified in the PDF metadata (`/Width` and `/Height` in `/Subtype /Image` XObject dictionaries) and the actual pixel dimensions of the image data for pass-through JPEG images.

## Problem Analysis
Currently, when embedding a JPEG image that does not exceed 300 DPI (or when VIPS is not available), the PDF generator falls back to the pass-through path:
```javascript
pdf.writeJpegXObject(imageObjId, buf, imgBox.width, imgBox.height);
```
Here, `imgBox.width` and `imgBox.height` represent the canvas layout bounds in PDF points, rather than the actual pixel resolution of the JPEG data in `buf`. This results in a metadata/data mismatch. PNG images are not affected because their dimensions are correctly retrieved via `decodePngToRgb()`.

## Proposed Solution
We will update `pdf-generator.js` to ensure the actual pixel dimensions of JPEG images are always passed to `pdf.writeJpegXObject`.

1. **VIPS Path**: If VIPS is initialized and active, we already have the correct `imgWidth` and `imgHeight` resolved from the image buffer. We will pass these directly.
2. **Wasm-Vips Fallback / Browser API Path**: If VIPS is not active or did not resolve dimensions, we will dynamically determine the JPEG's dimensions using the browser's native, highly efficient `createImageBitmap` API via a new helper function:
   ```javascript
   async function getJpegDimensions(jpegBytes) {
     const blob = new Blob([jpegBytes], { type: 'image/jpeg' });
     const bmp = await createImageBitmap(blob);
     const { width, height } = bmp;
     bmp.close();
     return { width, height };
   }
   ```
3. **Pass-through update**: Update the JPEG pass-through block to use the resolved pixel dimensions instead of `imgBox.width` / `imgBox.height`.

## Proposed Changes

### PDF Exporter

#### [MODIFY] [pdf-generator.js](file:///home/martino/git/scribus/open-layout/pdf-exporter/lib/pdf-generator.js)
- Add `getJpegDimensions(jpegBytes)` helper function.
- Modify the pass-through block to detect the actual width and height of the JPEG image and pass it to `pdf.writeJpegXObject()`.

## Verification Plan

### Automated Tests
- Run `npm test` to ensure unit tests are unaffected.
- Add an E2E Playwright test in `pdf-exporter.spec.js` that checks exported PDF metadata for a pass-through JPEG, or run E2E tests to ensure they continue to pass without regression.

### Manual Verification
- Generate a PDF with pass-through JPEG images and verify the generated PDF metadata (`/Width` and `/Height` in XObject stream) matches the original image resolution.
