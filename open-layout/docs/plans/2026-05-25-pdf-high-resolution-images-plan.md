# PDF High Resolution Image Printing and Downscaling

This implementation plan outlines the steps required to generate high-resolution print PDFs using original source files (such as TIFF images), check their placed DPI, and downscale them strictly to a maximum of 300x300 DPI when necessary, using the `wasm-vips` library.

## User Review Required

> [!IMPORTANT]
> - Original assets (like raw TIFF files) are fetched directly from `/store/${docPath}/assets/${assetRef}/` using their metadata.
> - If an image's placed DPI exceeds 300, it is dynamically downscaled using `wasm-vips`.
> - Images that are not natively supported by PDF or are too large are encoded as ZIP-compressed raster streams (`/Filter /FlateDecode`), which is the PDF equivalent of a compressed TIFF.

## Proposed Changes

### PDF Exporter

#### [MODIFY] [pdf-generator.js](file:///Users/martino/git/scribus/open-layout/pdf-exporter/lib/pdf-generator.js)
- Integrate dynamic `wasm-vips` initialization through the server-side vendor proxy (`/vendor/wasm-vips/vips-es6.js`).
- Update `_generatePdf` to:
  1. Retrieve the original image asset if `imgBox.assetRef` is specified by first fetching `meta.json` to get the correct mime/extension, then fetching the original file.
  2. Fallback to `imgBox.imageUrl` (the preview JPEG) if fetching the original asset fails or `assetRef` is absent.
  3. Load the image into `wasm-vips` to inspect its pixel dimensions.
  4. Calculate the placed resolution (DPI):
     - `dpiX = (width / imgBox.width) * 72`
     - `dpiY = (height / imgBox.height) * 72`
  5. Check if the image requires downscaling (either `dpiX > 300` or `dpiY > 300`) or is a format not natively supported by PDF (e.g., TIFF, WebP).
  6. If downscaling or format conversion is required:
     - Calculate scale factor: `scale = Math.min((imgBox.width * (300 / 72)) / image.width, (imgBox.height * (300 / 72)) / image.height)`.
     - Downscale the image if `scale < 1`.
     - Convert color space to sRGB and cast to `uchar` (grayscale or RGB).
     - Extract raw buffer using `writeToMemory()`, compress it via `deflate()` (using `CompressionStream`), and embed it as a `/FlateDecode` XObject.
  7. If the image is JPEG/PNG and has DPI <= 300, bypass decoding/re-encoding and embed it directly for maximum performance.
  8. Ensure proper try-catch handlers and `image.delete()` cleanup of intermediate WASM image resources to prevent memory leaks.

## Verification Plan

### Automated Tests
- Extend the Playwright E2E suite to export `demo/typography-sampler` containing the `vintage-press.tif` high-resolution asset.
- Run `npm test` to verify unit tests.
- Run `npm run test:e2e` to verify full PDF export flow.

### Manual Verification
- Load `/pdf-exporter/?doc=demo/typography-sampler` in the browser, export the PDF, and verify that `vintage-press.tif` is embedded in high resolution and downscaled to 300 DPI.
