# StoryText

`StoryText` is the core in-memory container for all text and styling in a text frame or chain of linked frames.

Defined in `scribus/text/storytext.h:74`, implemented in `scribus/text/storytext.cpp`.

## Class Overview

```
class StoryText : public QObject, public SaxIO, public ITextSource
```

StoryText holds:
- A sequence of Unicode characters
- Parallel partitions tracking character styles, paragraph styles, and embedded objects
- A default paragraph style
- Cursor position and selection state

## Internal Data: ScText_Shared

The actual data lives in `ScText_Shared` (`scribus/text/sctext_shared.h:17`), a reference-counted `QList<ScText*>`:

```cpp
class ScText_Shared : public QList<ScText*> {
    uint refs { 1 };
    // default style, cursor, selection, marks count
};
```

StoryText uses copy-on-write semantics. The copy constructor shares the underlying data (`d->refs++`), and assignment decrements/increments reference counts. A deep copy is available via `StoryText::copy()`.

## Ownership: PageItem → StoryText

Every `PageItem` owns a StoryText instance directly (`pageitem.h:1385`):

```cpp
StoryText itemText;
```

## Linked Text Frames (Text Chains)

Text frames form a doubly-linked chain via `m_backBox` and `m_nextBox` pointers on `PageItem` (`pageitem.h:1721–1722`).

When frames are linked (`pageitem.cpp:1187`), all frames in the chain **share the same `ScText_Shared`** via reference-counted assignment:

```cpp
while (nxt) {
    nxt->itemText = itemText;  // shares underlying data
    nxt = nxt->m_nextBox;
}
```

Each frame tracks `firstChar` and `m_maxChars` to know which slice of the shared story it displays. There is one story's worth of data across the entire chain, not one per frame.

## Serialization: .sla File Format

Only the **head frame** of a chain (where `BACKITEM == -1`) writes the `<StoryText>` XML block. Subsequent frames store `NEXTITEM`/`BACKITEM` references to their neighbors.

### XML Structure

```xml
<PAGEOBJECT ... BACKITEM="-1" NEXTITEM="42">
  <StoryText>
    <DefaultStyle PARENT="Default Paragraph Style" />
    <ITEXT CH="Some text here" FONT="Garamond" FONTSIZE="12" />
    <para PARENT="Heading 1" />
    <ITEXT CH="More text" FONT="Garamond" FONTSIZE="12" />
    <tab />
    <ITEXT CH="after tab" />
    <breakframe />
  </StoryText>
</PAGEOBJECT>
```

### Element Types

| Element | Meaning |
|---------|---------|
| `<DefaultStyle>` | Default paragraph style for the story |
| `<ITEXT>` | A run of text with consistent character style attributes |
| `<para>` | Paragraph boundary with paragraph style |
| `<tab>` | Tab character |
| `<breakline>` | Line break |
| `<breakcol>` | Column break |
| `<breakframe>` | Frame break |
| `<MARK>` | Anchored mark |
| `<item>` | Embedded inline object |

### Save

`Scribus170Format::writeStoryText()` (`scribus170format_save.cpp:1853`) iterates through StoryText characters, emitting `<ITEXT>` runs whenever the character style changes and `<para>` elements at paragraph boundaries.

### Load

The loader (`scribus170format.cpp`) deserializes `<StoryText>` content into each head frame's `itemText`. After all items are loaded, it reconstructs chains by calling `link()` on frame pairs using the saved `NEXTITEM`/`BACKITEM` IDs — which triggers the reference-counted sharing of StoryText data across the chain.

## Relationship to Layout

StoryText is the input to the text layout pipeline:

1. `TextShaper` reads characters and styles from StoryText (via the `ITextSource` interface)
2. Shaping produces `GlyphCluster` arrays (see [glyph-cluster.md](glyph-cluster.md))
3. The layout engine in `PageItem_TextFrame::layout()` consumes shaped clusters and produces the box tree (see [text-layout-algorithm.md](text-layout-algorithm.md))

StoryText caches shaped results per-paragraph in `ShapedTextCache` and signals `changed(int firstItem, int endItem)` when text is modified, so only affected paragraphs are re-shaped and re-laid-out.
