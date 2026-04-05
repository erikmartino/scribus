# Fix: Double-click on existing selection

**Date:** 2026-04-05  
**Status:** Complete

## Problem

When a user double-clicks on text that already has a selection, the behavior is
wrong. The first `pointerdown` of the double-click collapses the existing
selection and triggers `await update()` (full re-layout). The second
`pointerdown` then selects a word, but the intermediate collapse + re-layout
causes visual glitching and potential timing issues.

Expected behavior: double-clicking should select the word at the click point
regardless of whether a prior selection exists — with no visible flash of the
selection collapsing.

## Root Cause

In `text-interaction.js` `_handlePointerDown()`:

1. `cursor.handleClick(e)` converts click → story position.
2. `_clickTracker.registerClick(Date.now())` counts the click.
3. `resolveAction()` determines the action.

On the **first** click of a double-click sequence, click count is 1, so action
is `'caret'` → `editor.moveCursor(pos, false)` → clears selection → full
re-render via `await update()`.

On the **second** click (within 350 ms), click count is 2, action is `'word'`
→ `editor.selectWordAt(pos)` → renders word selection.

The problem: the first click always clears the selection and triggers an
expensive update. Since `_handlePointerDown` is async with `await update()`,
the second click may interleave, causing race conditions or visual artifacts.

## Fix

Defer the first click's `moveCursor` call briefly. If a second click arrives
within the multi-click threshold, skip the single-click behavior entirely and
go straight to word selection. This avoids the intermediate collapse.

**Approach:** In `_handlePointerDown`, after determining the action is `'caret'`
(single click), do NOT immediately call `await update()`. Instead, schedule the
update. If a second pointerdown arrives before the threshold, cancel the pending
single-click update and process as double-click directly.

**Simpler approach:** Don't defer — instead, just avoid calling `update()` when
the click count is 1 and we are within the multi-click threshold window. Use a
small timer: if a second click comes before the timer, the timer is cancelled.
If no second click, the timer fires and performs the original single-click
update.

**Chosen approach:** On the first pointerdown, process the editor state change
immediately (`moveCursor` clears selection) and perform a **lightweight visual
update** — clear selection SVG rects, move the caret, show it. This gives the
user instant feedback that the click landed. The full re-layout `update()` is
deferred with `setTimeout(threshold)`. If a second pointerdown arrives
(double-click), the deferred update is cancelled and `selectWordAt` +
`update()` runs directly — no intermediate render flash. Single clicks still
feel instant because the caret and selection visuals update synchronously.

## Files to modify

- `docs/story-editor/lib/text-interaction.js` — add deferred single-click update
- `docs/story-editor/test/test-click-tracker.js` — if click-tracker changes needed
- `docs/app-shell/test/story-editor.spec.js` — E2E Playwright test for double-click on selection

## Verification

- `node --test test/*.js` from `docs/story-editor` — 145 tests pass
- Playwright tests from `docs/app-shell/test/` — 5 tests pass (including new double-click test)
- No browser console errors found

## Changes Made

1. **`docs/story-editor/lib/text-interaction.js`** — On single click, perform
   a lightweight visual update (clear selection rects, move caret, show caret)
   immediately, then defer the full re-layout `update()` via
   `setTimeout(threshold)`. If a second pointerdown arrives (double-click),
   the pending timer is cancelled and `selectWordAt` + `update()` run
   directly. Drag-start and pointer-up also flush the timer. `destroy()`
   cleans up any pending timer.

2. **`docs/story-editor/lib/click-tracker.js`** — Added public `threshold`
   getter so `text-interaction.js` can read the multi-click threshold without
   accessing a private field.

3. **`docs/story-editor/test/test-click-tracker.js`** — Added test for the new
   `threshold` getter.

4. **`docs/app-shell/test/story-editor.spec.js`** — Added browser log
   forwarding and a new E2E test that verifies double-clicking within an
   existing select-all narrows the selection to a single word.

5. **`docs/spread-editor/index.html`** — Added `caret-color: transparent`
   to `#svg-container` CSS to suppress the native browser input caret that
   was appearing alongside the custom SVG cursor (the "dim second cursor").

6. **`docs/spread-editor/app/spread-editor-app.js`** — Fixed
   click-on-selection exiting text mode. The `pointerdown` handler treated
   clicks on text content, selection rects, and cursor elements as
   "background clicks" (exiting text mode) because they lack `data-box-id`.
   Now checks if the click target is inside text/selection/cursor SVG
   elements or geometrically inside a text box before deciding to exit.

7. **`docs/spread-editor/test/gestures.spec.js`** — Added E2E test that
   verifies clicking on selected text stays in text mode and collapses the
   selection.
