import '../../app-shell/test/dom-mock.js';
import test from 'node:test';
import assert from 'node:assert';
import { SpreadEditorApp } from '../app/spread-editor-app.js';

// Mock shell element that records setAttribute calls
const mockShellElement = globalThis.document.createElement('div');

// Mock shell with all methods that setMode / getRibbonSections touch
const mockShell = {
  element: mockShellElement,
  registerPlugin: () => {},
  requestUpdate: () => {},
  setMode: (mode) => {
    mockShellElement.setAttribute('data-mode', mode);
  },
  selection: { select: () => {}, remove: () => {} },
  commands: { execute: () => {} },
  ui: {
    createInput: (opts) => {
      const el = globalThis.document.createElement('input');
      el.id = opts.id;
      el.value = opts.value || '';
      return el;
    },
    createButton: (opts) => {
      const el = globalThis.document.createElement('button');
      el.id = opts.id;
      return el;
    },
    createFontSelector: (opts) => {
      const el = globalThis.document.createElement('div');
      el.id = opts.id;
      return el;
    }
  }
};

test('SpreadEditorApp Selection Modes', async (t) => {
  const root = globalThis.document.createElement('div');
  // Add mock shell element to root
  const shellEl = globalThis.document.createElement('scribus-app-shell');
  root.appendChild(shellEl);
  
  // Mock querySelector for root to find shellEl
  root.querySelector = (q) => q === 'scribus-app-shell' ? shellEl : null;

  const app = new SpreadEditorApp(root);
  app.shell = mockShell;
  
  // Mock active story — editor is a getter that reads _activeStory.editor
  app._activeStory = {
    editor: {
      getTypingStyle: () => ({}),
      story: [[{ text: 'Hello', style: {} }]],
      cursor: { paraIndex: 0, charOffset: 0, lineIndex: 0 },
      paragraphStyles: [{ fontSize: 20 }],
      hasSelection: () => false,
      getSelectionRange: () => null,
    },
    boxIds: [],
    lineMap: [],
  };
  app.engine = {
    renderToContainer: async () => ({ svg: globalThis.document.createElement('svg'), lineMap: new Map() })
  };
  // Mock update to be a no-op (prevents full layout pipeline)
  app.update = async () => {};

  await t.test('initial mode should be object', () => {
    assert.strictEqual(app.mode, 'object');
  });

  await t.test('setMode updates mode and shell attribute', () => {
    app.setMode('text');
    assert.strictEqual(app.mode, 'text');
    // shell.setMode() sets data-mode on shell.element
    assert.strictEqual(mockShellElement['data-mode'], 'text');
    
    app.setMode('object');
    assert.strictEqual(app.mode, 'object');
    assert.strictEqual(mockShellElement['data-mode'], 'object');
  });

  await t.test('getRibbonSections returns empty array for object mode', () => {
    app.mode = 'object';
    const sections = app.getRibbonSections();
    assert.ok(Array.isArray(sections));
    assert.strictEqual(sections.length, 0);
  });

  await t.test('getRibbonSections returns Typography and Formatting for text mode', () => {
    app.mode = 'text';
    const sections = app.getRibbonSections();
    // getAttribute stores as property in dom-mock, so read .label
    const labels = sections.map(s => s.label);
    assert.strictEqual(labels.length, 2);
    assert.ok(labels.includes('Typography'));
    assert.ok(labels.includes('Formatting'));
  });
});
