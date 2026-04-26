import { describe, it, beforeEach } from 'node:test';
import { strict as assert } from 'node:assert';

// Minimal DOM shim for unit-testing property-descriptors in Node.
// Only the subset used by renderProperty / renderPropertyGroups.
class MockElement {
  constructor(tag) {
    this.tagName = tag.toUpperCase();
    this.className = '';
    this.textContent = '';
    this.innerHTML = '';
    this.children = [];
    this.attributes = {};
    this.dataset = {};
    this.style = {};
    this._listeners = {};
  }
  setAttribute(k, v) { this.attributes[k] = v; }
  getAttribute(k) { return this.attributes[k] ?? null; }
  appendChild(child) { this.children.push(child); return child; }
  querySelector(sel) { return null; }
  addEventListener(ev, fn) {
    if (!this._listeners[ev]) this._listeners[ev] = [];
    this._listeners[ev].push(fn);
  }
}

// Install minimal global document
const origDoc = globalThis.document;
globalThis.document = {
  createElement(tag) { return new MockElement(tag); },
  createDocumentFragment() {
    const frag = new MockElement('fragment');
    frag.tagName = '#document-fragment';
    return frag;
  }
};

// Now import the module under test
const { renderProperty, renderPropertyGroups } = await import('../lib/property-descriptors.js');

// Restore
if (origDoc) globalThis.document = origDoc;

describe('property-descriptors', () => {

  describe('renderProperty', () => {
    it('renders a readonly property as label + value span', () => {
      const el = renderProperty({
        key: 'type',
        label: 'Type',
        type: 'readonly',
        value: 'circle'
      }, null);

      assert.equal(el.className, 'property-row');
      assert.equal(el.dataset.propertyKey, 'type');
      // innerHTML should contain the label and value
      assert.ok(el.innerHTML.includes('Type'));
      assert.ok(el.innerHTML.includes('circle'));
    });

    it('renders a color property with input type=color', () => {
      let changedValue = null;
      const el = renderProperty({
        key: 'fill',
        label: 'Fill',
        type: 'color',
        value: '#ff4081',
        onChange: (v) => { changedValue = v; }
      }, null);

      assert.equal(el.className, 'property-row');
      assert.equal(el.dataset.propertyKey, 'fill');
      // Should have child elements (label, color-wrap)
      assert.ok(el.children.length >= 2);

      // Find the color input
      const colorWrap = el.children.find(c => c.className === 'property-color-wrap');
      assert.ok(colorWrap, 'should have a color wrap element');
      const colorInput = colorWrap.children.find(c => c.tagName === 'INPUT');
      assert.ok(colorInput, 'should have an input element');
      assert.equal(colorInput.attributes.type, undefined); // set via .type not setAttribute
    });

    it('renders a text property using shell.ui.createInput when available', () => {
      let createdInput = null;
      const mockUI = {
        createInput(opts) {
          createdInput = opts;
          const el = new MockElement('scribus-input');
          el.dataset = {};
          return el;
        }
      };

      const el = renderProperty({
        key: 'title',
        label: 'Title',
        type: 'text',
        value: 'Hello',
        onChange: () => {}
      }, mockUI);

      assert.ok(createdInput, 'should call ui.createInput');
      assert.equal(createdInput.type, 'text');
      assert.equal(createdInput.value, 'Hello');
      assert.equal(createdInput.layout, 'compact');
    });

    it('renders a number property using shell.ui.createInput', () => {
      let createdInput = null;
      const mockUI = {
        createInput(opts) {
          createdInput = opts;
          const el = new MockElement('scribus-input');
          el.dataset = {};
          return el;
        }
      };

      renderProperty({
        key: 'x',
        label: 'X',
        type: 'number',
        value: 42,
        onChange: () => {}
      }, mockUI);

      assert.ok(createdInput);
      assert.equal(createdInput.type, 'number');
      assert.equal(createdInput.value, 42);
    });

    it('renders a text property with fallback when no ui helper', () => {
      const el = renderProperty({
        key: 'name',
        label: 'Name',
        type: 'text',
        value: 'test'
      }, null);

      assert.equal(el.className, 'property-row');
      assert.ok(el.innerHTML.includes('Name'));
      assert.ok(el.innerHTML.includes('test'));
    });
  });

  describe('renderPropertyGroups', () => {
    it('returns a fragment with one section per group', () => {
      const groups = [
        {
          label: 'Object',
          properties: [
            { key: 'type', label: 'Type', type: 'readonly', value: 'circle' }
          ]
        },
        {
          label: 'Position',
          properties: [
            { key: 'x', label: 'X', type: 'number', value: 10 }
          ]
        }
      ];

      const fragment = renderPropertyGroups(groups, null);
      assert.equal(fragment.children.length, 2);
      assert.equal(fragment.children[0].className, 'property-group');
      assert.equal(fragment.children[1].className, 'property-group');
    });

    it('skips groups with empty properties', () => {
      const groups = [
        { label: 'Empty', properties: [] },
        { label: 'Has', properties: [{ key: 'a', label: 'A', type: 'readonly', value: '1' }] }
      ];

      const fragment = renderPropertyGroups(groups, null);
      assert.equal(fragment.children.length, 1);
    });

    it('each group has a heading and property rows', () => {
      const groups = [
        {
          label: 'Appearance',
          properties: [
            { key: 'color', label: 'Color', type: 'readonly', value: 'red' },
            { key: 'opacity', label: 'Opacity', type: 'readonly', value: '100%' }
          ]
        }
      ];

      const fragment = renderPropertyGroups(groups, null);
      const section = fragment.children[0];
      // First child is the heading, rest are property rows
      assert.equal(section.children[0].className, 'property-group-heading');
      assert.equal(section.children[0].textContent, 'Appearance');
      // Two property rows
      assert.equal(section.children.length, 3); // heading + 2 rows
    });
  });

  describe('toHexColor (via color property rendering)', () => {
    it('handles hex colors', () => {
      const el = renderProperty({
        key: 'c', label: 'C', type: 'color', value: '#ff4081'
      }, null);
      const wrap = el.children.find(c => c.className === 'property-color-wrap');
      const input = wrap.children.find(c => c.tagName === 'INPUT');
      assert.equal(input.value, '#ff4081');
    });

    it('handles rgb() colors', () => {
      const el = renderProperty({
        key: 'c', label: 'C', type: 'color', value: 'rgb(255, 64, 129)'
      }, null);
      const wrap = el.children.find(c => c.className === 'property-color-wrap');
      const input = wrap.children.find(c => c.tagName === 'INPUT');
      assert.equal(input.value, '#ff4081');
    });

    it('handles 3-digit hex', () => {
      const el = renderProperty({
        key: 'c', label: 'C', type: 'color', value: '#f00'
      }, null);
      const wrap = el.children.find(c => c.className === 'property-color-wrap');
      const input = wrap.children.find(c => c.tagName === 'INPUT');
      assert.equal(input.value, '#ff0000');
    });

    it('falls back to #000000 for empty/transparent', () => {
      const el = renderProperty({
        key: 'c', label: 'C', type: 'color', value: ''
      }, null);
      const wrap = el.children.find(c => c.className === 'property-color-wrap');
      const input = wrap.children.find(c => c.tagName === 'INPUT');
      assert.equal(input.value, '#000000');
    });
  });
});
