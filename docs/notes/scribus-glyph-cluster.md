# GlyphCluster in Scribus

`GlyphCluster` is the shaped-text unit connecting source characters to positioned glyph output.

Defined in `scribus/text/glyphcluster.h`.

## Concept

A cluster may map:
- many characters -> one glyph (ligature), or
- one character -> many glyphs (combining marks).

Each cluster stores:
- source character span (`firstChar`/`lastChar`),
- glyph list (`GlyphLayout` entries with advances/offsets),
- style pointer,
- flags (line/layout hints),
- visual-order index,
- justification-adjusted width/scale fields.

## Why It Matters

Layout and editing logic operate on clusters, not raw characters, because:
- line width comes from glyph advances,
- hit testing/caret positioning must resolve clicks inside ligatures,
- justification modifies cluster-level metrics.

## Editing/Hit-Testing Implication

For a ligature cluster (e.g. `ffi`), Scribus uses grapheme-aware subdivision when mapping x-coordinates back to character positions. This gives deterministic caret positions even when multiple characters share one glyph.

## Practical Summary

If you need accurate cursoring, selection painting, or line metrics in complex text, `GlyphCluster` is the minimum trustworthy unit between shaping and layout.
