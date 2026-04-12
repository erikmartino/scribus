/**
 * AbstractItem - Protocol for items managed by the App Shell.
 * Consumer demos (Story Editor, Shapes) should wrap their items in this.
 */
export class AbstractItem {
  constructor(id, type) {
    this.id = id;
    this.type = type; // e.g., 'text-frame', 'circle'
    this.data = null; // Private implementation-specific data
  }

  /**
   * Returns a serializable version of the item.
   * Plugins should override this to return their rich content.
   */
  serialize() {
    return {
      id: this.id,
      type: this.type,
      data: this.data
    };
  }

  /**
   * Generic export for clipboard.
   */
  export() {
    return JSON.stringify(this.serialize());
  }
}

/**
 * DocumentModel - A generic registry of AbstractItems.
 * This is a "Black Box" that the shell manages.
 */
export class DocumentModel extends EventTarget {
  constructor() {
    super();
    this.items = new Map();
    this.metadata = {
      title: 'Untitled',
      createdAt: new Date().toISOString()
    };
  }

  registerItem(item) {
    if (!(item instanceof AbstractItem)) {
      console.warn('Registering non-AbstractItem. This may break shell services.');
    }
    this.items.set(item.id, item);
    this.dispatchEvent(new CustomEvent('items-changed', { detail: { action: 'add', item } }));
  }

  removeItem(id) {
    const item = this.items.get(id);
    if (item) {
      this.items.delete(id);
      this.dispatchEvent(new CustomEvent('items-changed', { detail: { action: 'remove', item } }));
    }
  }

  get(id) {
    return this.items.get(id);
  }

  getAll() {
    return Array.from(this.items.values());
  }

  clear() {
    this.items.clear();
    this.dispatchEvent(new CustomEvent('items-changed', { detail: { action: 'clear' } }));
  }
  
  serialize() {
    return {
      metadata: this.metadata,
      items: this.getAll().map(i => i.serialize())
    };
  }
}

export const activeDocument = new DocumentModel();
