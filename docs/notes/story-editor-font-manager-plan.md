# Standalone Font Manager Plan

## Goal

Add a standalone font manager module (outside `story-editor`) that can dynamically resolve and load CDN-hosted font binaries in formats HarfBuzz supports (TTF/OTF). It must exclude WOFF/WOFF2 support to ensure compatibility with the HarfBuzz-based shaper and layout engine. It should dynamically download the font list first, then download individual fonts on-demand.

**Constraint:** Use CDN-hosted ESM versions of all libraries; do not add dependencies to `package.json`.

## Scope

- `docs/font-manager/` (new module)
- `docs/font-manager/google-font-manager.js` (The core manager)
- `docs/font-manager/paragraph-font-style.js`
- `docs/font-manager/test/test-google-font-manager.js`

## Plan

1. **Discovery & Metadata:** Leverage existing tools for font metadata via CDN.
   - Use the **`google-webfonts-helper`** API (e.g., `https://gwfh.mranftl.com/api/fonts`) to discover direct download links.
   - **Strict Filtering:** Only include font variants that provide a `truetype` (TTF) or `opentype` (OTF) URL.
   - **Total Exclusion:** If a font family or a specific variant *only* offers WOFF/WOFF2 formats, it must be excluded from the manager's available list entirely.
   - Maintain a local registry of available families and their valid (TTF/OTF) variant-to-URL mappings.
2. **On-Demand Loading:** Add a mechanism to download font binaries (`ArrayBuffer`) only when a font is actually used in the editor.
   - Use standard `fetch()` or a CDN-hosted loader library (e.g., `google-fonts-file-loader` via `/+esm`) to retrieve binary data from the URLs discovered in the metadata.
   - Implement a simple cache to avoid re-downloading the same font.
3. **Integration Helpers:** Add `paragraph-style` helper with `fontFamily` field and normalization logic (mapping family + weight/style to specific URLs).
4. **Validation:** Add focused tests for metadata parsing, query building, and binary loading.
5. **Verify:** Verify with `node --test docs/font-manager/test/*.js`.

## Suggestion: Implementation Strategy

To satisfy the requirements efficiently without reinventing the wheel:

- **Metadata Source:** The **`google-webfonts-helper`** API (e.g., `https://gwfh.mranftl.com/api/fonts`) is ideal as it provides direct download links for all formats, including TTF, without requiring an API key. This avoids the need for a large metadata library.
- **Lazy Fetching:** The `GoogleFontManager` should expose an `async resolveFont(family, variant)` method. This method checks if the font list is loaded, finds the `.ttf` URL, and then performs a `fetch()` for the binary data.
- **HarfBuzz Integration:** Return the `Uint8Array` directly. This allows the editor to pass it into the HarfBuzz `createBlob` function without any conversion.
- **No WOFF/WOFF2:** When parsing the font list, look specifically for the `truetype` or `opentype` fields and discard any `woff` or `woff2` entries.

## Progress

- In progress.
- Updated discovery strategy to use Developer API v1 / google-webfonts-helper for TTF/OTF support.
- Refined plan to support dynamic list downloading and on-demand font fetching.
- Identified existing libraries (`google-fonts-helper`, `google-fonts-file-loader`) to accelerate implementation via CDN.
- Updated `AGENTS.md` with CDN-only mandate.
