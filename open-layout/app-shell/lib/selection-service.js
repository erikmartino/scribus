/**
 * selection-service.js
 * Bus-like service for app-wide selection.
 */
export class SelectionService extends EventTarget {
  constructor() {
    super();
    this._items = []; // Current selection set
    this._primary = null; // The item to show in detail panels
  }

  /**
   * Returns the primary item (the one that 'owns' the inspector).
   */
  get current() {
    return this._primary;
  }

  /**
   * Returns all selected items.
   */
  get all() {
    return this._items;
  }

  /**
   * Set selection to a single item.
   */
  select(item) {
    if (!item) {
      this.clear();
      return;
    }
    this._items = [item];
    this._primary = item;
    this._dispatchChange('replace');
  }

  /**
   * Add an item to the existing selection.
   */
  add(item) {
    if (this._items.includes(item)) return;
    this._items.push(item);
    this._primary = item; // Newest is primary
    this._dispatchChange('add');
  }

  /**
   * Remove an item from selection.
   */
  remove(item) {
    this._items = this._items.filter(i => i !== item);
    if (this._primary === item) {
      this._primary = this._items[this._items.length - 1] || null;
    }
    this._dispatchChange('remove');
  }

  /**
   * Toggle an item's selection state.
   */
  toggle(item) {
    if (this._items.includes(item)) {
      this.remove(item);
    } else {
      this.add(item);
    }
  }

  clear() {
    this._items = [];
    this._primary = null;
    this._dispatchChange('clear');
  }

  getSelection() {
    return this._primary;
  }

  _dispatchChange(action) {
    const event = new CustomEvent('selectionchange', { 
      detail: { 
        action,
        primary: this._primary, 
        all: this._items 
      }
    });
    this.dispatchEvent(event);
  }
}

export const selection = new SelectionService();
