# Spread Editor: Sync ribbon controls on cursor move

**Date:** 2026-04-26
**Status:** Done

## Problem

When the user clicks between paragraphs that have different font sizes, the
font-size slider in the ribbon stays at its old value instead of jumping to
the current paragraph's size. The same applies to arrow-key navigation.

## Root cause

The ribbon is rebuilt by `AppShell.requestUpdate()`, which calls
`plugin.getRibbonSections()`. The `getRibbonSections()` method correctly
reads `paraStyle.fontSize` for the current paragraph, but `requestUpdate()`
is only triggered on mode changes and selection changes -- not on ordinary
cursor movement within text mode.

Every cursor movement calls `SpreadEditorApp.update()`, but `update()` never
calls `this.shell.requestUpdate()`, so the ribbon stays stale.

## Fix

Add `this.shell?.requestUpdate()` at the end of `update()` so the ribbon
rebuilds on every re-render. `requestUpdate()` already deduplicates via
`_updateQueued`, so this is safe against infinite loops.

## Files changed

- `spread-editor/app/spread-editor-app.js` -- add `requestUpdate()` call in
  `update()`.
