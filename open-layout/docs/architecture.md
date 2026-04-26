# Architecture Overview

This document describes the overall structure of the `open-layout`
codebase so that AI agents (and humans) can orient themselves without
reading every source file.

## High-Level Summary

Open-layout is a **zero-build-step** collection of browser-based
prototypes exploring Scribus text layout and editing. Every module is
plain ESM JavaScript served directly by a custom Node.js dev server.
The only npm dependency is `@playwright/test` for E2E testing.

External libraries are loaded from CDNs, proxied and cached locally by
the dev server under `vendor/`.

## Directory Map

```
open-layout/
  server.js               Dev server (static files + store REST API + vendor proxy)
  package.json             Scripts only, no runtime deps
  playwright.config.js     Chromium-only, baseURL localhost:8000
  index.html               Root landing page (directory listing + Document Browser link)
  AGENTS.md                AI agent rules

  app-shell/               Framework: layout chrome, plugin system, shared services
  story-editor/            Full-page story text editor (HarfBuzz WASM shaping)
  spread-editor/           Multi-page spread editor with text frames and images
  document-browser/        Template gallery and document creation UI
  document-store/          Document inspector and store client library
  font-manager/            Google Fonts loader (runtime, no build)
  ui-components/           Shared web components (button, input, font-selector, dialog, status-bar)

  store/                   Persisted document data (server-managed)
  vendor/                  CDN cache (auto-populated by server, gitignored)
  docs/                    Design notes and plan files
  test/                    Playwright global setup/teardown
  specs/                   Specification documents
```

## Module Dependency Graph

```
font-manager              (leaf -- no outgoing deps)
  ^            ^
  |            |
story-editor   ui-components
  ^    |           ^
  |    v           |
  |  document-store|
  |    ^           |
  |    |           |
  +----+-----------+--- app-shell (shell-core imports ui-components)
       |           |        ^
       |           |        |
  spread-editor    |   document-browser
  (imports story-editor, document-store, app-shell)
```

Arrows point from consumer to provider. Key relationships:

| Consumer | Provider | What it imports |
|----------|----------|-----------------|
| app-shell | ui-components | Registers shared web components (side-effect import) |
| story-editor | font-manager | `GoogleFontManager` for font resolution |
| story-editor | app-shell | `shell-core`, `selection-service`, `document-model`, `text-tools` |
| story-editor | document-store | `serializeStory`, `putJson`, `updateDocTimestamp` |
| spread-editor | story-editor | Re-exports 9 modules via `lib/story-editor-core.js` |
| spread-editor | app-shell | `shell-core`, `document-model`, `text-tools` |
| spread-editor | document-store | `serializeStory`, `putJson`, `updateDocTimestamp`, `uploadImageAsset` |
| document-store | story-editor | `cloneStyle`, `cloneParagraphStyle` |
| document-store | app-shell | `shell-core` |
| document-browser | app-shell | `shell-core` |
| ui-components | font-manager | `GoogleFontManager` (for `<scribus-font-selector>`) |

## Module Details

### app-shell/

The framework layer. Provides the page layout (`<scribus-app-shell>` web
component), the plugin system, and shared services.

**Key files:**

| File | Purpose |
|------|---------|
| `lib/components/app-shell-element.js` | `<scribus-app-shell>` custom element -- Shadow DOM grid layout with ribbon, workspace, and panels slots |
| `lib/shell-core.js` | `AppShell` singleton -- plugin registry, ribbon/panel updates, `UIHelper`, `SystemPlugin` with built-in commands |
| `lib/selection-service.js` | `SelectionService extends EventTarget` -- app-wide selection state |
| `lib/clipboard-service.js` | `ClipboardService` -- cut/copy/paste with system clipboard + localStorage fallback |
| `lib/command-manager.js` | `CommandRegistry` + `CommandHistory` (undo/redo, max 100 entries) |
| `lib/document-model.js` | `DocumentModel` + `AbstractItem` -- item registry with change events |
| `lib/text-tools.js` | `TextTools` -- shared ribbon section builders for typography and formatting |
| `lib/components/command-palette.js` | `<scribus-command-palette>` -- Ctrl+P command search overlay |
| `lib/components/create-menu.js` | `<scribus-create-menu>` -- "+" button dropdown for creating objects |
| `css/shell.css` | Shared CSS: `.ribbon-controls`, `.ribbon-section`, `.ribbon-label`, `.info-card`, mode-based visibility rules |
| `plugins/shapes-demo/plugin.js` | Demo plugin for the shapes demo page |

**Shadow DOM layout of `<scribus-app-shell>`:**

```
.app-shell (CSS Grid: ribbon | main handle panels)
  header.ribbon          -- app launcher + <slot name="ribbon">
  .app-launcher-menu     -- fixed-position dropdown (outside ribbon to avoid overflow clip)
  main.main-body         -- <slot> (default) + marquee overlay
  .resize-handle         -- draggable panel resizer
  aside.panels           -- <slot name="panels">
  <scribus-command-palette>
```

**CSS custom properties (defined on `:host`):**

| Property | Default |
|----------|---------|
| `--ribbon-height` | `80px` |
| `--panel-width` | `250px` |
| `--bg-color` | `#121214` |
| `--shell-bg` | `#1e1e20` |
| `--accent` | `#bb86fc` |
| `--accent-secondary` | `#03dac6` |
| `--text-main` | `#e1e1e6` |
| `--text-dim` | `#a1a1aa` |
| `--border` | `#2e2e32` |

### story-editor/

A full-featured single-story text editor with HarfBuzz WASM shaping,
hyphenation, and justification. The `lib/` directory contains pure
modules; `index.html` wires them together.

**Key files in `lib/`:**

| File | Purpose |
|------|---------|
| `layout-engine.js` | Orchestrates: font loading, shaping, hyphenation, line breaking, justification, SVG rendering |
| `editor-state.js` | Source of truth for story editing state (cursor, selection, mutations) |
| `story-ops.js` | Pure story mutation helpers (insert, delete, replace, style, paragraph breaks) |
| `text-interaction.js` | Mouse, keyboard, and input event handling |
| `cursor.js` | SVG cursor view (blinking caret) |
| `positions.js` | Builds cursor positions from layout data (char -> pixel mapping) |
| `story-position.js` | Pure cursor movement and position logic |
| `svg-renderer.js` | Converts laid-out paragraphs into SVG elements |
| `shaper.js` | Shapes runs using HarfBuzz WASM |
| `hyphenator.js` | Wraps `hyphen` library for soft-hyphen insertion |
| `line-breaker.js` | Greedy line breaking with hyphenation support |
| `justifier.js` | Computes justified word positions from a line's glyphs |
| `style.js` | Character style helpers (clone, compare, defaults) |
| `paragraph-style.js` | Paragraph style helpers (defaults: fontSize=22, fontFamily="EB Garamond") |
| `paragraph-style-render.js` | Style extraction and layout helpers |
| `html-paste-parser.js` | Converts clipboard HTML into story format (preserves bold/italic) |
| `text-extract.js` | Converts DOM trees to style runs |
| `click-tracker.js` | Multi-click state machine (single/double/triple click detection) |
| `font-registry.js` | Loads fonts, registers @font-face, manages HarfBuzz font objects |
| `story-editor-plugin.js` | App Shell plugin adapter |

### spread-editor/

Multi-page spread editor with movable/resizable text frames and image
frames. Embeds the story editor for text editing within frames.

**Key files:**

| File | Purpose |
|------|---------|
| `lib/story-editor-core.js` | Re-export barrel -- re-exports story-editor modules for spread-editor consumption |
| `app/spread-editor-app.js` | Main application class (~2000 lines) -- integrates text editing, box management, persistence |
| `app/box-model.js` | Pure box data operations (create, move, resize) with constraints |
| `app/box-overlay.js` | SVG overlay for selection handles and linking ports |
| `app/box-interactions.js` | Pointer interaction controller for box move/resize |
| `app/drag-state.js` | Pure state machine for drag interactions |
| `app/spread-geometry.js` | Spread layout geometry (page positions, text areas, columns) |
| `app/main.js` | Entry point -- creates app and registers as shell plugin |

### document-browser/

Template gallery for browsing and cloning document templates.

| File | Purpose |
|------|---------|
| `index.html` | Template grid UI with clone dialog |
| `app/main.js` | Lightweight shell plugin, template rendering, clone workflow |

### document-store/

Document inspector UI and client-side store API library.

| File | Purpose |
|------|---------|
| `index.html` | Tree-view document inspector |
| `app/main.js` | Shell plugin with tree-view rendering |
| `lib/document-store.js` | Fetch-based client for the `/store/` REST API |

**Store client API (`document-store/lib/document-store.js`):**

| Function | Purpose |
|----------|---------|
| `loadDocument(docPath)` | Fetches `document.json` + recursive file listing |
| `loadStoryFromStore(docPath, storyId)` | Fetches story JSON, resolves paragraph styles, converts to editor format |
| `loadStoryRaw(docPath, storyId)` | Fetches raw story JSON |
| `loadParagraphStyles(docPath)` | Fetches aggregate paragraph styles |
| `loadCharacterStyles(docPath)` | Fetches aggregate character styles |
| `loadSpread(docPath, spreadId)` | Fetches a spread definition |
| `serializeStory(id, editor)` | Converts EditorState to store JSON |
| `putJson(url, data)` | PUTs a JSON object to the store |
| `updateDocTimestamp(docPath)` | Patches `modified` timestamp in `document.json` |
| `uploadImageAsset(docPath, name, blob, meta)` | Full asset upload workflow with dedup |
| `putAsset(url, data, contentType)` | PUTs binary data |
| `headAsset(url)` | Checks asset existence |

### font-manager/

Google Fonts loader that works at runtime (no build step). Uses the
Grida Fonts mirror (fontsource API) to discover font families and loads
TTF/OTF binaries for HarfBuzz compatibility.

| File | Purpose |
|------|---------|
| `google-font-manager.js` | `GoogleFontManager` class -- catalog, font binary loading |
| `css-tree-font-face-adapter.js` | Extracts @font-face from CSS via css-tree (CDN) |
| `paragraph-font-style.js` | Normalizes font-family/weight/style for GoogleFontManager |

### ui-components/

Shared Shadow DOM web components used across all demos.

| Component | Tag | Key attributes |
|-----------|-----|----------------|
| `ScribusButton` | `<scribus-button>` | `label`, `icon`, `primary`, `active`, `icon-only`, `no-focus` |
| `ScribusInput` | `<scribus-input>` | `label`, `value`, `type`, `min`, `max`, `layout`, `no-focus` |
| `ScribusFontSelector` | `<scribus-font-selector>` | `label`, `value`, `layout`, `no-focus` |
| `ScribusStatusBar` | `<scribus-status-bar>` | `type` ("ok"/"error"); `setText(msg, type)` |
| `ScribusDialog` | `<scribus-dialog>` | `open`, `heading`; slots: default + `actions`; `show()`/`close()` |

### store/

Server-managed document persistence. Structure:

```
store/
  demo/                          Seed/template documents (read-only reference)
    typography-sampler/
      document.json              { format, title, created, modified, pageSize }
      spreads/spread-1.json      { id, pages, frames: [{ type, x, y, w, h, storyRef }] }
      stories/story-main.json    { id, paragraphs: [{ styleRef, runs: [{ text, style }] }] }
      styles/
        paragraph/body.json      { id, fontFamily, fontSize, lineHeight, alignment }
        character/strong.json    { id, bold: true }
  alice/                         User documents (writable)
    brochure-q2/
      document.json
      assets/hero-photo/         { meta.json + binary file }
      spreads/
      stories/
      styles/
```

### server.js

Single-file Node.js HTTP server (no dependencies). Provides:

1. **Static file serving** with comprehensive MIME types
2. **Vendor proxy** -- downloads CDN resources on first request, caches
   under `vendor/` (HarfBuzz WASM, hyphen, fonts, wasm-vips, css-tree)
3. **`/store/` REST API** -- GET, PUT, DELETE, HEAD for document files;
   POST for template cloning; `.aggregate.json` virtual endpoints;
   `/stories/{id}/edit` rewrites to story-editor
4. **Cross-Origin Isolation headers** (COOP + COEP) for SharedArrayBuffer
5. **`?ls` query** on directories returns JSON file listing

## Plugin System

See [app-shell-boundary.md](app-shell-boundary.md) for the full API
specification. Summary:

### Plugin Lifecycle

```js
import shell from '../app-shell/lib/shell-core.js';

class MyPlugin {
  init(shell) {
    // Register commands, creatables, event listeners
    shell.commands.register({ id, label, icon, execute, shortcut });
    shell.registerCreatable({ id, label, onCreate });
  }
  getRibbonSections(selected) {
    // Return freshly-built <scribus-ribbon-section> elements
    return [AppShell.createRibbonSection('Label', builder)];
  }
  getPanelContent(selected) {
    // Return DOM for properties panel, or null
  }
}

shell.registerPlugin(new MyPlugin());
```

### Built-in Commands

| ID | Shortcut | Description |
|----|----------|-------------|
| `app.undo` | Ctrl+Z | Undo |
| `app.redo` | Ctrl+Y / Ctrl+Shift+Z | Redo |
| `app.cut` | Ctrl+X | Cut |
| `app.copy` | Ctrl+C | Copy |
| `app.paste` | Ctrl+V | Paste |
| `app.fullscreen` | F11 | Toggle fullscreen |
| `object.delete` | Delete/Backspace | Delete selected object |

### Shell Events

| Event | Dispatched by | Purpose |
|-------|---------------|---------|
| `selectionchange` | `shell.selection` | Selection state changed |
| `items-changed` | `shell.doc` | Document model items added/removed |
| `creatables-changed` | `shell` | Creatable types registered |
| `paste-received` | `shell` | Clipboard data pasted |
| `cut-executed` | `shell` | Cut operation completed |
| `delete-requested` | `shell` | Delete command executed |
| `marquee-start/change/end` | `shell` | Workspace marquee selection |

## External CDN Dependencies

All proxied through the dev server and cached under `vendor/`:

| Library | Version | Used by |
|---------|---------|---------|
| HarfBuzz.js (WASM + JS) | 0.3.6 | story-editor (text shaping) |
| hyphen (English) | 1.10.4 | story-editor (hyphenation) |
| EB Garamond (font) | latest | story-editor (default font) |
| wasm-vips | 0.0.17 | streaming-downscale-demo, tiff-to-pdf-demo |
| css-tree | 2.3.1 | font-manager (CSS parsing) |

## Testing

### Unit Tests

Run with `npm test` (Node.js built-in test runner). Auto-discovers
files matching `*/test/test-*.js`.

Modules with unit tests: app-shell, story-editor, spread-editor,
document-store, font-manager, streaming-downscale-demo.

### E2E Tests (Playwright)

Run with `npm run test:e2e`. Auto-discovers `*.spec.js` files.
Chromium only. Global setup creates a disposable `store/e2e-*.tmp/`
directory so tests never modify tracked data.

Modules with E2E specs: app-shell, spread-editor, document-browser,
document-store, streaming-downscale-demo, root (test/).

### Key Test Conventions

- Unit test files: `{module}/test/test-*.js`
- E2E spec files: `{module}/test/*.spec.js`
- E2E tests must include `page.on('console', ...)` and
  `page.on('pageerror', ...)` logging (see AGENTS.md rule 7)

## How Each Demo Page Boots

Every demo `index.html` follows the same pattern:

```html
<link rel="stylesheet" href="../app-shell/css/shell.css">
<scribus-app-shell>
  <div slot="ribbon" class="ribbon-controls">...</div>
  <!-- workspace content -->
  <div slot="panels">...</div>
</scribus-app-shell>
<script type="module">
  import '../app-shell/lib/components/app-shell-element.js';
  import '../ui-components/index.js';
  import './app/main.js';   // registers plugin with shell
</script>
```

The `app/main.js` entry point imports `shell-core.js`, creates the
plugin, and calls `shell.registerPlugin(plugin)`.
