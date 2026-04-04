import { moveBox, resizeBox, replaceBox } from './box-model.js';

export class BoxInteractionController {
  constructor({ getSvg, getBounds, getBoxes, setBoxes, onSelectBox, onBodyClick }) {
    this._getSvg = getSvg;
    this._getBounds = getBounds;
    this._getBoxes = getBoxes;
    this._setBoxes = setBoxes;
    this._onSelectBox = onSelectBox;
    this._onBodyClick = onBodyClick;

    this._state = null;
    this._boundMove = (event) => this._pointerMove(event);
    this._boundUp = (event) => this._pointerUp(event);
  }

  pointerDown(event, boxId, handle) {
    const box = this._getBoxes().find((b) => b.id === boxId);
    if (!box) return false;

    const start = this._toSvgPoint(event);
    if (!start) return false;

    this._onSelectBox(boxId);
    this._state = {
      boxId,
      handle,
      start,
      startBox: { ...box },
      moved: false,
      wasAlreadySelected: !!event.wasAlreadySelected
    };

    window.addEventListener('pointermove', this._boundMove);
    window.addEventListener('pointerup', this._boundUp);
    window.addEventListener('pointercancel', this._boundUp);
    return true;
  }

  _pointerMove(event) {
    if (!this._state) return;
    const now = this._toSvgPoint(event);
    if (!now) return;

    const dx = now.x - this._state.start.x;
    const dy = now.y - this._state.start.y;
    const bounds = this._getBounds();

    let nextBox;
    if (this._state.handle === 'body') {
      nextBox = moveBox(this._state.startBox, dx, dy, bounds);
    } else {
      nextBox = resizeBox(this._state.startBox, this._state.handle, dx, dy, bounds);
    }

    this._state.moved = this._state.moved || Math.abs(dx) > 1 || Math.abs(dy) > 1;

    this._setBoxes((boxes) => replaceBox(boxes, nextBox));
  }

  _pointerUp(event) {
    if (!this._state) return;

    const clickThrough = this._state.handle === 'body' && !this._state.moved;
    const boxId = this._state.boxId;
    const wasAlreadySelected = this._state.wasAlreadySelected;

    this._state = null;
    window.removeEventListener('pointermove', this._boundMove);
    window.removeEventListener('pointerup', this._boundUp);
    window.removeEventListener('pointercancel', this._boundUp);

    if (clickThrough) {
      this._onBodyClick(event, boxId, wasAlreadySelected);
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
