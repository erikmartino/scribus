# Scribus Text Layout Algorithm

## Architecture Overview

The Scribus text layout system processes text in five phases (documented in `scribus/text/design.txt`):

1. **Storage** — Unicode text with character and paragraph styles (`StoryText`)
2. **Itemizing** — Breaking text into runs of consistent language, script, font, and style
3. **Shaping** — Converting characters to glyphs using HarfBuzz and font metrics
4. **Layout** — Breaking glyphs into lines and stacking lines to fill columns/frames
5. **Rendering** — Drawing glyphs to screen or PDF

---

## Key Classes and Files

| Component | File | Purpose |
|-----------|------|---------|
| `StoryText` | `scribus/text/storytext.h` | Stores Unicode text with style partitions |
| `TextShaper` | `scribus/text/textshaper.h` | Itemizes and shapes text via HarfBuzz |
| `ShapedText` | `scribus/text/shapedtext.h` | Holds shaped glyph clusters for a text range |
| `GlyphCluster` | `scribus/text/glyphcluster.h` | A cluster of glyphs mapping to one or more characters |
| `TextLayout` | `scribus/text/textlayout.h` | Manages the physical layout (box tree) of a frame |
| `GroupBox` / `LineBox` / `GlyphBox` / `ObjectBox` | `scribus/text/boxes.h` | TeX-inspired box hierarchy for rendering |
| `PageItem_TextFrame` | `scribus/pageitem_textframe.cpp` | Frame-level layout driver |
| `LineControl` | `scribus/pageitem_textframe.cpp:354–935` | Line-level state machine |
| `ITextSource` | `scribus/text/itextsource.h` | Abstract text + style access |
| `ITextContext` | `scribus/text/itextcontext.h` | Abstract frame context (dimensions, preferences) |
| `ShapedTextFeed` | `scribus/text/shapedtextfeed.h` | Lazy shaping wrapper with caching |

---

## Phase 1–2: Storage and Itemizing

`StoryText` holds the full Unicode text of a story (which may span multiple linked frames). It maintains two parallel partitions:

- **Character styles** — font, size, color, tracking, scale, etc.
- **Paragraph styles** — alignment, indents, spacing, tabs, hyphenation settings, etc.

When layout is triggered, `TextShaper::shape()` itemizes the text into runs by:

1. **BiDi level** (lines 45–74 of `textshaper.cpp`) — using Unicode Bidirectional Algorithm
2. **Script** (lines 76–110) — Unicode script property
3. **Style** (lines 137–169) — character style changes
4. **OpenType features** (lines 112–135) — feature tag changes

Each run is then passed to HarfBuzz for shaping, producing `GlyphCluster` arrays stored in `ShapedText` objects.

---

## Phase 3: Shaping

The shaping phase produces `GlyphCluster` objects — the fundamental unit connecting input characters to output glyphs. See [glyph-cluster.md](glyph-cluster.md) for a detailed description with field reference and examples.

Shaped results are cached per-paragraph in `ShapedTextCache` (inside `StoryText`). Only edited paragraphs are re-shaped, which is critical for performance in long documents.

---

## Phase 4: Layout — The Main Algorithm

Layout is driven by `PageItem_TextFrame::layout()` (line ~1166 of `pageitem_textframe.cpp`). The algorithm is a **greedy, single-pass line breaker** — it fills each line as full as possible before breaking, without global optimization across lines (unlike the Knuth-Plass algorithm used in TeX).

### Entry Point

```
PageItem_TextFrame::layout()
```

1. Validates previous frames in the chain (linked frames share one `StoryText`).
2. Calculates the available region by subtracting text-wrapping objects.
3. Sets up column geometry (left/right boundaries, gap).
4. Iterates through shaped glyph clusters via `ShapedTextFeed`.

### The Line-Breaking Loop

```cpp
for (i = 0; shapedText.haveMoreText(i, glyphClusters); ++i)
```

For each glyph cluster:

1. **Accumulate** the cluster's width into the current line (`current.xPos`).
2. **Record break opportunities** when encountering:
   - Expanding spaces → `current.rememberBreak(i, breakPos)`
   - Hyphenation points (flagged during shaping) → break with hyphen width added
   - Explicit hyphens or dashes
3. **Check if line is full:**
   ```cpp
   if ((current.isEndOfLine(style.rightMargin() + hyphWidth))
       || current.isEndOfCol(realDesc)
       || SpecialChars::isBreak(ch, m_columns > 1)
       || (current.xPos - current.maxShrink + hyphWidth) >= current.mustLineEnd)
   ```
4. **If full**, use the best recorded break point:
   - If a break was recorded → break there
   - If no break was recorded → force-break at the previous cluster
5. **Finalize the line**: apply justification, create a `LineBox`, add it to the layout tree.
6. **Start a new line** and continue.

### LineControl State Machine

`LineControl` (lines 354–935) tracks all state for the line currently being built:

- `xPos`, `yPos` — current pen position
- `colLeft`, `colRight` — column boundaries
- `breakIndex`, `breakXPos` — best break point found so far
- `maxShrink`, `maxStretch` — available justification range
- `glyphs` — accumulated glyph clusters
- `lineData` — a `LineSpec` with final metrics (x, y, width, ascent, descent)

Key methods:
- `startLine(firstCluster)` — reset for a new line
- `rememberBreak(index, pos)` — record a candidate break point
- `breakLine(last)` — finalize break at a given cluster
- `isEndOfLine(margin)` / `isEndOfCol(descent)` — boundary checks
- `nextColumn(layout)` — advance to next column or frame
- `justifyLine(style)` — distribute whitespace for justified text

---

## Text Flow Around Objects

1. `calcAvailableRegion()` (line ~1288) computes a `QRegion` by subtracting the shapes of all text-wrapping objects (respecting layer order and master pages).
2. During the line-breaking loop, each glyph cluster is tested against this region via `regionContainsRect()`.
3. If a cluster falls inside an object's exclusion zone:
   - The algorithm finds the actual overflow position.
   - It backtracks to the best break point before the object.
   - It adjusts `mustLineEnd` to the object boundary and retries.
4. An `afterOverflow` flag handles cases where text can resume after passing an object.

---

## Justification Algorithm

`LineControl::justifyLine()` (lines 710–869) distributes space for justified text using a **multi-priority strategy**:

| Priority | Action |
|----------|--------|
| 1 | Shrink inter-word spaces; extend glyphs to minimum ratio |
| 2 | Extend glyphs up to maximum ratio |
| 3 | Insert implicit CJK spacing; extend inter-word spaces |
| 4 | Apply letter spacing (tracking) |

The algorithm calculates natural widths (glyph advances + space advances), determines how much space needs to be added or removed, then distributes it according to the priority chain. Each glyph cluster receives a `scaleH` multiplier and/or `extraWidth` addition.

---

## Hyphenation

- Hyphenation points are identified during the shaping phase and flagged on glyph clusters with `ScLayout_HyphenationPossible`.
- During line breaking, if a cluster has this flag, the algorithm calculates the width including a hyphen glyph:
  ```cpp
  hyphWidth = font.hyphenWidth(charStyle, size) * (charStyle.scaleH() / 1000.0);
  ```
- The break is only recorded if the consecutive-hyphen limit (`style.hyphenConsecutiveLines()`) has not been exceeded.

---

## Paragraph Features

### Drop Caps
- The first glyph of a paragraph is enlarged to span `dropCapLines()` lines.
- Its height is calculated from the combined line heights.
- Subsequent lines have their left margin adjusted to wrap around the drop cap.

### Baseline Grid
- When `FLOPBaselineGrid` is set, line positions snap to the document's baseline grid spacing.
- Line spacing is overridden by the grid interval.

### Line Spacing Modes
- **Automatic** — percentage of font height
- **Fixed** — absolute spacing value
- **Baseline grid** — document grid spacing

### Orphan and Widow Control
- `adjustParagraphEndings()` enforces `keepLinesStart()` (orphans) and `keepLinesEnd()` (widows).
- `moveLinesFromPreviousFrame()` can pull lines from the previous linked frame to satisfy constraints.

### Optical Margins
- `ParagraphStyle::OM_RightHangingPunct` allows punctuation to extend past the right margin.
- Applied as a `rightHang` offset when evaluating break positions.

---

## Columns and Linked Frames

### Columns
- A single text frame can have multiple columns (`m_columns`).
- `LineControl::nextColumn()` advances `colLeft` and `colRight` boundaries.
- `SpecialChars::COLBREAK` forces a jump to the next column.

### Linked Frames
- Frames form a doubly-linked chain via `m_backBox` (previous) and `m_nextBox` (next).
- They share a single `StoryText`.
- When a frame fills up, remaining text overflows to the next frame in the chain.
- `SpecialChars::FRAMEBREAK` forces overflow to the next frame.
- `layout()` recursively validates previous frames if they are dirty.

---

## Special Features

### Tabs
- A `TabControl` structure manages tab stops.
- Supported types: left, center, right, and decimal alignment.
- Tab leaders (fill characters) are inserted after layout via `fillInTabLeaders()`.

### Embedded Objects
- Inline frames are treated as single glyph clusters.
- They are scaled to fit the available line width.
- They participate in line breaking like any other cluster.

### CJK Support
- Implicit spacing is inserted between CJK and Latin characters.
- CJK fence (punctuation) positioning is handled via layout flags set during shaping.

### RTL and BiDi
- Bidirectional text is resolved during itemizing (BiDi levels from ICU/Unicode algorithm).
- Column positions are mirrored for RTL layout.

---

## Caching Strategy

| Cache | Scope | Invalidation |
|-------|-------|--------------|
| `ShapedTextCache` | Per-paragraph in `StoryText` | On text edit within that paragraph |
| `TextLayout` boxes | Per-frame | On text change, frame resize, or style change |
| `ShapedTextFeed` | Per-layout pass | Lazily shapes as layout consumes glyphs |

---

## Box Model (Rendering Tree)

The layout produces a TeX-inspired box tree:

```
GroupBox (frame)
 ├── LineBox (line 1)
 │    ├── GlyphBox (run of glyphs)
 │    ├── GlyphBox (run of glyphs)
 │    └── ObjectBox (inline frame)
 ├── LineBox (line 2)
 │    └── GlyphBox (run of glyphs)
 └── ...
```

- `GroupBox` — container for lines (one per column or frame)
- `LineBox` — a single typeset line with position and metrics
- `GlyphBox` — a run of glyphs to be drawn together
- `ObjectBox` — an inline embedded object

This tree is used for rendering, hit testing, cursor positioning, and coordinate mapping.

---

## Summary

Scribus uses a **greedy, single-pass line-breaking algorithm** with sophisticated extensions for professional typesetting. It does not use global optimization (Knuth-Plass), but compensates with a multi-priority justification engine, comprehensive style support (drop caps, optical margins, baseline grids), robust text-flow-around-objects handling, and aggressive caching for performance. The architecture cleanly separates storage, shaping, layout, and rendering into distinct subsystems connected through abstract interfaces.
