# Proposal: Hierarchical Style Packs & Paragraph Styles

This document elaborates on the proposal for representing paragraph and character styles using hierarchical **Style Packs** and **Paragraph Styles**. It reviews the mechanics, identifies structural ambiguities, and assesses the architectural feasibility for `open-layout`.

---

## 1. Core Mechanics

### A. Global Read-Only Style Packs
There are two read-only global style packs that live permanently in the editor workspace:

1.  **Root Style Pack**:
    *   **Description**: The system-level root representing the absolute fallback parent of all styles.
    *   **Root Paragraph Style**: Included in the Root Style Pack. Defines base typographic defaults:
        *   **Name**: `[default]` (Special bracketed pattern to prevent shadowing; user-defined style names are forbidden from using brackets).
        *   **Font Family**: `Garamond` (Serif fallback)
        *   **Font Size**: `10pt`
        *   **Font Weight/Style**: `Regular`

2.  **HTML Element Style Pack**:
    *   **Description**: A direct child of the **Root Style Pack**.
    *   **Purpose**: Maps standard HTML elements (e.g. `p`, `h1`, `h2`, `h3`, `pre`, `code`, `em`, `strong`) to default paragraph/character styles, allowing imported HTML to be styled appropriately.
    *   **Font Pairings**:
        *   *Serif text*: `Garamond` (inherits from root).
        *   *Sans-serif text*: `Helvetica` (or `Arial`) as a clean sans-serif font pairing that complements Garamond.
        *   *Monospace text*: `Courier New` (or `Monaco`) to pair cleanly with Garamond.

### B. Hierarchical Style Packs (Packs Inheritance)
Users can create custom child style packs that reference a parent style pack:
```
 [ Root Style Pack ] (Read-only, Global)
        ▲
        │ (inherits / references)
 [ HTML Element Style Pack ] (Read-only, Global)
        ▲
        │ (inherits / references)
 [ User Style Pack A ]
        ▲
        │ (inherits / references)
 [ User Style Pack B ]
```
A child style pack inherits all styles defined in its parent chain. If a style in the child has the same name as a style in the parent, the parent style is **shadowed (hidden)** from the child pack's namespace.

### C. Hierarchical Paragraph Styles (Styles Inheritance)
Paragraph styles within a pack can inherit properties from a parent style (usually the corresponding style in the parent pack, though this is not strictly required):
```
[ Default Para Style (Root) ] ── (Name: "[default]", Font: Garamond 10)
            ▲
            │ (usually inherits, but customizable)
[ Child Para Style (A) ] ──────── (Name: "Normal", Font Size: 12)
```

---

## 2. Ambiguities & Clarifications Required

Before implementing this design, several architectural and behavioral edge cases must be clarified:

### Architectural Boundary: Shadowing vs. Style Inheritance
*   **Decision**:
    *   **Shadowing (Name-Based)**: If a child style pack defines a style with the same name as a style in the parent pack, the parent style is hidden (shadowed) from the child pack's namespace.
    *   **Unshadowable Root**: The root style has the reserved name `[default]`. The system restricts users from using bracketed names (e.g. `[...]`) for custom styles, ensuring the root default style can never be shadowed.
    *   **Inheritance (ID-Based)**: Shadowing does not dictate inheritance. A shadowed parent style is often, but not necessarily, the parent of the child style that shadows it.
    *   **Resolution**: Inheritance is determined strictly by explicit ID reference (e.g. `parent: "root-default"`). This ensures robust serialization and allows a child style to inherit from a completely different parent style (or have no parent) despite shadowing another style by name.

### Architectural Boundary: Global vs. Document-Bound Style Packs
*   **Decision**:
    *   The **Root Style Pack** and the **HTML Element Style Pack** live globally in the application runtime as read-only presets.
    *   **All other style packs** live strictly within documents. They are serialized directly inside the document JSON model. This ensures that when a document is saved and loaded via the [document-store](file:///home/martino/git/scribus/open-layout/document-store/), its specific style inheritance configurations are self-contained and fully preserved.

### Architectural Boundary: Inheritance Tree Root (Null Parent)
*   **Decision**:
    *   **Mandatory Parent**: All paragraph styles must have a parent reference.
    *   **Root Fallback**: The **Root Paragraph Style** (Garamond 10pt) in the root style pack acts as the "null" parent (the absolute root of the inheritance tree). Any style that does not inherit from another custom style must explicitly set its parent reference to this root style.

### Architectural Boundary: Character Styles Excluded from Inheritance
*   **Decision**:
    *   **Scope**: This inheritance and style pack hierarchy applies strictly to **Paragraph Styles**.
    *   **No Character Root / Inheritance**: Character styles (inline overrides) do not require a root style pack or parent/child inheritance relationships. Instead, they act as flat property bags of formatting overrides applied directly on top of the resolved paragraph style.

---

## 3. Proposed JSON Schema Representation

To support serialization in the document store, we propose the following schema for the Document Model incorporating the global read-only style packs:

```json
{
  "stylePacks": [
    {
      "id": "root-pack",
      "parent": null,
      "readOnly": true,
      "paragraphStyles": [
        {
          "id": "root-default",
          "name": "[default]",
          "fontFamily": "Garamond",
          "fontSize": 10,
          "fontWeight": "regular",
          "parent": null
        }
      ]
    },
    {
      "id": "html-pack",
      "parent": "root-pack",
      "readOnly": true,
      "paragraphStyles": [
        {
          "id": "html-p",
          "name": "p",
          "parent": "root-default"
        },
        {
          "id": "html-h1",
          "name": "h1",
          "fontFamily": "Helvetica",
          "fontSize": 24,
          "fontWeight": "bold",
          "parent": "root-default"
        },
        {
          "id": "html-code",
          "name": "code",
          "fontFamily": "Courier New",
          "fontSize": 9,
          "parent": "root-default"
        }
      ]
    },
    {
      "id": "brand-pack-a",
      "parent": "html-pack",
      "readOnly": false,
      "paragraphStyles": [
        {
          "id": "brand-normal",
          "name": "Normal",
          "fontSize": 12,
          "parent": "root-default"
        },
        {
          "id": "brand-heading",
          "name": "h1",
          "fontSize": 20,
          "parent": "html-h1"
        }
      ]
    }
  ]
}
```

---

## 4. Architectural Review

### Pros
*   **Clean Cascading Rules**: Mimics CSS custom properties or design system tokens, making it easy to create themes (e.g. standardizing heading hierarchies and swapping them per document view).
*   **Decoupled Style Sets**: By swapping the active style pack reference, you can completely restyle a document without altering the text models.

### Cons & Risks
*   **Broken Inheritance Chains**: If a parent style pack is deleted or edited, children styles referencing those parents could break. The document model must include validation rules to prevent parent pack deletion if active child references exist.
*   **Shaping Cache Invalidation**: The [LayoutEngine](file:///home/martino/git/scribus/open-layout/story-editor/lib/layout-engine.js) caches character shaping. Swapping or updating parent style pack properties must trigger a full cache invalidation to re-shape text runs.
