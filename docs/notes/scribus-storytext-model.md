# StoryText Model Notes

`StoryText` is Scribus's core in-memory text model for a frame or linked frame chain.

## Core Role

`StoryText` stores:
- Unicode text,
- character and paragraph style partitions,
- cursor/selection state,
- references used by shaping/layout.

It is the source-of-truth model consumed by shaping and layout.

## Sharing Across Linked Frames

Linked text frames share the same underlying story data (reference-counted shared storage). Each frame tracks which visible slice it owns (`firstChar` and max chars), but content lives once.

## Serialization Model

In `.sla`, the head frame of a linked chain writes the story payload; other frames link by IDs. On load, Scribus reconstructs links and shared story ownership.

## Relationship to Layout

Pipeline view:
1. `StoryText` -> itemizing/shaping (`TextShaper`),
2. shaped clusters -> layout (`PageItem_TextFrame::layout()`),
3. box tree -> rendering/hit testing.

`StoryText` emits change notifications so affected layout/shaping regions are invalidated.

## Practical Summary

For architecture discussions, treat `StoryText` as the canonical text state and keep rendering state derived from it.
