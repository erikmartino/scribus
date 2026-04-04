// Polyfill/Mock minimal DOM for Node.js environment
// Specifically for testing Scribus components and plugins

globalThis.HTMLElement = class {};
globalThis.EventTarget = class {
  constructor() {
    this._listeners = new Map();
  }
  addEventListener(type, listener) {
    if (!this._listeners.has(type)) this._listeners.set(type, []);
    this._listeners.get(type).push(listener);
  }
  removeEventListener(type, listener) {
    const list = this._listeners.get(type);
    if (list) {
      const idx = list.indexOf(listener);
      if (idx !== -1) list.splice(idx, 1);
    }
  }
  dispatchEvent(event) {
    const list = this._listeners.get(event.type);
    if (list) list.forEach(l => l(event));
    return true;
  }
};

globalThis.addEventListener = () => {};
globalThis.removeEventListener = () => {};
globalThis.dispatchEvent = () => {};

globalThis.CustomEvent = class { constructor(type) { this.type = type; } };

globalThis.localStorage = {
  getItem: () => null,
  setItem: () => {},
  removeItem: () => {},
  clear: () => {}
};

globalThis.customElements = {
  get: () => null,
  define: () => {}
};

globalThis.document = {
  activeElement: { tagName: 'BODY' },
  addEventListener: () => {},
  removeEventListener: () => {},
  getElementById: (id) => {
    const el = globalThis.document.createElement('div');
    el.id = id;
    if (id === 'status') el.textContent = 'Ready';
    return el;
  },
  createElement: (tag) => {
    const el = new globalThis.EventTarget();
    el.tagName = tag.toUpperCase();
    el.style = {};
    el.setAttribute = (k, v) => { 
      el[k] = v; 
      el.dataset = el.dataset || {}; 
      if (k.startsWith('data-')) el.dataset[k.slice(5)] = v; 
    };
    el.removeAttribute = (k) => { delete el[k]; };
    el.toggleAttribute = (k, force) => { el[k] = force !== undefined ? !!force : !el[k]; };
    el.appendChild = (child) => child;
    el.querySelector = () => null;
    el.classList = { 
      add: () => {}, 
      remove: () => {}, 
      contains: () => false,
      toggle: () => {}
    };
    el.focus = () => {};
    el.textContent = '';
    el.dataset = {};
    return el;
  },
  createDocumentFragment: () => ({
    appendChild: () => {}
  }),
  querySelector: (query) => {
    // Return a basic mock for commonly queried elements
    if (query === 'scribus-app-shell') {
      const el = globalThis.document.createElement('scribus-app-shell');
      return el;
    }
    return null;
  },
  querySelectorAll: () => []
};

globalThis.window = globalThis;
globalThis.requestAnimationFrame = (cb) => setTimeout(cb, 0);

// Stub for AppShell static methods
export class MockAppShell {
  static createRibbonSection(label, builder) {
    const container = globalThis.document.createElement('div');
    builder(container);
    return { label, container };
  }
}
globalThis.AppShell = MockAppShell;
