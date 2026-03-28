# Scribus Text Layout Algorithm

## Overview

Scribus text layout can be understood as five phases:

1. **Storage** (`StoryText`) - Unicode text plus style partitions.
2. **Itemizing** - split ranges by script, BiDi level, style, and OpenType features.
3. **Shaping** - HarfBuzz converts characters to glyph clusters.
4. **Layout** - greedy line breaking and box construction.
5. **Rendering** - draw boxes/glyphs to screen or PDF.

The core loop is intentionally greedy (single-pass), with richer behavior layered in via hyphenation, justification priorities, optical margins, and frame/column flow.

## Key Components

- `StoryText` (`scribus/text/storytext.h`) - source text + styles.
- `TextShaper` (`scribus/text/textshaper.h`) - itemize + shape.
- `GlyphCluster` (`scribus/text/glyphcluster.h`) - shaped cluster unit.
- `TextLayout` and box classes (`scribus/text/textlayout.h`, `scribus/text/boxes.h`) - physical layout tree.
- `PageItem_TextFrame::layout()` (`scribus/pageitem_textframe.cpp`) - frame-level layout driver.
- `LineControl` (`scribus/pageitem_textframe.cpp`) - line state machine.

## Line Breaking Model

`PageItem_TextFrame::layout()` fills each line left-to-right (or visual-order equivalent), tracking candidate break points while accumulating cluster widths.

Break opportunities include:
- spaces,
- hyphenation-possible clusters,
- explicit break characters,
- forced constraints (column/frame boundaries).

When overfull:
- if a remembered break exists, break there,
- otherwise force-break near current position.

Then Scribus finalizes line metrics, applies justification strategy, emits `LineBox`, and continues.

## What Makes It Production-Grade

- Text flow around object exclusion regions.
- Multi-priority justification (space and glyph adjustments).
- Hyphenation constraints (including consecutive hyphen rules).
- Paragraph-level features (drop caps, baseline grid, orphan/widow handling, optical margins).
- Multi-column and linked-frame overflow handling.
- Per-paragraph shaping cache and layout invalidation rules.

## Box Tree

Layout outputs a TeX-like tree:

- `GroupBox` (container)
- `LineBox` (line)
- `GlyphBox` (glyph runs)
- `ObjectBox` (inline objects)

This same structure supports rendering, hit testing, and caret/selection mapping.

## Practical Takeaway

Scribus does not use global Knuth-Plass optimization; it uses a greedy algorithm plus strong local heuristics and constraints, which keeps behavior predictable while still covering professional layout needs.
