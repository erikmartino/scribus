# GlyphCluster

A `GlyphCluster` represents one or more glyphs that map to one or more input characters. It is the fundamental unit produced by the shaping phase and consumed by the layout engine.

Defined in `scribus/text/glyphcluster.h`, with implementation in `scribus/text/glyphcluster.cpp`.

## Fields

| Field | Type | Description |
|-------|------|-------------|
| `m_style` | `const CharStyle*` | Pointer to the character style (font, size, color, etc.) |
| `m_flags` | `LayoutFlags` | Bitfield: `DropCap`, `HyphenationPossible`, `StartOfLine`, `SuppressSpace`, etc. |
| `m_glyphs` | `QList<GlyphLayout>` | One or more shaped glyphs with advances and offsets |
| `m_firstChar` | `int` | Index of the first source character in `StoryText` |
| `m_lastChar` | `int` | Index of the last source character in `StoryText` |
| `m_visualIndex` | `int` | 0-based position in visual (display) order; set during shaping to `result.glyphs().length()` at creation time (`textshaper.cpp:436`). Used by `ShapedTextFeed::putInVisualOrder()` to sort clusters from logical to visual order for BiDi text. |
| `m_scaleH` | `double` | Horizontal scale factor (default 1.0, modified by justification) |
| `m_scaleV` | `double` | Vertical scale factor (default 1.0) |
| `m_str` | `QString` | Original source characters |
| `extraWidth` | `double` | Extra width added by the justification algorithm |
| `xoffset` | `double` | Horizontal offset |
| `yoffset` | `double` | Vertical offset |

### GlyphLayout (individual glyph within a cluster)

Defined in `scribus/sctextstruct.h:120`.

| Field | Type | Description |
|-------|------|-------------|
| `glyph` | `uint` | Glyph ID in the font |
| `xadvance` | `float` | Horizontal advance width (points) |
| `yadvance` | `float` | Vertical advance (points) |
| `xoffset` | `float` | Horizontal offset from pen position (points) |
| `yoffset` | `float` | Vertical offset from pen position (points) |
| `scaleH` | `double` | Horizontal scale |
| `scaleV` | `double` | Vertical scale |

## Example: Ligature (many-to-one)

Consider the word **"ffi"** in the input text "office" set in 12pt Garamond. The three characters `f`, `f`, `i` (character indices 2, 3, 4 in the story) may be merged by HarfBuzz into a single **ffi ligature**. This produces one `GlyphCluster`:

```
GlyphCluster {
    m_style:       → CharStyle { font: "Garamond", size: 12pt, color: black }
    m_flags:       ScLayout_None
    m_firstChar:   2          // index of 'f' in StoryText
    m_lastChar:    4          // index of 'i' in StoryText
    m_visualIndex: 3          // 0-based position in visual (display) order;
                               // differs from logical order for BiDi text
    m_scaleH:      1.0
    m_scaleV:      1.0
    m_str:         "ffi"      // original characters
    extraWidth:    0.0        // added later by justification
    xoffset:       0.0
    yoffset:       0.0

    m_glyphs: [               // only ONE glyph — the ligature
        GlyphLayout {
            glyph:    0x0587   // glyph ID for the "ffi" ligature in the font
            xadvance: 14.4     // advance width in points
            yadvance: 0.0
            xoffset:  0.0
            yoffset:  0.0
            scaleH:   1.0
            scaleV:   1.0
        }
    ]
}
```

## Key Points

- **Many-to-one mapping**: 3 input characters (`f`, `f`, `i`) → 1 output glyph (the ligature). `firstChar`/`lastChar` span the original character range.
- **One-to-many is also possible**: A single Unicode character like "ö" in some fonts could produce 2 glyphs (base `o` + combining diaeresis), resulting in a cluster with `firstChar == lastChar` but two entries in `m_glyphs`.
- **Layout modifies the cluster**: During justification, the layout engine may adjust `extraWidth` (to widen spaces) or `m_scaleH` (to compress/expand glyphs). These fields start at their defaults after shaping and are written during the layout phase.
