# Spread Editor: Ribbon encapsulation refactor

**Date:** 2026-04-26
**Status:** Done

## Problem

The spread-editor bypasses the app-shell plugin API and directly manipulates
ribbon internals:

1. `update()` uses `querySelector('#toggle-bold')` / `querySelector('#toggle-italic')`
   to toggle the `active` attribute on ribbon buttons.
2. `setMode()` / `_enterLinkMode()` use `querySelector('scribus-app-shell')`
   to set `data-mode` directly on the shell element.
3. `index.html` declares static ribbon sections that are immediately destroyed
   by `updateRibbon()` (which does `innerHTML = ''`), making them dead markup.
4. `TextTools.createTypographySection()` does not accept `bold`/`italic`
   active state, so plugins cannot express that state through the API.

## Changes

### 1. TextTools: accept bold/italic active state

Add `bold` and `italic` boolean options to `createTypographySection()` so
the buttons can be created with correct `active` state during each ribbon
rebuild.

### 2. AppShell: add `setMode()` API

Add `AppShell.setMode(mode)` that sets `data-mode` on `this.element` and
calls `requestUpdate()`. Move the `data-mode` visibility CSS into
`app-shell-element.js` (shadow DOM) so it is co-located with the element.

### 3. SpreadEditorApp: use public APIs only

- Pass `bold`/`italic` through `getRibbonSections()` -> `TextTools`.
- Call `this.shell.setMode()` instead of `querySelector` + `setAttribute`.
- Remove the dead `querySelector('#toggle-bold/italic')` block from `update()`.
- Remove vestigial `_ribbonSections` property.

### 4. index.html: remove dead static ribbon sections

The static `<scribus-ribbon-section>` elements for Typography and Formatting
are overwritten on every `updateRibbon()` call. Remove them.
Also remove the `data-mode` CSS rules (now in the shell component).

### 5. StoryEditorPlugin: pass bold/italic state

Update `getRibbonSections()` to pass `bold`/`italic` from `typingStyle` to
`TextTools.createTypographySection()`.

## Files changed

- `app-shell/lib/text-tools.js`
- `app-shell/lib/shell-core.js`
- `app-shell/lib/components/app-shell-element.js`
- `spread-editor/app/spread-editor-app.js`
- `spread-editor/index.html`
- `story-editor/lib/story-editor-plugin.js`
