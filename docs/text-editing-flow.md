# Text Editing Flow: From Input Event to Screen Update

This document traces what happens when a user interacts with a text frame in Scribus — clicking to place a cursor, typing characters, selecting text — all the way from the OS event to pixels on screen.

## Overview

The flow passes through five layers:

1. **Event dispatch** — Qt delivers mouse/keyboard events to the canvas
2. **Mode handling** — `CanvasMode_Edit` interprets events as text editing operations
3. **Data modification** — `StoryText` is updated (cursor move, text insert, selection change)
4. **Layout invalidation & recalculation** — the frame's layout is marked dirty, then lazily rebuilt
5. **Rendering** — the box tree is painted and the cursor/selection are drawn

---

## 1. Event Dispatch

All input events arrive at `Canvas`, a QWidget (`canvas.h:49`). The canvas delegates them to the active `CanvasMode`. When a text frame is being edited, the active mode is **`CanvasMode_Edit`** (`canvasmode_edit.h:34`).

Key event methods on `CanvasMode_Edit`:
- `mousePressEvent(QMouseEvent*)` — `canvasmode_edit.cpp:559`
- `mouseMoveEvent(QMouseEvent*)` — `canvasmode_edit.cpp:427`
- `mouseDoubleClickEvent(QMouseEvent*)` — `canvasmode_edit.cpp`
- `keyPressEvent(QKeyEvent*)` — `canvasmode_edit.cpp:84`

---

## 2. Mouse Click → Cursor Placement

When the user clicks inside a text frame:

### 2a. Click received

`CanvasMode_Edit::mousePressEvent()` (`canvasmode_edit.cpp:559`):
- Converts the global mouse position to canvas coordinates (line 577)
- Retrieves the current text frame via `GetItem(&currItem)` (line 603)
- Calls `m_view->slotSetCurs(x, y)` to position the cursor (line 651)

### 2b. Hit testing

`ScribusView::slotSetCurs(int x, int y)` (`scribusview.cpp:1501`):
- Converts screen coordinates to canvas coordinates (line 1514)
- Checks the click is inside the frame via `Canvas::frameHitTest()` (line 1531)
- Ensures layout is valid: `if (textFrame->invalid) textFrame->layout()` (line 1534)
- Converts the point to a character index (line 1536):
  ```cpp
  int textPosition = textFrame->textPositionFromPoint(canvasPoint);
  ```
- Sets the cursor: `textFrame->itemText.setCursorPosition(textPosition)` (line 1561)

### 2c. Point-to-position conversion

`PageItem_TextFrame::textPositionFromPoint()` (`pageitem_textframe.cpp:5090`):
- Applies the frame's inverse transform to get frame-local coordinates (line 5102)
- Delegates to `textLayout.pointToPosition(point)` (line 5110)

`TextLayout::pointToPosition()` (`textlayout.cpp:363`):
- Walks the box hierarchy: **GroupBox → LineBox → GlyphBox**
- Each box checks whether the point falls within its bounds
- `GlyphBox` calculates the exact character index from the x-coordinate within the glyph cluster

### 2d. Hit testing inside ligatures and multi-character clusters

When a click lands on a ligature (e.g. an "ffi" glyph that covers 3 source characters), the single glyph must be resolved to one of the original character positions. This is handled by `GlyphBox::pointToPosition()` (`boxes.cpp:761`).

The algorithm:

1. **Count grapheme clusters**: Uses ICU's `BreakIterator` to count how many grapheme clusters the original characters span. For "ffi" that's 3 (`f`, `f`, `i`).

2. **Divide the glyph width equally**:
   ```cpp
   double componentWidth = width() / count;  // e.g. 14.4pt / 3 = 4.8pt
   ```
   Each source character gets an equal fraction of the ligature's width. This is an approximation — it does not try to estimate the "true" width of each component within the ligature.

3. **Find which slice the click falls in**: Iterates through the equal-width slices, checking if the click x-coordinate is within each one (mirrored for RTL text).

4. **Left-half vs right-half**: Within each slice, checks whether the click is in the left or right half:
   - **Left half** → cursor goes *before* the character (returns `firstChar + i`)
   - **Right half** → cursor goes *after* the character (returns `firstChar + i + 1`)

**Example**: An "ffi" ligature 14.4pt wide at x=100, with `firstChar=2`:

| Click x | Slice | Half | Returned position |
|---------|-------|------|-------------------|
| 101.0 | `f` (100–104.8) | left | 2 (before first `f`) |
| 103.5 | `f` (100–104.8) | right | 3 (between `f` and `f`) |
| 106.0 | `f` (104.8–109.6) | left | 3 (before second `f`) |
| 108.5 | `f` (104.8–109.6) | right | 4 (between `f` and `i`) |
| 111.0 | `i` (109.6–114.4) | left | 4 (before `i`) |
| 113.0 | `i` (109.6–114.4) | right | 5 (after `i`) |

For the **simple case** where `firstChar == lastChar` (a single-character cluster), the same left-half/right-half logic applies but over the entire glyph width.

---

## 3. Key Press → Text Insertion

When the user types a character:

### 3a. Key event received

`CanvasMode_Edit::keyPressEvent()` (`canvasmode_edit.cpp:84`):
- Escape exits edit mode (line 92)
- Retrieves the text frame via `GetItem(&currItem)` (line 100)
- Delegates to the frame: `currItem->handleModeEditKey(e, m_keyRepeat)` (line 133)

### 3b. Character handling

`PageItem_TextFrame::handleModeEditKey()` (`pageitem_textframe.cpp:3809`):

For **special keys** (lines 3878–4360):
- Arrow keys — move cursor position in StoryText
- Delete (line 4236) / Backspace (line 4294) — remove characters
- Enter — insert paragraph separator

For **regular characters** (lines 4360–4519):
- If text is selected, delete it first: `deleteSelectedTextFromFrame()` (line 4383)
- Insert the character: `itemText.insertChars(uc, true)` (line 4465)
- Mark layout as dirty: `invalid = true` (line 4485)
- Request repaint: `update()` (line 4507)

### 3c. StoryText modification

`StoryText::insertChars()` (`storytext.h:131`):
- Inserts characters at the current cursor position
- Applies the neighbouring character style if requested
- Emits the `changed(int firstItem, int endItem)` signal (`storytext.h:313`)

---

## 4. Layout Invalidation and Recalculation

### 4a. Signal-driven invalidation

The `changed` signal is connected at construction time (`pageitem_textframe.cpp:99`):
```cpp
connect(&itemText, SIGNAL(changed(int,int)),
        this, SLOT(slotInvalidateLayout(int,int)));
```

`slotInvalidateLayout()` (`pageitem_textframe.cpp:3039`):
- Finds the first frame in the chain (line 3041)
- Walks forward through linked frames, setting `invalid = true` on each frame from the affected point onward (lines 3054–3059)

### 4b. Lazy layout recalculation

Layout is **not** recalculated immediately. Instead, it happens lazily when the frame next needs to draw itself.

`PageItem_TextFrame::DrawObj_Item()` (`pageitem_textframe.cpp:3079`):
```cpp
if (invalid)
    layout();
```

This means layout work is deferred until the paint event, avoiding redundant recalculations if multiple edits happen before the next frame.

### 4c. The layout() method

`PageItem_TextFrame::layout()` (`pageitem_textframe.cpp:1173`):
- Clears the previous layout: `textLayout.clear()` (line 1234)
- Runs the line-breaking algorithm (see [text-layout-algorithm.md](text-layout-algorithm.md))
- Builds the box tree: GroupBox → LineBox → GlyphBox
- Sets `invalid = false` when done
- Updates `firstChar` and `m_maxChars` for linked frame overflow

---

## 5. Rendering

### 5a. Paint event

`Canvas::paintEvent()` (`canvas.cpp:806`):
- Updates the off-screen buffer via `fillBuffer()` (line 838)
- Calls `drawControls()` for mode-specific overlays (line 868)

### 5b. Text frame drawing

`PageItem_TextFrame::DrawObj_Item()` (`pageitem_textframe.cpp:3079`):
- Ensures layout is valid (calls `layout()` if needed)
- Creates a `ScreenPainter` (line 3469)
- Renders background: `textLayout.renderBackground(&painter)` (line 3472)
- Renders text: `textLayout.render(&painter, this)` (line 3473)

### 5c. Box hierarchy rendering

The render call walks the box tree:

| Class | Method | What it does |
|-------|--------|-------------|
| `GroupBox` | `render()` (`boxes.cpp:84`) | Iterates child LineBoxes |
| `LineBox` | `render()` (`boxes.cpp:234`) | Iterates child GlyphBoxes/ObjectBoxes |
| `GlyphBox` | `render()` (`boxes.cpp:588`) | Sets font, size, colors from CharStyle; draws glyphs; applies underline/strikethrough/overline |

`ScreenPainter` (`screenpainter.h:17`) is the concrete `TextLayoutPainter` that draws to the Qt `ScPainter` surface via `drawGlyph()`, `drawLine()`, `drawRect()`.

---

## 6. Cursor (Caret) Rendering

The cursor is drawn as a canvas overlay, separate from the text frame's content.

### 6a. Blink timer

`CanvasMode_Edit` creates a `QTimer` that fires every 200ms (`canvasmode_edit.cpp:60–61`):
```cpp
m_blinker = new QTimer(view);
connect(m_blinker, SIGNAL(timeout()), this, SLOT(blinkTextCursor()));
```

Started when entering edit mode (`canvasmode_edit.cpp:321`), stopped when leaving (line 344).

### 6b. Drawing the cursor

`CanvasMode_Edit::drawControls(QPainter* p)` (`canvasmode_edit.cpp:199`):
- Calls `drawTextCursor(p, textframe)` (line 223)

`drawTextCursor()` (`canvasmode_edit.cpp:262`):
- Checks blink timing to toggle visibility (lines 264–270)
- Delegates to `commonDrawTextCursor()` (line 274)

`CanvasMode::commonDrawTextCursor()` (`canvasmode.cpp:785`):
- Gets the cursor character position: `textframe->itemText.cursorPosition()` (line 792)
- Converts to a screen line: `textframe->textLayout.positionToPoint(textCursorPos)` (line 793)
- Applies the frame's transform matrix (line 798)
- Draws the vertical caret line: `p->drawLine(cursor)` (line 811)

### 6c. Position-to-point conversion

`TextLayout::positionToPoint()` (`textlayout.cpp:369`):
- Delegates to the box hierarchy: `m_box->positionToPoint(pos, *m_story)`
- Returns a `QLineF` — the vertical line segment where the caret should appear
- Handles RTL text direction (line 372)

---

## 7. Text Selection

### 7a. Selection via mouse drag

`CanvasMode_Edit::mouseMoveEvent()` (`canvasmode_edit.cpp:427`):
- While the mouse button is held (line 443), updates cursor position via `slotSetCurs()` (line 476)
- Extends the selection in StoryText (lines 478–490):
  ```cpp
  currItem->itemText.select(oldCp, newCp - oldCp);
  ```
- Sets `operTextSelecting = true` (line 494)

### 7b. Selection storage

Selection is tracked in `StoryText` (`storytext.h:264–274`):
- `select(int pos, int len)` — selects a range
- `extendSelection(int oldPos, int newPos)` — extends from old to new cursor
- `selectWord(int pos)` — selects word at position (used for double-click)
- `selected(int pos)` — returns whether a character is selected
- `startOfSelection()` / `endOfSelection()` — range accessors

### 7c. Selection rendering

Selection highlights are drawn during the box tree render pass:

`GlyphBox::drawSelection()` (`boxes.cpp:542`):
- Iterates through glyphs in the box
- For each character, checks `item->itemText.selected(i)` (line 553)
- Draws highlight rectangles over selected portions (lines 561–580)
- Handles partial selection of ligatures (lines 574–580) — if only some characters of a multi-character cluster are selected, the highlight covers a proportional width

Called up through the hierarchy: `GroupBox::drawSelection()` → `LineBox::drawSelection()` → `GlyphBox::drawSelection()`.

---

## Complete Sequence: Typing a Character

```
User presses 'A'
  │
  ▼
Qt delivers QKeyEvent to Canvas
  │
  ▼
Canvas → CanvasMode_Edit::keyPressEvent()
  │
  ▼
PageItem_TextFrame::handleModeEditKey()
  │
  ├─→ itemText.insertChars("A")     ← modifies StoryText
  │     │
  │     └─→ emits changed(pos, pos+1)
  │           │
  │           └─→ slotInvalidateLayout()  ← marks frame(s) invalid
  │
  ├─→ invalid = true
  └─→ update()                       ← requests repaint
        │
        ▼
  Canvas::paintEvent()  (asynchronous, on next event loop)
        │
        ▼
  PageItem_TextFrame::DrawObj_Item()
        │
        ├─→ layout()                 ← rebuilds box tree (lazy)
        │
        └─→ textLayout.render()      ← paints glyphs via ScreenPainter
              │
              ▼
        CanvasMode_Edit::drawControls()
              │
              └─→ drawTextCursor()   ← draws blinking caret
```
