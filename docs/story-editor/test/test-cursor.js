import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { TextCursor } from '../lib/cursor.js';

function makeNode(tagName) {
  return {
    tagName,
    attributes: {},
    children: [],
    classList: {
      add(cls) {
        if (!this._owner) return;
        if (!this._owner.attributes['class']) this._owner.attributes['class'] = '';
        const classes = this._owner.attributes['class'].split(' ').filter(Boolean);
        if (!classes.includes(cls)) {
          classes.push(cls);
          this._owner.attributes['class'] = classes.join(' ');
        }
      },
      remove(cls) {
        if (!this._owner) return;
        const classes = (this._owner.attributes['class'] || '').split(' ').filter(Boolean);
        const filtered = classes.filter(c => c !== cls);
        this._owner.attributes['class'] = filtered.join(' ');
      }
    },
    parentNode: null,
    setAttribute(name, value) {
      this.attributes[name] = String(value);
    },
    getAttribute(name) {
      return this.attributes[name];
    },
    appendChild(child) {
      child.parentNode = this;
      this.children.push(child);
    },
    removeChild(child) {
      const idx = this.children.indexOf(child);
      if (idx >= 0) this.children.splice(idx, 1);
      child.parentNode = null;
    },
  };
  node.classList._owner = node;
  return node;
}

function makeSvg() {
  const svg = makeNode('svg');
  svg.createSVGPoint = () => ({
    x: 0,
    y: 0,
    matrixTransform() {
      return { x: this.x, y: this.y };
    },
  });
  svg.getScreenCTM = () => ({ inverse: () => ({}) });
  return svg;
}

describe('TextCursor', () => {
  it('handleClick maps click to story position and resets stickyX', () => {
    const originalDocument = globalThis.document;
    const originalDOMPoint = globalThis.DOMPoint;
    globalThis.document = {
      createElementNS(_ns, tag) {
        return makeNode(tag);
      },
    };
    globalThis.DOMPoint = class {
      constructor(x, y) {
        this.x = x;
        this.y = y;
      }
      matrixTransform() {
        return { x: this.x, y: this.y };
      }
    };

    const svg = makeSvg();
    const story = [[{ text: 'ab', style: { bold: false, italic: false } }]];
    const lineMap = [{
      lineIndex: 0,
      paraIndex: 0,
      positions: [{ charPos: 0, x: 10 }, { charPos: 1, x: 20 }, { charPos: 2, x: 30 }],
      colX: 0,
      boxY: 0,
      boxWidth: 100,
      boxHeight: 50,
      y: 20,
    }];

    const cursor = new TextCursor(svg, story, lineMap, 10);
    try {
      cursor._stickyX = 99;
      cursor.handleClick({ clientX: 22, clientY: 20 });
      assert.equal(cursor._stickyX, null);
      assert.equal(cursor._pos.paraIndex, 0);
      assert.equal(cursor._pos.lineIndex, 0);
      assert.equal(cursor._pos.charOffset, 1);
    } finally {
      cursor.destroy();
      globalThis.document = originalDocument;
      globalThis.DOMPoint = originalDOMPoint;
    }
  });

  it('ArrowUp/ArrowDown preserve sticky column intent across lines', () => {
    const originalDocument = globalThis.document;
    globalThis.document = {
      createElementNS(_ns, tag) {
        return makeNode(tag);
      },
    };

    const svg = makeSvg();
    const story = [[{ text: 'abcd', style: { bold: false, italic: false } }]];
    const lineMap = [
      {
        lineIndex: 0,
        paraIndex: 0,
        positions: [{ charPos: 0, x: 10 }, { charPos: 1, x: 20 }, { charPos: 2, x: 30 }],
        colX: 0,
        boxY: 0,
        boxWidth: 120,
        boxHeight: 100,
        y: 20,
      },
      {
        lineIndex: 1,
        paraIndex: 0,
        positions: [{ charPos: 2, x: 110 }, { charPos: 3, x: 120 }, { charPos: 4, x: 130 }],
        colX: 100,
        boxY: 0,
        boxWidth: 120,
        boxHeight: 100,
        y: 40,
      },
    ];

    const cursor = new TextCursor(svg, story, lineMap, 10);
    try {
      cursor.moveTo({ paraIndex: 0, charOffset: 1, lineIndex: 0 });

      let prevented = false;
      cursor.handleKeydown({ key: 'ArrowDown', preventDefault() { prevented = true; } });
      assert.equal(prevented, true);
      assert.equal(cursor._pos.lineIndex, 1);
      assert.equal(cursor._pos.charOffset, 3);
      const sticky = cursor._stickyX;
      assert.equal(sticky, 10); // 20 - left edge (10)

      cursor.handleKeydown({ key: 'ArrowUp', preventDefault() {} });
      assert.equal(cursor._pos.lineIndex, 0);
      assert.equal(cursor._pos.charOffset, 1);
      assert.equal(cursor._stickyX, sticky);
    } finally {
      cursor.destroy();
      globalThis.document = originalDocument;
    }
  });
});
