import { moveBox, resizeBox, replaceBox } from './box-model.js';
import { DragState } from './drag-state.js';

export class BoxInteractionController {
  constructor({ getSvg, getBounds, getBoxes, setBoxes, onSelectBox, onBodyClick }) {
    this._getSvg = getSvg;
    this._getBounds = getBounds;
    this._getBoxes = getBoxes;
    this._setBoxes = setBoxes;
    this._onSelectBox = onSelectBox;
    this._onBodyClick = onBodyClick;

    this._drag = null;
    this._boundMove = (event) => this._pointerMove(event);
    this._boundUp = (event) => this._pointerUp(event);
  }

  pointerDown(event, boxId, handle) {
    const box = this._getBoxes().find((b) => b.id === boxId);
    if (!box) return false;

    const start = this._toSvgPoint(event);
    if (!start) return false;

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

    let nextBox;
    if (this._drag.handle === 'body') {
      nextBox = moveBox(this._drag.startBox, dx, dy, bounds);
    } else {
      nextBox = resizeBox(this._drag.startBox, this._drag.handle, dx, dy, bounds);
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
