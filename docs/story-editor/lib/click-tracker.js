// click-tracker.js — pure state machine for multi-click detection and drag mode

/**
 * Tracks multi-click sequences (single, double, triple) and determines
 * the drag selection mode. No DOM dependencies.
 *
 * @typedef {'char'|'word'|'paragraph'} DragMode
 */
export class ClickTracker {
  /**
   * @param {number} [multiClickThreshold=350] — maximum ms between clicks to count as multi-click
   */
  constructor(multiClickThreshold = 350) {
    this._threshold = multiClickThreshold;
    this._lastClickTime = 0;
    this._clickCount = 0;
  }

  /** @returns {number} current click count (1, 2, 3+) */
  get clickCount() {
    return this._clickCount;
  }

  /**
   * Register a click at the given timestamp.
   * @param {number} now — timestamp in ms (e.g. Date.now())
   * @returns {number} the updated click count
   */
  registerClick(now) {
    if (now - this._lastClickTime < this._threshold) {
      this._clickCount++;
    } else {
      this._clickCount = 1;
    }
    this._lastClickTime = now;
    return this._clickCount;
  }

  /**
   * Determine the drag/selection mode based on the current click count
   * and whether shift is held.
   *
   * @param {{ shiftKey: boolean }} modifiers
   * @returns {{ mode: DragMode, action: 'extend'|'word'|'paragraph'|'caret' }}
   */
  resolveAction(modifiers) {
    if (modifiers.shiftKey) {
      return { mode: 'char', action: 'extend' };
    }
    if (this._clickCount >= 3) {
      return { mode: 'paragraph', action: 'paragraph' };
    }
    if (this._clickCount === 2) {
      return { mode: 'word', action: 'word' };
    }
    return { mode: 'char', action: 'caret' };
  }

  /**
   * Reset the click counter (e.g. when focus is lost).
   */
  reset() {
    this._clickCount = 0;
    this._lastClickTime = 0;
  }
}
