# Implementation Plan - Fix Trailing Space Cursor Bug

## Goal
Fix the bug where pressing space at the end of a paragraph doesn't move the cursor until a non-space character is entered.

## Research Findings
- `justifier.js`: When a line is left-aligned (last line of a paragraph), it attempts to distribute all space width (`spaceWidth`) into the gaps between words. If there are no gaps (e.g., only one word followed by spaces), the `gapWidth` becomes 0, and the spaces effectively lose their width.
- `positions.js`: `buildPositions` is currenty matching `words` (from `justifier.js`) to `wordGroups` (internal), but `words` only contains non-space content. This causes trailing spaces to be ignored in the cursor map.

## Proposed Changes

### [Story Editor]

#### [MODIFY] [justifier.js](file:///Users/martino/git/scribus/docs/story-editor/lib/justifier.js)
- For `isLastLine` (left-aligned), we'll simplify `gapWidth` to always be just the natural `spaceWidth / gaps` if `gaps > 0`.
- Wait, what if there are *only* spaces? `words` will be empty.
- **Improved fix**: Ensure we don't throw away trailing space width.
- Actually, the `justifier` is doing its job (calculating `word.x`). The `positions.js` is where the translation to cursor positions happens.
- I will make `justifier.js` include a `trailingSpaceAdvance` if it's the last word? No, let's keep `justifier.js` as-is but fix `positions.js`.

#### [MODIFY] [positions.js](file:///Users/martino/git/scribus/docs/story-editor/lib/positions.js)
- Update `buildPositions` to correctly increment `wx` by the `spaceGlyph.ax` even if no gap is present.
- Ensure the loop over `wordGroups` covers all trailing groups (which are groups with empty `glyphs` but a `spaceGlyph`).

#### [NEW] [trailing-space.spec.js](file:///Users/martino/git/scribus/docs/app-shell/test/trailing-space.spec.js)
- Add a Playwright test.

## Verification Plan

### Automated Tests
- `npm run test:e2e` to run the new repro test.
- `npm run test` for core layout.

### Manual Verification
- Type spaces at the end of a paragraph and verify the cursor moves.
