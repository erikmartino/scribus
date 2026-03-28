# Story Editor Paragraph Styles Plan

## Context and learnings

While prototyping a paragraph-style "lead first line" treatment, three issues showed up:

1. Changing first-line `font-size` alone causes visual collisions because x placement is still based on glyph advances shaped for the base font size.
2. Transform-based scaling can make debugging harder and may not consistently keep cursor/selection mapping aligned unless line metrics are updated in lockstep.
3. Vertical rhythm must be adjusted after enlarging a first line, otherwise subsequent lines sit too high and look cramped.

## Recommended implementation approach

1. Add a paragraph style model (`normal`, `lead`, etc.) independent from character styles.
2. For a lead paragraph first line:
   - increase first-line font size,
   - scale first-line x metrics from a stable line anchor,
   - update line-map x positions with the same scale,
   - shift subsequent lines in the same box downward by the size delta.
3. Keep the rendering/model path deterministic by applying one math function for x/y adjustments and reusing it for both SVG and cursor/selection metrics.

## Validation criteria

1. First line font size is larger than base font size.
2. Word placements preserve ordering and non-overlap after scaling.
3. Cursor/selection x mapping follows the scaled line metrics.
4. Later lines in the same box are shifted down by the expected delta.

## Test strategy

Create a focused unit test around a pure paragraph-style math helper that:

- scales first-line font size,
- scales first-line fragment x/width consistently,
- verifies non-overlap (`prev.x + prev.width <= next.x`),
- verifies per-line y offsets for following lines in the same box.
