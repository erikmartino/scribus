# Asset Upload Plan

Date: 2026-04-19

Status: Active implementation.

## Goal

When images are dropped or pasted in the spread editor, upload them to the
document store as proper assets (separate files under `assets/`) instead of
embedding data URLs inline in the spread JSON. Align with the spec's
`assetRef` convention.

## Changes

### 1. Server: HEAD method for store paths

Add `HEAD` support to `handleStoreRequest()` so clients can check if a file
exists before uploading. Returns 200 with `Content-Length` if file exists,
404 if not. No body.

### 2. Client: `putAsset()` and `headAsset()` in document-store.js

- `putAsset(url, blob, contentType)` — PUT binary data to a store path.
  Returns the Response.
- `headAsset(url)` — HEAD request to check existence. Returns `{ exists, size }`.
- `uploadImageAsset(docPath, name, blob, meta)` — High-level helper that:
  1. HEAD checks if `assets/{name}/{name}.{ext}` exists
  2. If exists, appends a numeric suffix to avoid overwriting
  3. PUTs the image file
  4. PUTs `meta.json` with dimensions, MIME, size
  5. Returns the `assetRef` (folder name)

### 3. Spread editor: upload on drop/paste, save with assetRef

- When an image is dropped or pasted AND the editor has a `_docPath` (loaded
  from store), upload it as an asset and store `assetRef` on the box instead
  of `imageUrl`.
- When no `_docPath` exists (standalone mode), keep the data URL behavior.
- `_serializeSpread()` writes `assetRef` for uploaded assets, `imageUrl`
  for data-URL-only images.
- `_loadFromStore()` resolves `assetRef` to a URL:
  `/store/{docPath}/assets/{assetRef}/{assetRef}.{ext}` (extension from
  meta.json).

### 4. Backward compatibility

- Loading: accept both `imageUrl` (data URL) and `assetRef` (store path).
- Saving: prefer `assetRef` when available, fall back to `imageUrl`.
- The existing brochure-q2 example already uses `assetRef`.

## Files affected

- `server.js` — HEAD method
- `document-store/lib/document-store.js` — `putAsset`, `headAsset`, `uploadImageAsset`
- `spread-editor/app/spread-editor-app.js` — upload on drop/paste, serialize/load
- `document-store/test/test-document-store.js` — unit tests for new functions
- `spread-editor/test/doc-save.spec.js` or new test file — E2E tests
