// drag-state.js — pure state machine for box drag interactions (no DOM dependencies)

/**
 * Manages the state of a box pointer interaction (move or resize).
 * Determines whether the interaction was a drag or a click-through,
 * and computes the box transformation on each move.
 *
 * @typedef {{ x: number, y: number }} Point
 * @typedef {{ id: string, x: number, y: number, width: number, height: number, [k: string]: unknown }} Box
 */
export class DragState {
  /**
   * @param {object} opts
   * @param {string} opts.boxId
   * @param {string} opts.handle — 'body', 'n', 'ne', 'e', 'se', 's', 'sw', 'w', 'nw'
   * @param {Point}  opts.start — SVG-space start point
   * @param {Box}    opts.startBox — snapshot of the box at drag start
   * @param {boolean} opts.wasAlreadySelected
   * @param {number} [opts.moveThreshold=1] — minimum px to count as drag
   */
  constructor({ boxId, handle, start, startBox, wasAlreadySelected, moveThreshold = 1 }) {
    this.boxId = boxId;
    this.handle = handle;
    this.start = start;
    this.startBox = { ...startBox };
    this.wasAlreadySelected = wasAlreadySelected;
    this._moveThreshold = moveThreshold;
    this._moved = false;
  }

  /** @returns {boolean} whether the pointer has moved beyond the threshold */
  get moved() {
    return this._moved;
  }

  /**
   * Process a pointer move. Returns the delta from start.
   * @param {Point} current — current SVG-space point
   * @returns {{ dx: number, dy: number, moved: boolean }}
   */
  pointerMove(current) {
    const dx = current.x - this.start.x;
    const dy = current.y - this.start.y;
    this._moved = this._moved || Math.abs(dx) > this._moveThreshold || Math.abs(dy) > this._moveThreshold;
    return { dx, dy, moved: this._moved };
  }

  /**
   * Determine the result of the pointer-up event.
   * @returns {{ clickThrough: boolean, boxId: string, wasAlreadySelected: boolean }}
   */
  resolve() {
    return {
      clickThrough: this.handle === 'body' && !this._moved,
      boxId: this.boxId,
      wasAlreadySelected: this.wasAlreadySelected,
    };
  }
}
