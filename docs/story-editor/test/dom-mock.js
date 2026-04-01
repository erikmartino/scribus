// Polyfill/Mock minimal DOM for Node.js environment
globalThis.HTMLElement = class {};
globalThis.EventTarget = class {
    addEventListener() {}
    removeEventListener() {}
    dispatchEvent() {}
};
globalThis.addEventListener = () => {};
globalThis.removeEventListener = () => {};
globalThis.dispatchEvent = () => {};
globalThis.CustomEvent = class {};
globalThis.requestAnimationFrame = (cb) => setTimeout(cb, 0);
globalThis.window = globalThis;
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
  getElementById: (id) => ({
    value: '100',
    appendChild: () => {},
    textContent: '',
    toggleAttribute: () => {},
    style: {},
    addEventListener: () => {},
    onchange: null
  }),
  createElement: (tag) => ({
    style: {},
    appendChild: () => {},
    addEventListener: () => {},
    setAttribute: () => {},
    appendChild: (child) => child,
    toggleAttribute: () => {},
    dataset: {}
  }),
  createDocumentFragment: () => ({
    appendChild: () => {}
  }),
  querySelector: () => null,
  querySelectorAll: () => []
};
