# Streaming Downscale Demo — Tests, Refactor & OPFS Streaming Plan

**Date:** 2026-04-19
**Status:** Complete

## Motivation

The streaming-downscale-demo had no unit tests and several bugs identified
during code review:

1. **TIFF decoder bands<4 bug** — `bandjoin(255)` on a 1-band or 2-band image
   only adds one band, producing 2 or 3 bands instead of 4. Greyscale TIFFs
   would produce corrupt row data.
2. **JP2 decoder CMYK/RGBA ambiguity** — 4 components were unconditionally
   treated as CMYK. Standard RGBA JPEG2000 files would produce wrong colors.
3. **Duplicated pixel-conversion logic** — PNG, JP2, and color-management
   modules each had independent implementations of the same conversions
   (greyscale->RGBA, RGB->RGBA, CMYK->RGBA, 16-bit->8-bit, indexed->RGBA).
4. **Downscaler shared buffer undocumented** — `onOutputRow` reuses the same
   buffer on every call, a footgun for consumers.
5. **Typo** — "Excute" in tiff-decoder.js.
6. **Memory usage** — TIFF decode loaded the entire file into an ArrayBuffer
   before decoding. For multi-hundred-MB TIFFs this is impractical.
7. **Dead tiled code paths** — `onTile`, `drawTile`, and the `tiled` header
   branch were never reachable because wasm-vips emits scanlines via
   `TargetCustom` regardless of source TIFF layout.

## Phase 1: Unit Tests & Bug Fixes (complete)

### New files
- `lib/pixel-convert.js` — shared pixel-format conversion module
  - `rowToRGBA()` — converts any channel layout to RGBA 8-bit
  - `cmykRowToRGBA()` — CMYK to RGB conversion
  - `interpretComponents()` — disambiguates component count (fixes CMYK/RGBA)
- `test/test-format-detect.js` — 11 tests
- `test/test-color-management.js` — 8 tests
- `test/test-downscaler.js` — 10 tests (including shared-buffer documentation test)
- `test/test-png-stream.js` — 12 tests (crafts valid PNGs in-memory)
- `test/test-pixel-convert.js` — 24 tests (rowToRGBA, cmykRowToRGBA, interpretComponents)
- `test/test-tiff-decoder.js` — 11 tests (band normalization via mock vips API)

### Modified files
- `lib/png-stream.js` — replaced ~80-line inline conversion with `rowToRGBA()` call
- `lib/jp2-decoder.js` — replaced inline CMYK/RGB/greyscale conversion with
  `rowToRGBA()` + `interpretComponents()`. **Fixed:** 4-component images now
  default to RGBA; CMYK only when color space metadata says so.
- `lib/tiff-decoder.js` — rewrote `ensureRGBA()` to handle 1-band and 2-band
  images correctly. **Fixed:** greyscale TIFFs now produce 4-band RGBA.
  **Fixed:** typo "Excute" -> "Execute". Added try/finally cleanup for
  intermediate vips images.
- `lib/color-management.js` — now delegates to `pixel-convert.js` (backward
  compatible wrapper).
- `lib/downscaler.js` — added JSDoc documenting the shared-buffer contract.

## Phase 2: OPFS Streaming TIFF Decode (complete)

### Architecture

To avoid loading the entire TIFF into RAM, the decoder now uses an
OPFS-backed Web Worker pipeline:

1. **Main thread** streams the source (`ReadableStream` from `fetch()` or
   `File.stream()`) into an OPFS temp file via `FileSystemWritableFileStream`.
2. **Worker** (`lib/vips-worker.js`) opens the OPFS file with
   `createSyncAccessHandle()` (synchronous I/O, Worker-only API).
3. Worker creates a `vips.SourceCustom` with `onRead`/`onSeek` backed by
   the sync access handle — this satisfies wasm-vips's synchronous callback
   requirements.
4. Worker decodes with `Image.newFromSource(source, '', { access: 'sequential' })`.
5. Worker writes decoded RGBA via `TargetCustom` + `.raw`, emitting rows
   back to the main thread via `postMessage` with transferable buffers.
6. Main thread cleans up the OPFS temp file on completion or error.

**Fallback:** When OPFS/SharedArrayBuffer/Worker are unavailable, the decoder
falls back to the original in-memory `ArrayBuffer` path on the main thread.

### New files
- `lib/vips-worker.js` — Web Worker implementing the OPFS streaming decode

### Modified files
- `lib/tiff-decoder.js` — new public `decodeTiff(source, callbacks, opts)` API
  that accepts `ReadableStream | ArrayBuffer`; auto-selects streaming or
  buffer path; includes `streamToOPFS()`, `removeOPFSFile()`, `getWorker()`.
- `index.html` — local file TIFF path now passes `file.stream()` instead of
  `file.arrayBuffer()`; extracted `runTiffDecode()` helper to eliminate TIFF
  callback duplication; extracted `reassembleStream()` helper for URL path.

## Phase 3: Dead Code Removal & E2E Tests (complete)

### Dead code removed
- `renderer.js` — removed `drawTile()` method and its typedef
- `tiff-decoder.js` — removed `onTile` from `TiffCallbacks` typedef,
  removed `tiled` field from header
- `vips-worker.js` — removed `tiled` field from header message
- `index.html` — removed `onTile` callback, removed `if (header.tiled)`
  branch from `runTiffDecode`

### E2E tests (Playwright)
- `test/streaming-downscale.spec.js` — 11 tests covering:
  - Initial page state
  - Scale slider interaction
  - File/URL input mutual exclusion
  - Error handling (no input, bad URL)
  - PNG decode via local file (4x4 red, 8x8 checkerboard)
  - Pixel-accurate downscale verification (uniform red, checkerboard average)
  - PNG decode via URL fetch
  - Stop button behavior
  - No console errors during decode

### Test fixtures
- `test/fixture-4x4-red.png` — uniform red 4x4 RGBA PNG
- `test/fixture-8x8-checker.png` — red/blue checkerboard 8x8 RGBA PNG

## Verification

```
npm test
# 354 unit tests, 0 failures

npx playwright test streaming-downscale-demo/test/streaming-downscale.spec.js
# 11 E2E tests, 0 failures
```

Playwright tests were run. Console logs were checked via terminal output.
One expected `BROWSER [error]` from the intentional 404 fetch test.
No unexpected console errors found.

## Phase 4: Downscale Performance Fix (complete)

### Problem

`image.resize(1/scale)` uses Lanczos3 interpolation which requires a large
vertical context window (multiple rows above and below). This defeats
`access: sequential` mode — vips must load the entire image into memory to
satisfy the kernel's vertical lookups. The user reported no speedup from
Worker-side downscaling.

### Fix

Replaced `image.resize(1/scale)` with `image.shrink(scale, scale)`.

`shrink()` uses simple box averaging with integer reduction factors. It only
needs exactly `scale` input rows buffered at a time, which is fully compatible
with sequential access. For a 4x downscale this means 4 rows buffered instead
of the entire image.

### Modified files
- `lib/vips-worker.js` — replaced `resize(1/scale)` with `shrink(scale, scale)`

### Verification

```
npm test
# 354 unit tests, 0 failures

npm run test:e2e
# 153 passed, 1 failed (unrelated: document-store asset count mismatch
# from pre-existing data change in store/alice/brochure-q2/assets/)
# All 11 streaming-downscale-demo tests passed.
```

Playwright tests were run. Console logs were checked via terminal output.
No unexpected console errors found in streaming-downscale-demo tests.

## Phase 5: Pyramid-Aware Thumbnail Decode (complete)

### Problem

Even with `shrink()`, large pyramidal TIFFs like CMU-1.tiff (46,000 x 32,000,
195 MB) were slow because the Worker decoded the full-resolution level first,
then box-averaged down. For a 4x downscale, this means decompressing ~4.4 GB
of raw pixels from the highest-resolution pyramid level.

### Fix

Replaced `newFromSource() + ensureRGBA() + shrink()` with `thumbnailSource()`
when scale > 1. `thumbnailSource()` is pyramid-aware:

1. Opens the TIFF and discovers sub-IFD pyramid levels
2. Picks the smallest level still larger than the target width
3. Loads only that level (skipping the full-resolution data entirely)
4. Shrinks the rest of the way to the target width

For CMU-1.tiff at 4x downscale (target ~11,500px wide), vips picks a pyramid
level that's close to that size instead of decoding all 46,000 columns.

### Architecture

The Worker now has two code paths:
- `decodeWithThumbnail()` — scale > 1: header-only open to get source dims,
  then `thumbnailSource(source, targetWidth, { size: 'down' })`, then
  `ensureRGBA()` and `emitRows()`.
- `decodeFullResolution()` — scale = 1: `newFromSource` with sequential
  access, `ensureRGBA()`, `emitRows()`.

Helper functions extracted:
- `createOPFSSource(accessHandle, fileSize)` — creates a seekable
  `SourceCustom` backed by an OPFS sync access handle. Returns
  `{ source, getPosition, resetPosition }`.
- `emitRows(outputImage, outWidth, outHeight)` — writes raw RGBA via
  `TargetCustom`, batches rows, sends via `postMessage` with transfer.

### Modified files
- `lib/vips-worker.js` — replaced monolithic `decodeFromOPFS` with
  `decodeWithThumbnail` + `decodeFullResolution` + shared helpers

### Verification

```
npm test
# 354 unit tests, 0 failures

npm run test:e2e
# 153 passed, 1 failed (unrelated: document-store asset count mismatch)
# All 11 streaming-downscale-demo tests passed.
```

Playwright tests were run. Console logs were checked via terminal output.
No unexpected console errors found in streaming-downscale-demo tests.

## Remaining Work

None — all planned items complete.
