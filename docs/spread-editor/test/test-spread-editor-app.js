import '../../app-shell/test/dom-mock.js';
import test from 'node:test';
import assert from 'node:assert';
import { SpreadEditorApp } from '../app/spread-editor-app.js';

// Mock shell
const mockShell = {
  registerPlugin: () => {},
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
  
  // Mock editor and engine to avoid crashes during update()
  app.editor = { 
    getTypingStyle: () => ({}),
    story: {},
    cursor: {},
    hasSelection: () => false
  };
  app.engine = {
    renderToContainer: async () => ({ svg: globalThis.document.createElement('svg'), lineMap: new Map() })
  };
  // Mock update to be a no-op or just resolve
  app.update = async () => {};

  await t.test('initial mode should be object', () => {
    assert.strictEqual(app.mode, 'object');
  });

  await t.test('setMode updates mode and shell attribute', async () => {
    await app.setMode('text');
    assert.strictEqual(app.mode, 'text');
    assert.strictEqual(shellEl['data-mode'], 'text');
    
    await app.setMode('object');
    assert.strictEqual(app.mode, 'object');
    assert.strictEqual(shellEl['data-mode'], 'object');
  });

  await t.test('getRibbonSections returns correct sections for object mode', () => {
    app.mode = 'object';
    const sections = app.getRibbonSections();
    const labels = sections.map(s => s.label);
    assert.ok(labels.includes('Status'));
    assert.ok(labels.includes('Geometry'));
    assert.ok(labels.includes('Spread'));
    assert.ok(!labels.includes('Typography'));
  });

  await t.test('getRibbonSections returns correct sections for text mode', () => {
    app.mode = 'text';
    const sections = app.getRibbonSections();
    const labels = sections.map(s => s.label);
    assert.ok(labels.includes('Typography'));
    assert.ok(labels.includes('Formatting'));
    assert.ok(!labels.includes('Geometry'));
  });
});
