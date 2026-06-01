# Implementation Plan: Interactive Image Cropping, Fit Modes, and Scaling

**Date:** 2026-06-01  
**Status:** Implemented  

---

## 1. Context & Objectives

Currently, the open-layout system supports image boxes that fill their bounding coordinates exactly. To build a professional publishing layout editor, we need a robust, multi-mode image frame and cropping system with predictable scaling, aspect-ratio constraints, and intuitive visual previews.

We propose a **Three-Mode Cropping & Interaction Model** (similar to professional desktop publishing tools like Adobe InDesign):
1. **Mode 1 (Default): Combined Transform.** Scale or move the crop box and the image content together.
2. **Mode 2: Box-Only Transform (Crop Window).** Resize the crop box boundary while keeping the underlying image content scale and position static (mapping coordinate offsets relatively).
3. **Mode 3: Content-Only Transform.** Move or scale the image content within a fixed, locked crop box.

---

## 2. Interaction Modes & Aspect-Ratio Constraints

In **all three modes**, dragging handles to scale will **lock the aspect ratio by default** to prevent accidental skewing/distortion. Holding `Shift` overrides this lock, enabling **non-uniform aspect ratio changes** (stretching or custom proportions).

### Mode 1: Combined Scale & Move (Default Mode)
*   **Behavior:** Dragging to resize or move the image frame transforms both the crop box boundary and the image content proportionally.
*   **Aspect Ratio (No Shift):** Lock/preserve the aspect ratio of the image frame (and thus the underlying image).
*   **Aspect Ratio (With Shift):** Allows the frame's aspect ratio to change dynamically.
*   **Visuals:** Standard selection highlight and active corner/edge handles on the image frame bounding box.

### Mode 2: Box-Only Transform (Adjust Crop Window)
*   **Behavior:** Modifying the frame only resizes the crop window. The underlying image content size, scale, and spatial position in pasteboard space remain completely unchanged.
*   **Offset Preservation:** Since the image content position is stored as a relative offset to the frame's top-left corner (`offsetX`, `offsetY`), when the top-left boundary of the box is resized or moved, the offsets are dynamically adjusted so the image content appears visually anchored in pasteboard space.
*   **Aspect Ratio (No Shift):** Lock the aspect ratio of the crop window.
*   **Aspect Ratio (With Shift):** Support uniform/non-uniform resizing with shift modifier.
*   **Visuals:** Standard frame selection boundary and active handles.

### Mode 3: Content-Only Transform (Crop Adjustment)
*   **Behavior:** Moving or scaling affects only the underlying image content. The frame's bounding crop box remains locked in size and position.
*   **Aspect Ratio (No Shift):** Preserves the aspect ratio of the image content during resize.
*   **Aspect Ratio (With Shift):** Stretches or squeezes the image content non-uniformly.
*   **Scaling Limits:** Do not restrict scaling. The user is allowed to scale the image content freely (even smaller than the crop box boundary, resulting in transparent or blank margins inside the crop frame).
*   **Visuals & Visual Affordances:**
    - The locked **crop box** is styled as a simple outline square **without any active handles** (preventing accidental frame changes).
    - The underlying **image content** gets its own separate, distinct **manipulation decoration** outline (typically colored differently, e.g. amber or orange) with handles representing the full uncropped image bounds.
    - **Opacity Masking:** Image content lying *outside* the locked crop box boundary is rendered at **0.5 opacity** to show the hidden/cropped parts of the image, while the content *inside* the box is rendered at **1.0 opacity**.

---

## 3. Rendering Architectures

### A. SVG Editor Viewer (`doc-renderer/lib/svg-renderer.js`)
To render the semi-opaque outer content in Mode 3 inside the editor, we use an elegant layered SVG approach:

1. **When in Mode 3 (Content Editing):**
   - Render a background `<image>` representing the full underlying image transformed by the custom scale and offsets, styled with `opacity: 0.5; pointer-events: none;`.
   - Render a foreground cropped `<svg>` (using `x`, `y`, `width`, `height` of the fixed frame) with `overflow: hidden`. Inside this viewport, render a duplicate `<image>` with identical scale and offsets, styled at `opacity: 1.0;`.
   - Draw the orange/amber **content boundary decoration outline** with active handles mapped to the underlying full image bounds.
   - Draw a simple, clean outline stroke on the crop frame without active handles.

2. **Standard Render (Modes 1 & 2):**
   - Standard nested `<svg>` viewport with `overflow: hidden` containing the single high-opacity image.

---

### B. PDF Exporter (`pdf-generator.js` and `pdf-writer.js`)
The PDF exporter only outputs the final print version, meaning Mode 3's 0.5 opacity preview is omitted:
*   Apply the PDF clipping path operator (`q`, `x y w h re`, `W n`) representing the final cropped frame boundary.
*   Calculate the relative offsets (`offsetX`, `offsetY`) and final scale factor to set the image transform matrix (`cm`).
*   Paint the image XObject (`Do`) and restore graphics state (`Q`).

---

## 4. Proposed Interaction Flow & User Interface

### A. UI Placement
*   **Ribbon Bar Controls:** A new **"Cropping & Placement"** ribbon section is displayed dynamically in the ribbon section whenever an image frame is selected in the spread editor. It features:
    - **Mode 1 Toggle:** "Combined Transform" (Default)
    - **Mode 2 Toggle:** "Edit Frame Boundary"
    - **Mode 3 Toggle:** "Edit Content"
*   **Double-Click Trigger:** Double-clicking an image frame immediately switches the editor state to **Mode 3 (Edit Content)**. Double-clicking outside or clicking "Done" on the ribbon exits back to Mode 1.

### B. Mathematical Offset Mapping during Mode 2 Box Resize
*   Let the original box coordinates be $(X_{box}, Y_{box})$ with dimensions $(W_{box}, H_{box})$, and image offsets be $(OX, OY)$.
*   When the top-left handle is dragged to a new position $(X'_{box}, Y'_{box})$:
     - The new offsets are updated: $OX' = OX - (X'_{box} - X_{box})$ and $OY' = OY - (Y'_{box} - Y_{box})$.
     - This ensures the image content remains static in screen coordinates.

---

## 5. Implementation Milestones

*   **Milestone 1:** Add schema definitions for the three modes in `layout-document.js` and initialize defaults.
*   **Milestone 2:** Implement the layered SVG rendering in `svg-renderer.js` to support the 0.5 opacity outer image and locked inner image for Mode 3.
*   **Milestone 3:** Add keyboard listener handles to track `Shift` key state (`keydown`/`keyup`) to enforce uniform aspect ratio locks during mouse movement.
*   **Milestone 4:** Implement interactive Mode 3 orange bounding outline and handle transformations.
*   **Milestone 5:** Implement Mode 2 coordinate offsets adjustment math during box resize.
*   **Milestone 6:** Integrate mode switches and indicators into the App Shell ribbon component.
*   **Milestone 7 (Active):** Set `preserveAspectRatio="none"` on all SVG `<image>` elements (both in the editor layout renderer and the document SVG renderer) to visually enable aspect ratio changes when scaled/stretched (e.g. in Mode 1 with Shift, and Mode 3).
