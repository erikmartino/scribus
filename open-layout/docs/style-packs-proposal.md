# Proposal: Hierarchical Style Packs & Paragraph Styles

This document elaborates on the proposal for representing paragraph and character styles using hierarchical **Style Packs** and **Paragraph Styles**. It reviews the mechanics, identifies structural ambiguities, and assesses the architectural feasibility for `open-layout`.

---

## 1. Core Mechanics

### A. Root Style Pack & Root Paragraph Style
*   **Root Style Pack**: A system-level, read-only style pack. It acts as the absolute parent of all user-created style packs.
*   **Root Paragraph Style**: Included in the Root Style Pack. It is read-only and defines the base typographic defaults:
    *   **Font Family**: `Garamond`
    *   **Font Size**: `10pt`
    *   **Font Weight/Style**: `Regular`

### B. Hierarchical Style Packs (Packs Inheritance)
Users can create custom child style packs that reference a parent style pack:
```
[ Root Style Pack ] (Read-only)
       ▲
       │ (inherits / references)
[ Child Style Pack A ]
       ▲
       │ (inherits / references)
[ Child Style Pack B ]
```
A child style pack inherits all styles defined in its parent chain. If a style in the child has the same name as a style in the parent, the parent style is **shadowed (hidden)** from the child pack's namespace.

### C. Hierarchical Paragraph Styles (Styles Inheritance)
Paragraph styles within a pack can inherit properties from a parent style (usually the corresponding style in the parent pack, though this is not strictly required):
```
[ Default Para Style (Root) ] ── (Name: "Normal", Font: Garamond 10)
            ▲
            │ (usually inherits, but customizable)
[ Child Para Style (A) ] ──────── (Name: "Normal", Font Size: 12)
```

---

## 2. Ambiguities & Clarifications Required

Before implementing this design, several architectural and behavioral edge cases must be clarified:

### Ambiguity 1: Scope of Shadows (Name vs. ID Matching)
*   **Problem**: If `Child Style Pack A` defines a paragraph style named `"Normal"`, it hides the parent pack's style named `"Normal"`.
*   **Question**: Does the child style automatically inherit from the hidden parent style?
    *   *Option A (Implicit Inheritance)*: Yes, if the names match, the child style inherits properties from the parent style unless overridden.
    *   *Option B (Explicit Linking)*: No, inheritance is determined strictly by a parent ID reference (e.g. `parent: "root-normal-id"`). Shadowing only affects what is visible when querying the list of available styles.
*   **Recommendation**: **Option B**. Explicit ID references are far more robust for serialization and avoid circular loops or name-collision bugs when styles are renamed.

### Ambiguity 2: Style Packs vs. Document Boundary
*   **Problem**: Do Style Packs live globally in the editor workspace, or are they bound to individual documents?
*   **Recommendation**: Style Packs should be registered in the document model metadata. This ensures that when a document is saved and loaded via the [document-store](file:///home/martino/git/scribus/open-layout/document-store/), its inheritance chain remains intact.

### Ambiguity 3: Unlinked Styles & Default Fallbacks
*   **Problem**: If a user creates a new paragraph style `"Sidebar Body"` in a child pack and does *not* assign a parent style, what does it inherit from?
*   **Recommendation**: Every custom style must fall back to the **Root Paragraph Style** (Garamond 10) if no explicit parent style is specified. This ensures that every style resolves to a valid font family and size.

### Ambiguity 4: Character Styles Integration
*   **Problem**: How do character style runs (inline overrides) interact with Style Packs?
*   **Recommendation**: Style Packs should contain both a `paragraphStyles` collection and a `characterStyles` collection. Character styles should follow the same inheritance/shadowing rules as paragraph styles.

---

## 3. Proposed JSON Schema Representation

To support serialization in the document store, we propose the following schema for the Document Model:

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
          "name": "Normal",
          "fontFamily": "Garamond",
          "fontSize": 10,
          "fontWeight": "regular",
          "parent": null
        }
      ]
    },
    {
      "id": "brand-pack-a",
      "parent": "root-pack",
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
          "name": "Heading 1",
          "fontSize": 20,
          "fontWeight": "bold",
          "parent": "root-default"
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
