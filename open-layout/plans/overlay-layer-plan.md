# Overlay Layer Plan

Date: 2026-04-19

Status: **Complete** -- all implementation steps done, 262 unit tests and 129 E2E tests passing.

## Goal

Separate the box overlay (selection borders, resize handles, ports, overflow
markers) and margin guides from the zoomed content SVG into a non-zoomed
overlay SVG. This ensures these UI elements maintain constant screen-pixel
size regardless of zoom level.

## Architecture

### Two-SVG stack

```
#svg-container (scrollable div, position: relative)
  ├── content SVG  (.content-svg, zoomed: width/height scaled by zoom, viewBox = pasteboard)
  │     └── pasteboard, pages, spine, text, selection highlights, cursor, images
  └── overlay SVG  (.overlay-svg, position: absolute, tracks scroll via JS)
        └── margin guides, box frames, resize handles, ports, overflow markers, link highlights
```

- **Content SVG**: Created by `renderToContainer`. Zoom changes its
  `width`/`height` attributes. Contains text layout, selection rectangles,
  cursor, images, and page backgrounds (pasteboard, pages, spine) -- these
  are physical surfaces that should scale with zoom.
- **Overlay SVG**: Created once in `init()`, re-appended after each full
  render (since `renderToContainer` clears the container). Always matches
  the container's visible viewport in CSS pixels. `viewBox` maps 1:1 to
  screen pixels. Position tracked via `scrollTop`/`scrollLeft` on the
  container.

### Coordinate conversion

`_projectPoint(x, y)` converts content-space to overlay-space:

```js
const ctm = contentSvg.getScreenCTM();
const containerRect = container.getBoundingClientRect();
const pt = new DOMPoint(x, y).matrixTransform(ctm);
return { x: pt.x - containerRect.left, y: pt.y - containerRect.top };
```

`_projectSize(size)` converts content-space distance to screen pixels:

```js
return size * ctm.a;
```

### Pointer events

- Overlay SVG has `pointer-events: none` globally.
- Interactive elements (`.box-rect`, `[data-handle]`, `[data-port="output"]`,
  `[data-overflow="true"]`, `[data-link-target]`) have `pointer-events: auto`
  via CSS rules in `index.html`.
- `BoxInteractionController._toSvgPoint()` uses the **content SVG's**
  `getScreenCTM().inverse()` for drag coordinate conversion -- works
  correctly regardless of which SVG the event target is in.

### Overlay refresh triggers

The overlay redraws when:
1. `update()` runs (box positions changed, text reflowed)
2. Zoom changes (`_applyZoom`)
3. Container scrolls (`scroll` event)
4. Window resizes (`ResizeObserver`)

### Key design decisions

- **Page backgrounds stay in content SVG** -- pasteboard, pages, spine are
  physical surfaces that should zoom with content. Only UI chrome (margin
  guides, box frames, handles, ports) goes in the overlay.
- **Overlay positioning uses `position: absolute`** with `top`/`left`
  updated from `scrollTop`/`scrollLeft` in `_updateOverlay()`. This avoids
  the extra scroll height that `position: sticky` would cause.
- **Overlay SVG is re-appended** after each full render because
  `renderToContainer` uses `container.innerHTML = ''`.

## Files changed

- `spread-editor/app/spread-editor-app.js` -- overlay creation, `_projectPoint`,
  `_projectSize`, `_updateOverlay`, `_decorateSpreadOverlay` (margin guides only),
  `_decorateSpreadContent` (page backgrounds), overlay re-append after render
- `spread-editor/app/box-overlay.js` -- rewritten to accept `project`/`projectSize`
  callbacks, draws in overlay screen-pixel coordinates
- `spread-editor/index.html` -- CSS for `.content-svg`, `.overlay-svg`,
  pointer-events rules
- `spread-editor/test/*.spec.js` -- all E2E selectors updated to target
  `svg.overlay-svg` for UI chrome or `svg.content-svg` for content/viewBox
