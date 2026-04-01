# Implementation Plan: Rich Clipboard Service

## Overview
Enable rich object copy-pasting (shapes, text, components) across different browser windows of the same Scribus origin.

## Best Practice Strategy
1.  **System Clipboard (`navigator.clipboard`)**: 
    - The gold standard for cross-app and cross-window sharing.
    - We will write multiple formats: `application/vnd.scribus.item+json` and `text/plain`.
2.  **Shared Storage (`localStorage`)**: 
    - Used as a "Local Clipboard" to overcome browser-specific restrictions on custom MIME types.
    - When a user copies, we both write to the system clipboard and update a `scribus_local_clipboard` key in `localStorage`.
3.  **Serialization**:
    - Build a `Serializer` that takes a `selectable` shape and produces a compact JSON object capturing all aesthetic and structural properties.
4.  **Security**:
    - Sanitize all pasted content to prevent malicious code injection via the clipboard.

## Task List

- [ ] Create `docs/app-shell/lib/clipboard-service.js`
- [ ] Implement `ClipboardService.copy(items)`
- [ ] Implement `ClipboardService.paste()`
- [ ] Define serialization/deserialization for Shapes
- [ ] Wire up global `copy` and `paste` listeners in `AppShell`
- [ ] Provide UI feedback (status messages)

## Example JSON Fragment
```json
{
  "type": "scribus-fragment",
  "version": 1,
  "items": [
    {
      "type": "circle",
      "style": { "background": "#ff4081" },
      "text": "Copied Circle"
    }
  ]
}
```

## Verification
1. Open two tabs showing `docs/app-shell/index.html`.
2. Select a shape in Tab 1, press `Ctrl+C`.
3. Move to Tab 2, press `Ctrl+V`.
4. Verify the shape is cloned with all styles.

---
Created: 2026-04-01
Status: Draft
