# App Shell / Plugin Boundary

This document describes the public API boundary between the app-shell
framework and editor plugins (spread-editor, story-editor, etc.).

Plugins must not reach into the shell's DOM or the DOM of shell-managed
UI components. All interaction goes through the APIs listed below.

## Plugin lifecycle

| Method | Direction | Purpose |
|--------|-----------|---------|
| `shell.registerPlugin(plugin)` | plugin -> shell | Registers the plugin; calls `plugin.init(shell)` |
| `plugin.init(shell)` | shell -> plugin | Plugin receives its shell reference |
| `plugin.getRibbonSections(selected)` | shell -> plugin | Shell requests ribbon content; plugin returns `<scribus-ribbon-section>` elements |
| `plugin.getPanelContent(selected)` | shell -> plugin | Shell requests panel content |

## Shell API available to plugins

### Mode management

```js
shell.setMode(mode)   // Sets data-mode on the shell element; triggers requestUpdate()
```

Plugins call `shell.setMode('text')`, `shell.setMode('object')`, etc.
The shell applies `data-mode` to its host element, which drives CSS
visibility of ribbon sections marked with `data-only-mode`.

Plugins must **not** query the shell element directly to set `data-mode`.

### Ribbon updates

```js
shell.requestUpdate()   // Triggers a debounced ribbon + panel rebuild
```

The shell calls `plugin.getRibbonSections(selected)` on every update.
Plugins return freshly-built DOM each time. The shell does a full
`innerHTML = ''` + replace -- there is no diffing.

Plugins must **not** query or mutate ribbon DOM elements after returning
them. The shell owns the ribbon container and may destroy/rebuild its
contents at any time.

### UI factories

All ribbon elements should be created through `shell.ui`:

```js
shell.ui.createButton({ label, icon, commandId, active, id, ... })
shell.ui.createInput({ label, type, min, max, value, onInput, id, ... })
shell.ui.createFontSelector({ label, value, onChange, id, ... })
```

### Shared text-formatting helpers

`TextTools` (from `app-shell/lib/text-tools.js`) provides reusable
ribbon section builders so that all editors get a consistent UI:

```js
TextTools.createTypographySection(shell, {
  fontFamily,       // current font family
  bold,             // boolean -- bold button active state
  italic,           // boolean -- italic button active state
  boldCommand,      // command id (default: 'text.bold')
  italicCommand,    // command id (default: 'text.italic')
  fontFamilyCommand // command id (default: 'text.font-family')
})

TextTools.createFormattingSection(shell, {
  fontSize,           // current font size
  lineHeight,         // current line height %
  fontSizeCommand,    // command id (default: 'text.font-size')
  lineHeightCommand   // command id (default: 'text.line-height')
})
```

### Commands

```js
shell.commands.register({ id, label, icon, execute, isEnabled, shortcut })
shell.commands.execute(id, args)
shell.commands.get(id)
```

### History (undo/redo)

```js
shell.history.submit({ label, execute, undo })
shell.history.undo()
shell.history.redo()
```

### Selection

```js
shell.selection.select(item)
shell.selection.remove(item)
shell.selection.clear()
shell.selection.current    // the primary selected item
```

### Clipboard

```js
shell.clipboard.cut()
shell.clipboard.copy()
shell.clipboard.paste()
```

Events: `paste-received`, `cut-executed`.

### Document model

```js
shell.doc.registerItem(abstractItem)
```

## Mode-based ribbon visibility

Ribbon sections can declare `data-only-mode` to be shown only in a
specific mode:

```js
const section = AppShell.createRibbonSection('Typography', builder);
section.setAttribute('data-only-mode', 'text');
```

The CSS rules in `shell.css` hide sections whose `data-only-mode` does
not match the shell's current `data-mode`:

```css
[data-mode="object"] [data-only-mode="text"] { display: none !important; }
[data-mode="text"] [data-only-mode="object"] { display: none !important; }
```

## What plugins must NOT do

- Query the shell element (`querySelector('scribus-app-shell')`) to
  read or write attributes.
- Query ribbon child elements by ID (`querySelector('#toggle-bold')`)
  to read or write state.
- Reach into shadow DOM of `<scribus-input>`, `<scribus-button>`, or
  `<scribus-font-selector>` components.
- Declare static ribbon sections in `index.html` -- the plugin system's
  `updateRibbon()` clears the ribbon container on every cycle, so
  static markup is destroyed immediately.
