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
3. **Integration with `story-editor`:**
   - **Style Updates:** Update `CharacterStyle` in `style.js` to include an optional `fontFamily` field.
   - **Dynamic Registry:** Replace or wrap `FontRegistry` with a version that:
     - Asynchronously loads fonts via `GoogleFontManager` when a new `fontFamily` is encountered.
     - Maintains a cache of HarfBuzz font handles (`hb_font_t`) indexed by `family:variant`.
     - Automatically registers `@font-face` in the browser to keep SVG rendering in sync.
   - **Shaper Refactor:** Update `shaper.js` to handle `async` font resolution. Since shaping is currently synchronous, this might require pre-loading fonts during the layout phase.
   - **Layout Engine Integration:** 
     - Update `LayoutEngine.shapeParagraphs` to identify all required font families in the story.
     - Add an `async ensureFonts(story)` method to `LayoutEngine` to pre-fetch and register all font binaries before the (synchronous) shaping and line-breaking passes begin.

## Architectural Suggestion: Async Font Pre-loading

To maintain the performance of the synchronous shaping loop while supporting dynamic loading:

1. **Discovery Pass:** Before layout, scan the `Story` (runs) and `ParagraphStyle` arrays for unique `fontFamily` values.
2. **Parallel Load:** Trigger `Promise.all(families.map(f => registry.load(f)))`.
3. **Sync Shaping:** Once all promises resolve, proceed with the standard synchronous `renderToContainer` pipeline.
4. **Placeholder/Fallback:** If a font is still loading, the `FontRegistry` should return a fallback (e.g., the default "EB Garamond") to prevent the editor from hanging, then trigger a re-render once the font is ready.

## Progress

- [x] Initial research and plan updates.
- [x] Updated `AGENTS.md` with CDN-only mandate.
- [x] Implemented `GoogleFontManager` in `docs/font-manager/google-font-manager.js`.
- [x] Implemented normalization helpers in `docs/font-manager/paragraph-font-style.js`.
- [x] Added tests in `docs/font-manager/test/test-google-font-manager.js`.
- [x] Verified with `node --test`.
- [ ] Integration with `story-editor`.
  - [ ] Update `style.js` and `paragraph-style.js`.
  - [ ] Implement `DynamicFontRegistry`.
  - [ ] Add font pre-loading to `LayoutEngine`.
