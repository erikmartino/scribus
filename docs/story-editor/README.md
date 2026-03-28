# Story Editor — Browser-Based Text Layout Prototype

A standalone HTML/JavaScript prototype that reimplements the core of the Scribus text layout pipeline in the browser. It uses HarfBuzz WASM for text shaping, renders to SVG, and supports an interactive cursor with sub-glyph ligature positioning.

Open `index.html` in a browser. No build step required.

## Purpose

Scribus is a C++ desktop publishing application. Its text engine — spanning `StoryText`, `TextShaper`, `PageItem_TextFrame::layout()`, and a box tree renderer — is large and tightly coupled to Qt, FreeType, and Cairo. This prototype isolates the fundamental pipeline (**itemize by style, shape with HarfBuzz, break lines, justify, render**) in ~800 lines of JavaScript so the algorithm can be studied, modified, and tested without compiling C++.

## Pipeline

```
DOM sample text
      |
  text-extract.js      Extract style runs from HTML: { text, style }[]
      |
  hyphenator.js         Insert soft hyphens (U+00AD) via Knuth-Liang patterns
      |
  shaper.js             Shape each run with HarfBuzz WASM -> glyph stream
      |
  line-breaker.js       Greedy single-pass line breaking (space / soft-hyphen breaks)
      |
  justifier.js          Distribute extra space across inter-word gaps
      |
  positions.js          Build per-character cursor positions (sub-glyph hack for ligatures)
      |
  svg-renderer.js       Emit SVG <text> elements, one per line
      |
  cursor.js             Blinking caret, click placement, arrow-key navigation
```

`layout-engine.js` orchestrates the full pipeline. `font-registry.js` loads fonts and registers `@font-face` entries so HarfBuzz and browser metrics match.

## Data Model

**Story** — a two-level array: paragraphs containing style runs.

```js
story[paraIndex] = [
  { text: "The efficacy of ", style: { bold: false, italic: false } },
  { text: "fine typography",  style: { bold: false, italic: true  } },
  ...
]
```

**Cursor position** — two integers plus a line disambiguator: `{ paraIndex, charOffset, lineIndex }`. This mirrors Scribus's `StoryText` model: flat character addressing with styles as metadata.

**lineMap** — produced by layout, one entry per rendered line. Each entry contains a `positions` array of `{ charPos, x }` pairs mapping original-text offsets to pixel coordinates. The last entry in `positions` is always the right edge of the line.

## Key Implementation Details

**Font handling.** A variable font (EB Garamond) is loaded once per axis file (upright + italic). Bold uses `font.setVariations({ wght: 700 })` on the same binary. The raw buffer is also registered as `@font-face` so browser rendering and HarfBuzz measurement use identical metrics.

**Shaping.** Each style run is shaped separately via HarfBuzz WASM. Cluster indices (`cl`) are offset per run to produce a unified glyph stream for the whole paragraph. Ligatures (fi, fl, ffi, ffl) emerge naturally from OpenType features.

**Line breaking.** A greedy single-pass algorithm. As glyphs accumulate, break opportunities at spaces and soft hyphens are recorded. When the line overflows, the best recorded break is used. This matches the Scribus algorithm (also greedy, not Knuth-Plass).

**Justification.** On non-final lines, the total word width is subtracted from the available width and the remainder is divided equally among inter-word gaps. Scribus uses a multi-priority strategy (space shrink, glyph extension, CJK spaces, letter spacing); this prototype implements only the first.

**Sub-glyph cursor positioning.** A ligature glyph covers multiple source characters. `positions.js` divides each ligature's advance equally among its source characters, producing one cursor position per character even inside ligatures. This is the same "sub-glyph hack" used in Scribus's canvas cursor.

**Multi-column flow.** Text flows from a first box into a second when lines exceed the first box's height — equivalent to Scribus's linked text frames. Box geometry is controlled by sliders.

## Mapping to Scribus C++

| This prototype | Scribus |
|---|---|
| `text-extract.js` | `TextShaper::itemizeStyles()` |
| `shaper.js` | `TextShaper` + per-run `hb_shape()` calls |
| `line-breaker.js` | `PageItem_TextFrame::layout()` line-fill loop |
| `justifier.js` | Justification pass in `layout()` (multi-priority) |
| `positions.js` | `GlyphCluster` sub-glyph division |
| `svg-renderer.js` | `ScreenPainter` + box tree (`LineBox` / `GlyphBox`) |
| `cursor.js` | `CanvasMode_Edit` cursor overlay |
| `story-position.js` | `StoryText` cursor addressing |
| `font-registry.js` | `SCFonts` / `ScFace` registry |

## Files

| File | Lines | Role |
|---|---|---|
| `index.html` | 348 | Entry point, controls, sample text |
| `lib/layout-engine.js` | 212 | Orchestrator — load, shape, flow, render |
| `lib/text-extract.js` | 60 | DOM to style runs |
| `lib/shaper.js` | 74 | HarfBuzz shaping |
| `lib/hyphenator.js` | 22 | Soft-hyphen insertion |
| `lib/line-breaker.js` | 62 | Greedy line breaking |
| `lib/justifier.js` | 85 | Word-space justification |
| `lib/positions.js` | 117 | Cursor position building |
| `lib/svg-renderer.js` | 113 | SVG output + lineMap construction |
| `lib/story-position.js` | 182 | Cursor navigation, hit testing |
| `lib/cursor.js` | 135 | Blinking caret, click/key handlers |
| `lib/font-registry.js` | 65 | Font loading + @font-face registration |
