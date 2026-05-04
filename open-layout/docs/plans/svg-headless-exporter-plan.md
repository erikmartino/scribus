# SVG Headless Exporter Plan

Extract the SVG generation logic from `spread-editor` into a dedicated, reusable module (`svg-exporter`) that can render documents from the store into a sequence of per-page SVGs.

## Goal

Create a standalone SVG generation pipeline that is decoupled from the interactive editor UI. This will allow for headless rendering (for printing/export) and can be shared with other modules (like a future PDF converter).

## Proposed Changes

### 1. New Module: `svg-exporter`

#### [NEW] [svg-generator.js](file:///Users/martino/git/scribus/open-layout/svg-exporter/lib/svg-generator.js)
A pure module (no UI) that orchestrates document loading and SVG rendering.
- `renderDocument(docPath)`:
  - Fetches `document.json`, spreads, and stories using `document-store` lib.
  - For each spread:
    - Computes layout (using `spread-geometry.js`).
    - Runs `LayoutEngine` to get line positions across all text frames.
    - Slices the results into individual pages.
    - Generates one `<svg>` per page.
- Handles coordinate transformation: converts spread-space coordinates to page-relative coordinates for the export.

#### [NEW] [index.html](file:///Users/martino/git/scribus/open-layout/svg-exporter/index.html)
A viewer page for the exporter.
- Uses `URLSearchParams` to get the `?doc=` path.
- Calls `renderDocument()` and displays the resulting SVGs in a vertical list.
- Minimal styling (consistent with the app-shell theme).

### 2. SvgRenderer Enhancements (story-editor)

#### [MODIFY] [svg-renderer.js](file:///Users/martino/git/scribus/open-layout/story-editor/lib/svg-renderer.js)
- Ensure the `render()` method is flexible enough to be used outside of the live editor (i.e., not assuming it's being called from an active `SpreadEditorApp` instance).

## Verification Plan

### Automated Tests
- Create a new Playwright test `test/svg-exporter.spec.js` that:
  - Navigates to `/svg-exporter/?doc=demo/typography-sampler`.
  - Verifies that multiple SVGs are rendered (one per page).
  - Checks for the presence of specific text content in the SVGs.

### Manual Verification
- Open `http://localhost:8000/svg-exporter/?doc=demo/typography-sampler` and visually confirm the output matches the spread editor's rendering, but split into individual pages.
