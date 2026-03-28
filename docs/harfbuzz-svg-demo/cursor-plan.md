# Plan: Add flashing cursor to HarfBuzz SVG demo

## Context

The HarfBuzz SVG demo renders shaped, justified, multi-column text as SVG `<text>` elements. There is no cursor or text editing interaction. We want to add a blinking caret that can be placed by clicking and moved with arrow keys, including correct positioning inside ligatures using the sub-glyph position hack (dividing a ligature's advance equally among its source characters).

## Overview

Create a new `lib/cursor.js` module and wire it into the existing pipeline. The **story model** is a normalized two-level structure: paragraphs containing character-style runs. The cursor position is `{ paraIndex, charOffset }` — two integers, no DOM references, no data duplication. Visual coordinates are always derived from this position.

## Story model

The story is a normalized array produced by `extractParagraphs()`:

```js
story = [
  // paragraph 0
  [
    { text: "Thefficacy of ", style: { bold: false, italic: false } },   // noop style
    { text: "fine typography",  style: { bold: false, italic: true } },
    { text: " lies in ...",     style: { bold: false, italic: false } },
    { text: "fluid shapes",    style: { bold: true,  italic: false } },
    ...
  ],
  // paragraph 1
  [ ... ],
]
```

**Always two levels:** paragraph → character-style runs. Unstyled text gets a run with `{ bold: false, italic: false }` (noop style). The DOM's arbitrary nesting (`<b><em>...`) is flattened into this structure by `extractRuns()`, which already does this today.

### Cursor position: `{ paraIndex, charOffset }`

- `paraIndex` — which paragraph (index into `story`)
- `charOffset` — character offset into the paragraph's flattened text (sum of all run `.text` lengths)

To resolve which run a `charOffset` falls in: walk `story[paraIndex]` summing `run.text.length` until you pass it. O(n) in number of runs per paragraph — trivially small.

This matches Scribus's `StoryText` model: flat character addressing, styles are metadata on characters not structural nesting. The text data lives in one place only (the story array); the cursor is just two integers.

## Step 1: Normalize `extractParagraphs()` return value

**File:** `lib/text-extract.js`

`extractParagraphs()` already returns `{ text, style }[][]` — this IS the story model. The only change: ensure unstyled text always gets an explicit noop style `{ bold: false, italic: false }` (it already does — `parentStyle` defaults to this). No structural changes needed, just rename/document for clarity.

The existing return value is already the story. No new data structures.

## Step 2: Extend `layout()` to return line geometry

**File:** `lib/layout-engine.js`

Layout receives the story (paragraphs) and produces lines. We extend the return value to include a **lineMap** that connects each rendered line back to paragraph positions.

Layout returns:
```js
{
  allLines,          // existing
  hyphenAdvance,     // existing
  lineMap,           // new — see below
}
```

### lineMap

Each entry corresponds to one rendered line:

```js
{
  lineIndex,                // index in the flat lineMap array
  paraIndex,                // which paragraph this line belongs to
  startChar, endChar,       // character range relative to paragraph text (existing from line-breaker)
  glyphs,                   // glyph array (ax, cl, style)
  words,                    // justified words (x, width, fragments)
  text,                     // paragraph text string
  colX, y,                  // visual: column x offset, baseline y
  padding,                  // column padding
}
```

Converting cursor `{ paraIndex, charOffset }` to a line: find the line in `lineMap` where `line.paraIndex === paraIndex` and `startChar <= charOffset <= endChar`.

**Approach:** Modify `SvgRenderer.render()` to build and return `lineMap` alongside the SVG element, since it already computes `colX` and `y`. The `paraIndex` is added by `layout()` which knows the paragraph structure.

## Step 3: Create `lib/story-position.js` (model)

Pure functions over story data and lineMap. No DOM/SVG dependencies. Reusable by any future feature that needs story positions (selection, find/replace, etc.).

### Exported functions

**Navigation:**
- `moveLeft(pos, story)` → `{ paraIndex, charOffset }` — decrement charOffset; if at 0, move to end of previous paragraph
- `moveRight(pos, story)` → `{ paraIndex, charOffset }` — increment charOffset; if past paragraph length, move to start of next
- `paraTextLength(story, paraIndex)` → `number` — sum of run text lengths

**Position ↔ line resolution:**
- `posToLine(pos, lineMap)` → `{ lineIdx, localCharPos }` — find the lineMap entry for this position
- `xToPos(x, line)` → `{ paraIndex, charOffset }` — given an x coordinate within a line, find the closest position using the sub-glyph hack (used by both click hit-testing and up/down navigation)

**Position ↔ visual coordinates (sub-glyph hack):**
- `positionToPoint(pos, lineMap, fontSize)` → `{ x, y, height }` — resolve position to visual cursor coordinates
  1. Call `posToLine()` to get line and local char offset
  2. Walk glyphs, determine character spans (`g.cl` to next `g.cl`)
  3. For ligatures: divide `g.ax` equally among source characters
  4. x = `colX + padding` + sum of preceding advances + fractional offset
  5. y = line's `y` value; height from fontSize

- `pointToPos(svgX, svgY, lineMap)` → `{ paraIndex, charOffset }` — click hit-testing
  1. Find column by x range, closest line by y
  2. Call `xToPos(localX, line)` which uses the sub-glyph hack with left-half/right-half logic

Note: `xToPos` is shared between `pointToPos` (click) and up/down navigation (finding the position closest to stickyX on an adjacent line).

## Step 4: Create `lib/cursor.js` (view)

Pure SVG/DOM concerns. Imports from `story-position.js` for all position logic.

### State
- `this._pos` — `{ paraIndex, charOffset }` — current position
- `this._stickyX` — remembered x for up/down navigation
- `this._story` — read-only reference to story array
- `this._lineMap` — read-only reference from layout
- `this._fontSize` — for cursor height
- `this._svg` — SVG element to draw into
- `this._cursorEl` — SVG `<line>` element
- `this._blinkInterval` / `this._visible` — blink state

### Methods
- `moveTo(pos)` — set `this._pos`, call `positionToPoint()`, update SVG `<line>` coordinates, reset blink to visible
- `handleClick(event)` — get SVG coordinates from mouse event, call `pointToPos()`, call `moveTo()`
- `handleKeydown(event)` — ArrowLeft/Right: call `moveLeft`/`moveRight`, then `moveTo()`. ArrowUp/Down: resolve adjacent line, call `xToPos` with `stickyX`, then `moveTo()`
- `updateLayout(lineMap, fontSize)` — called on re-layout (slider change), clamp pos to valid range, redraw
- `destroy()` — clear blink interval, remove SVG element

### Blinking
- `setInterval` at ~500ms toggles `visibility` attribute on `this._cursorEl`
- Any `moveTo()` resets to visible

## Step 5: Wire into `index.html`

- After `engine.renderToContainer()`, instantiate cursor with SVG, story, lineMap, fontSize
- Add `click` listener on SVG → `cursor.handleClick(e)`
- Add `keydown` listener on container → `cursor.handleKeydown(e)`
- On re-layout (slider change): call `cursor.updateLayout(newLineMap, newFontSize)`
- Add `tabindex="0"` to svg-container for keyboard focus
- CSS `cursor: text` on SVG

## Step 6: Visual polish

- Cursor line extends from baseline - ascent to baseline + descent (use fontSize as approximation)
- Cursor color: `#1a1a1a` with 1.5px stroke width

## Files modified
- `lib/text-extract.js` — no structural changes (already produces the story model)
- `lib/svg-renderer.js` — return `lineMap` alongside SVG element
- `lib/layout-engine.js` — attach `paraIndex` to lineMap entries, return lineMap
- `lib/story-position.js` — **new file**, ~60 lines, pure model functions
- `lib/cursor.js` — **new file**, ~90 lines, SVG view
- `index.html` — wire up click/keydown handlers, focus management

## Verification
1. Open `index.html` in browser
2. Click anywhere in the text → blinking cursor appears at correct character boundary
3. Click on a ligature (e.g. "ffi") → cursor positions correctly between the component characters
4. Left/Right arrows move cursor one character at a time, including through ligatures
5. Up/Down arrows move between lines, maintaining horizontal position
6. Adjusting sliders re-renders text and cursor resets/repositions correctly
7. Cursor blinks on/off at ~500ms interval, resets to visible on movement
