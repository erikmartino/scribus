import { moveBox, resizeBox, replaceBox, resizeBoxWithAspect } from './box-model.js';
import { DragState } from './drag-state.js';
import { getImagePlacement } from '../../doc-renderer/lib/svg-renderer.js';

export class BoxInteractionController {
  constructor({ getSvg, getBounds, getBoxes, getActiveCroppingMode, setBoxes, onSelectBox, onBodyClick }) {
    this._getSvg = getSvg;
    this._getBounds = getBounds;
    this._getBoxes = getBoxes;
    this._getActiveCroppingMode = getActiveCroppingMode || (() => 1);
    this._setBoxes = setBoxes;
    this._onSelectBox = onSelectBox;
    this._onBodyClick = onBodyClick;

    this._drag = null;
    this._boundMove = (event) => this._pointerMove(event);
    this._boundUp = (event) => this._pointerUp(event);
    this._boundSelectStart = (e) => e.preventDefault();
  }

  pointerDown(event, boxId, handle) {
    const box = this._getBoxes().find((b) => b.id === boxId);
    if (!box) return false;

    const start = this._toSvgPoint(event);
    if (!start) return false;

    // Clear any active text selections in the window
    window.getSelection()?.removeAllRanges();

    // Prevent new text selections from starting during the drag/resize operation
    window.addEventListener('selectstart', this._boundSelectStart);

    this._onSelectBox(boxId);
    this._drag = new DragState({
      boxId,
      handle,
      start,
      startBox: box,
      wasAlreadySelected: !!event.wasAlreadySelected,
    });

    window.addEventListener('pointermove', this._boundMove);
    window.addEventListener('pointerup', this._boundUp);
    window.addEventListener('pointercancel', this._boundUp);
    return true;
  }

  _pointerMove(event) {
    if (!this._drag) return;
    const now = this._toSvgPoint(event);
    if (!now) return;

    const { dx, dy } = this._drag.pointerMove(now);
    const bounds = this._getBounds();

    const startBox = this._drag.startBox;
    const isImage = !!startBox.imageUrl;
    const activeCroppingMode = this._getActiveCroppingMode();
    const handle = this._drag.handle;
    
    let nextBox = { ...startBox };

    if (handle.startsWith('content_')) {
      // MODE 3: Content-Only Transform (Image content moves or scales, crop box is fixed)
      const subHandle = handle.replace('content_', '');
      
      const placement = startBox.placement || {};
      const imgW = startBox.imgWidth || startBox.width;
      const imgH = startBox.imgHeight || startBox.height;
      const frameW = startBox.width;
      const frameH = startBox.height;
      const fitMode = placement.fitMode || 'stretch';
      const alignH = placement.alignH || 'center';
      const alignV = placement.alignV || 'center';

      // 1. Calculate Cover/Fit base dimensions and baseline translation
      let baseW = frameW;
      let baseH = frameH;
      if (fitMode === 'fit') {
        const s = Math.min(frameW / imgW, frameH / imgH);
        baseW = imgW * s;
        baseH = imgH * s;
      } else if (fitMode === 'fill' || fitMode === 'cover') {
        const s = Math.max(frameW / imgW, frameH / imgH);
        baseW = imgW * s;
        baseH = imgH * s;
      }

      const baseTranslateX = (alignH === 'left') ? 0 : (alignH === 'right' ? (frameW - baseW) : (frameW - baseW) / 2);
      const baseTranslateY = (alignV === 'top') ? 0 : (alignV === 'bottom' ? (frameH - baseH) : (frameH - baseH) / 2);

      // Start absolute/rendered dimensions and positions inside frame coordinate space
      const startScaleX = placement.scaleX ?? placement.scale ?? 1.0;
      const startScaleY = placement.scaleY ?? placement.scale ?? 1.0;
      const startW = baseW * startScaleX;
      const startH = baseH * startScaleY;
      const startX = baseTranslateX + (placement.offsetX ?? 0) - (startW - baseW) / 2;
      const startY = baseTranslateY + (placement.offsetY ?? 0) - (startH - baseH) / 2;

      const currentContentBox = {
        x: startX,
        y: startY,
        width: startW,
        height: startH,
        minWidth: 10,
        minHeight: 10
      };

      let nextContentBox;
      if (subHandle === 'body') {
        nextContentBox = {
          ...currentContentBox,
          x: currentContentBox.x + dx,
          y: currentContentBox.y + dy
        };
      } else {
        // Uniform aspect ratio is locked by default unless Shift key is down!
        const origAspect = startW / startH;
        const aspect = event.shiftKey ? null : origAspect;
        nextContentBox = resizeBoxWithAspect(currentContentBox, subHandle, dx, dy, aspect);
      }

      // 3. Map final absolute content coordinates back to relative offsetX, offsetY, scaleX, scaleY
      const finalW = nextContentBox.width;
      const finalH = nextContentBox.height;
      const finalScaleX = finalW / baseW;
      const finalScaleY = finalH / baseH;
      const finalX = nextContentBox.x;
      const finalY = nextContentBox.y;

      const nextPlacement = {
        ...placement,
        scale: finalScaleX === finalScaleY ? finalScaleX : undefined,
        scaleX: finalScaleX,
        scaleY: finalScaleY,
        offsetX: finalX - baseTranslateX + (finalW - baseW) / 2,
        offsetY: finalY - baseTranslateY + (finalH - baseH) / 2
      };

      nextBox.placement = nextPlacement;
    } else {
      let aspect = null;
      if (isImage) {
        if (!event.shiftKey) {
          aspect = startBox.width / startBox.height;
        }
      } else {
        if (event.shiftKey) {
          aspect = startBox.width / startBox.height;
        }
      }

      if (handle === 'body') {
        nextBox = moveBox(startBox, dx, dy, bounds);
      } else {
        nextBox = resizeBoxWithAspect(startBox, handle, dx, dy, aspect);
      }

      if (isImage && (activeCroppingMode === 1 || activeCroppingMode === 2)) {
        // MODE 1 & 2: Image transformations
        const placement = startBox.placement || {};
        const imgW = startBox.imgWidth || startBox.width;
        const imgH = startBox.imgHeight || startBox.height;

        // Base Cover/Fit dimensions and alignment offsets for original start box
        let startBaseW = startBox.width;
        let startBaseH = startBox.height;
        const fitMode = placement.fitMode || 'stretch';
        const alignH = placement.alignH || 'center';
        const alignV = placement.alignV || 'center';

        if (fitMode === 'fit') {
          const s = Math.min(startBox.width / imgW, startBox.height / imgH);
          startBaseW = imgW * s;
          startBaseH = imgH * s;
        } else if (fitMode === 'fill' || fitMode === 'cover') {
          const s = Math.max(startBox.width / imgW, startBox.height / imgH);
          startBaseW = imgW * s;
          startBaseH = imgH * s;
        }

        const startBaseTranslateX = (alignH === 'left') ? 0 : (alignH === 'right' ? (startBox.width - startBaseW) : (startBox.width - startBaseW) / 2);
        const startBaseTranslateY = (alignV === 'top') ? 0 : (alignV === 'bottom' ? (startBox.height - startBaseH) : (startBox.height - startBaseH) / 2);

        // Current image absolute coordinates and size (in startBox space, but relative to top-left)
        const scaleX = placement.scaleX ?? placement.scale ?? 1.0;
        const scaleY = placement.scaleY ?? placement.scale ?? 1.0;
        const currentW = startBaseW * scaleX;
        const currentH = startBaseH * scaleY;
        const currentRelX = startBaseTranslateX + (placement.offsetX ?? 0) - (currentW - startBaseW) / 2;
        const currentRelY = startBaseTranslateY + (placement.offsetY ?? 0) - (currentH - startBaseH) / 2;

        let targetW, targetH, targetRelX, targetRelY;

        if (activeCroppingMode === 1) {
          // MODE 1: Combined scale & move. Physical image content scales & moves proportionally to frame resize.
          const s_x = startBox.width > 0 ? (nextBox.width / startBox.width) : 1.0;
          const s_y = startBox.height > 0 ? (nextBox.height / startBox.height) : 1.0;

          targetW = currentW * s_x;
          targetH = currentH * s_y;
          targetRelX = currentRelX * s_x;
          targetRelY = currentRelY * s_y;
        } else {
          // MODE 2: Adjust crop box but keep underlying image content physically static in pasteboard space
          // Current image position in absolute pasteboard space
          const absoluteImgX = startBox.x + currentRelX;
          const absoluteImgY = startBox.y + currentRelY;

          targetW = currentW;
          targetH = currentH;
          targetRelX = absoluteImgX - nextBox.x;
          targetRelY = absoluteImgY - nextBox.y;
        }

        // Cover/Fit dimensions and alignment offsets for the new nextBox frame size
        let newBaseW = nextBox.width;
        let newBaseH = nextBox.height;
        if (fitMode === 'fit') {
          const s = Math.min(nextBox.width / imgW, nextBox.height / imgH);
          newBaseW = imgW * s;
          newBaseH = imgH * s;
        } else if (fitMode === 'fill' || fitMode === 'cover') {
          const s = Math.max(nextBox.width / imgW, nextBox.height / imgH);
          newBaseW = imgW * s;
          newBaseH = imgH * s;
        }

        const newBaseTranslateX = (alignH === 'left') ? 0 : (alignH === 'right' ? (nextBox.width - newBaseW) : (nextBox.width - newBaseW) / 2);
        const newBaseTranslateY = (alignV === 'top') ? 0 : (alignV === 'bottom' ? (nextBox.height - newBaseH) : (nextBox.height - newBaseH) / 2);

        // Map final placement parameters for nextBox frame
        const nextScaleX = targetW / newBaseW;
        const nextScaleY = targetH / newBaseH;

        const nextPlacement = {
          ...placement,
          scale: nextScaleX === nextScaleY ? nextScaleX : undefined,
          scaleX: nextScaleX,
          scaleY: nextScaleY,
          offsetX: targetRelX - newBaseTranslateX + (targetW - newBaseW) / 2,
          offsetY: targetRelY - newBaseTranslateY + (targetH - newBaseH) / 2
        };

        nextBox.placement = nextPlacement;
      }
    }

    this._setBoxes((boxes) => replaceBox(boxes, nextBox));
  }

  _pointerUp(event) {
    if (!this._drag) return;

    const result = this._drag.resolve();

    this._drag = null;
    window.removeEventListener('pointermove', this._boundMove);
    window.removeEventListener('pointerup', this._boundUp);
    window.removeEventListener('pointercancel', this._boundUp);
    window.removeEventListener('selectstart', this._boundSelectStart);

    if (result.clickThrough) {
      this._onBodyClick(event, result.boxId, result.wasAlreadySelected);
    }
  }

  _toSvgPoint(event) {
    const svg = this._getSvg();
    if (!svg) return null;

    const ctm = svg.getScreenCTM();
    if (!ctm) return null;

    const PointCtor = typeof DOMPoint === 'function'
      ? DOMPoint
      : (typeof window !== 'undefined' && typeof window.DOMPoint === 'function' ? window.DOMPoint : null);
    if (!PointCtor) return null;

    return new PointCtor(event.clientX, event.clientY).matrixTransform(ctm.inverse());
  }
}
