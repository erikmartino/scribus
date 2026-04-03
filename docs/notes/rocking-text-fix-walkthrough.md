# Walkthrough - Rocking Text Fix

I have resolved the issue where text would "rock" (shift horizontally) when typing on the last line of a paragraph. This was caused by the justifier averaging the width of all spaces across all word gaps, leading to redistribution whenever a new word was added.

## Changes Made

### Justifier Logic Refactor
- **[justifier.js](file:///Users/martino/git/scribus/docs/story-editor/lib/justifier.js)**:
    - Replaced the uniform `gapWidth` calculation with a per-word `gapAfter` tracking system for left-aligned lines.
    - Updated the glyph loop to maintain an incremental `currentGap` width that captures the exact advance of space glyphs between words.
    - Added support for leading spaces by initializing the first word's `x` offset to the width of any preceding spaces.
    - Preserved full justification (uniform gaps) for internal lines of a paragraph.

## Verification Results

### Automated Tests
I created a new E2E test `app-shell/test/rocking-text.spec.js` that measures the horizontal position of a word before and after a new word is typed later in the line.

| Word Position | Before Fix | After Fix | Status |
| :--- | :---: | :---: | :---: |
| **Shift after typing " C"** | `~6.0px` | `0.0px` | ✅ **PASSED** |

> [!IMPORTANT]
> **Full E2E Suite**: **16 / 16 tests passed**.
> **Console Audit**: Clean. No layout errors or warnings.

### Manual Verification
1.  Type a paragraph in the Story Editor.
2.  On the last line, type `Word1`, then several spaces, then `Word2`.
3.  Type a space and `Word3`.
4.  **Result**: `Word2` remains perfectly stationary while you type `Word3`. The "rocking" effect is gone.

---
This change significantly improves typing stability and visual polish in the Story Editor.
