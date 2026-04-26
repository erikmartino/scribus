# Multi-Panel Sidebar with Properties Panel

Add a tabbed side-panel system to the app-shell so that multiple panels
(starting with **Properties**) can coexist. Each shape exposes structured
property descriptors so the Properties panel can render read-only and
read-write fields generically.

## User Review Required

> [!IMPORTANT]
> **Breaking change to `getPanelContent()` API.**
> The current `plugin.getPanelContent(selected)` returns a single DOM node
> that is stuffed directly into the sidebar. This plan replaces that with a
> richer `plugin.getPanelDescriptors(selected)` that returns an array of
> panel descriptor objects. Existing callers (shapes-demo, story-editor)
> will need to migrate. The shapes-demo is updated in this plan; story-editor
> and spread-editor will be updated in a follow-up.

> [!WARNING]
> The `slot="panels"` markup in each demo's `index.html` currently contains
> a hardcoded `<h3>Properties</h3>` and `<div id="properties-view">`. This
> plan moves panel rendering entirely into the shell so those slot contents
> will be replaced with a shell-managed panel container. The slot itself
> remains, but its children change.

## Proposed Changes

### App Shell Element (Shadow DOM layout)

#### [MODIFY] [app-shell-element.js](file:///Users/martino/git/scribus/open-layout/app-shell/lib/components/app-shell-element.js)

The `<aside class="panels">` section gets a **tab bar** at the top and a
**panel body** below it, both inside Shadow DOM:

```html
<aside class="panels" id="side-panels">
  <nav class="panel-tabs" id="panel-tabs">
    <!-- tab buttons injected by shell-core -->
  </nav>
  <div class="panel-body" id="panel-body">
    <slot name="panels"></slot>
  </div>
</aside>
```

New CSS for `.panel-tabs` (horizontal strip of tab buttons, accent
underline on active tab) and `.panel-body` (flex: 1, overflow-y: auto).

Expose new getters:

```js
get panelTabs()  → shadowRoot.querySelector('#panel-tabs')
get panelBody()  → shadowRoot.querySelector('#panel-body')
```

---

### Shell Core (panel registration + rendering)

#### [MODIFY] [shell-core.js](file:///Users/martino/git/scribus/open-layout/app-shell/lib/shell-core.js)

1. **Panel registry** — `shell.registerPanel({ id, label, icon? })`.
   Stores an ordered list of panel descriptors. A built-in `"properties"`
   panel is registered by the SystemPlugin during `init()`.

2. **Active panel** — `shell._activePanel` (string id). Defaults to
   `'properties'`.

3. **`updatePanels(selected)`** — rewritten:
   - Render tab buttons in `this.element.panelTabs` from the panel registry.
   - For the active panel `'properties'`:
     - Collect property groups from all plugins via
       `plugin.getPanelDescriptors(selected)`.
     - Render the property groups into `this.element.panelBody`.
   - Future panels (Layers, Pages, etc.) will follow the same pattern.

4. **`getPanelContent()` backward compat** — during transition, if a
   plugin only implements `getPanelContent()` (not `getPanelDescriptors`),
   the shell wraps the returned DOM in a generic "Custom" property group.
   This keeps story-editor working without changes.

5. **New shell API**:
   ```js
   shell.registerPanel({ id, label, icon })
   shell.setActivePanel(id)
   shell.getActivePanel()  // returns id string
   ```

---

### Property Descriptors (new data contract)

#### [NEW] [property-descriptors.js](file:///Users/martino/git/scribus/open-layout/app-shell/lib/property-descriptors.js)

Defines JSDoc types for the property groups plugins return:

```js
/**
 * @typedef {Object} PropertyGroup
 * @property {string} label — Group heading, e.g. "Position", "Color"
 * @property {PropertyDescriptor[]} properties
 */

/**
 * @typedef {Object} PropertyDescriptor
 * @property {string} key — Unique key like 'x', 'y', 'fill'
 * @property {string} label — Display label
 * @property {'readonly'|'text'|'number'|'color'} type
 * @property {*} value — Current value
 * @property {Function} [onChange] — Called with (newValue). Absent for readonly.
 */
```

Also exports a helper to render a property group into a DOM fragment
using `shell.ui` helpers (createInput for editable, plain text for readonly,
color input for color).

---

### Properties Panel Renderer

#### [NEW] [properties-panel.js](file:///Users/martino/git/scribus/open-layout/app-shell/lib/components/properties-panel.js)

A small module that takes an array of `PropertyGroup` objects and builds
the DOM for the properties panel body. Each group gets a collapsible
section header (`.panel-header` style) and the property rows rendered
underneath.

Property types → UI:
| Descriptor type | Rendered as |
|-----------------|-------------|
| `readonly`      | Label + plain text span |
| `text`          | `shell.ui.createInput({ type: 'text', ... })` |
| `number`        | `shell.ui.createInput({ type: 'number', ... })` |
| `color`         | Native `<input type="color">` wrapped in a styled container |

---

### Shapes Demo Plugin (migrated to descriptors)

#### [MODIFY] [plugin.js](file:///Users/martino/git/scribus/open-layout/app-shell/plugins/shapes-demo/plugin.js)

Replace `getPanelContent(selected)` with `getPanelDescriptors(selected)`:

```js
getPanelDescriptors(selected) {
  if (!selected) return [];
  return [
    {
      label: 'Object',
      properties: [
        { key: 'type', label: 'Type', type: 'readonly', value: selected.type },
        { key: 'id', label: 'ID', type: 'readonly', value: selected.id },
      ]
    },
    {
      label: 'Position',
      properties: [
        { key: 'x', label: 'X', type: 'number', value: parseInt(selected.element.style.left) || 0,
          onChange: v => { selected.element.style.left = v + 'px'; } },
        { key: 'y', label: 'Y', type: 'number', value: parseInt(selected.element.style.top) || 0,
          onChange: v => { selected.element.style.top = v + 'px'; } },
      ]
    },
    {
      label: 'Appearance',
      properties: [
        { key: 'color', label: 'Fill Color', type: 'color',
          value: selected.type === 'triangle'
            ? selected.element.style.borderBottomColor
            : selected.element.style.backgroundColor,
          onChange: v => {
            if (selected.type === 'triangle') selected.element.style.borderBottomColor = v;
            else selected.element.style.background = v;
          }
        },
      ]
    },
    {
      label: 'Content',
      properties: selected.type !== 'triangle' ? [
        { key: 'title', label: 'Title', type: 'text',
          value: selected.element.textContent.trim(),
          onChange: v => { selected.element.textContent = v; }
        },
      ] : []
    }
  ].filter(g => g.properties.length > 0);
}
```

---

### App Shell Demo Page

#### [MODIFY] [index.html](file:///Users/martino/git/scribus/open-layout/app-shell/index.html)

Remove the hardcoded `<h3>Properties</h3>` and `<div id="properties-view">`
from the `slot="panels"` div. The shell now manages panel content entirely:

```html
<div slot="panels" id="panel-content">
  <!-- Shell-managed panel content -->
</div>
```

---

### Shell CSS

#### [MODIFY] [shell.css](file:///Users/martino/git/scribus/open-layout/app-shell/css/shell.css)

Add styles for:
- `.panel-tabs` — tab bar (flex row, border-bottom)
- `.panel-tab` — individual tab button (text, accent underline on active)
- `.panel-tab.active` — active state
- `.property-group` — section container with heading
- `.property-row` — label + value layout (2-column grid)
- `.property-readonly` — dim text for read-only values

---

### E2E Tests

#### [MODIFY] [shapes-demo.spec.js](file:///Users/martino/git/scribus/open-layout/app-shell/test/shapes-demo.spec.js)

Update the existing `'selecting a shape updates the panels'` test to check
for the new property groups layout instead of the old single `<scribus-input>`.

#### [NEW] [properties-panel.spec.js](file:///Users/martino/git/scribus/open-layout/app-shell/test/properties-panel.spec.js)

New spec covering:
- Properties tab is active by default
- Selecting a shape shows Object, Position, Appearance, Content groups
- Read-only fields (Type, ID) are not editable
- Editing Position X/Y updates the shape element
- Editing color updates the shape's fill
- Editing title updates the shape's text
- Clearing selection shows empty state
- Tab buttons render (even if only Properties for now)

---

## Open Questions

> [!IMPORTANT]
> **Should `onChange` from property descriptors go through command history?**
> Currently the shapes-demo `getPanelContent` does _not_ submit title
> changes to history. With structured descriptors, should the shell
> automatically wrap `onChange` calls in `shell.history.submit()`?
> My recommendation: no — leave it to the plugin, since some changes
> (like live color previews) shouldn't create undo entries on every keystroke.

> [!NOTE]
> **Story-editor / spread-editor migration.** This plan keeps backward compat
> via the `getPanelContent` fallback. Those editors will be migrated to
> `getPanelDescriptors` in a follow-up task. Is that acceptable?

## Verification Plan

### Automated Tests

1. `npm test` — unit tests pass (no unit-level changes expected)
2. `npx playwright test app-shell/test/shapes-demo.spec.js` — updated test passes
3. `npx playwright test app-shell/test/properties-panel.spec.js` — new test passes

### Manual Verification

- Open `http://localhost:8000/app-shell/` and verify:
  - Side panel shows a "Properties" tab (active by default)
  - Clicking a circle shows Object (type=circle, id=c1), Position, Appearance, Content groups
  - Editing X/Y moves the shape
  - Color picker changes the fill
  - Triangle shows no Content group
  - Deselecting shows "Select an object to inspect" placeholder
