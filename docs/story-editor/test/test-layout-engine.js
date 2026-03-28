import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { LayoutEngine } from '../lib/layout-engine.js';

const STYLE = { bold: false, italic: false };

describe('LayoutEngine.shapeParagraphs', () => {
  it('builds hyphToOrig and origLen correctly with soft hyphens', () => {
    const shaper = {
      shapeParagraph(runs) {
        const text = runs.map((r) => r.text).join('');
        return { text, glyphs: [{ cl: 0, ax: 10, style: STYLE }] };
      },
    };
    const hyphenator = {
      hyphenateRuns(runs) {
        return runs.map((r) => ({
          ...r,
          text: r.text === 'abcd' ? 'ab\u00ADcd' : r.text,
        }));
      },
    };

    const engine = new LayoutEngine({}, {}, shaper, hyphenator, { _padding: 0 });
    const shaped = engine.shapeParagraphs([
      [{ text: 'abcd', style: STYLE }],
      [{ text: 'xy', style: STYLE }],
    ], 12);

    assert.equal(shaped.length, 2);
    assert.equal(shaped[0].text, 'ab\u00ADcd');
    assert.deepEqual(shaped[0].hyphToOrig, [0, 1, 2, 2, 3]);
    assert.equal(shaped[0].origLen, 4);
    assert.equal(shaped[0].paraIndex, 0);
    assert.equal(shaped[1].origLen, 2);
    assert.equal(shaped[1].paraIndex, 1);
  });
});

describe('LayoutEngine.flowIntoBoxes', () => {
  it('overflows into next box and preserves line continuity', () => {
    const shaper = {
      shapeRun() {
        return [{ ax: 5 }];
      },
    };
    const engine = new LayoutEngine({}, {}, shaper, {}, { _padding: 0 });

    const text = 'ab cd ef';
    const glyphs = [
      { cl: 0, ax: 10, style: STYLE },
      { cl: 1, ax: 10, style: STYLE },
      { cl: 2, ax: 5, style: STYLE },
      { cl: 3, ax: 10, style: STYLE },
      { cl: 4, ax: 10, style: STYLE },
      { cl: 5, ax: 5, style: STYLE },
      { cl: 6, ax: 10, style: STYLE },
      { cl: 7, ax: 10, style: STYLE },
    ];

    const shapedParas = [{
      text,
      glyphs,
      paraIndex: 0,
      hyphToOrig: [0, 1, 2, 3, 4, 5, 6, 7],
      origLen: 8,
    }];

    const boxes = [
      { x: 0, y: 0, width: 40, height: 22 },
      { x: 50, y: 0, width: 40, height: 30 },
    ];

    const flowed = engine.flowIntoBoxes(shapedParas, boxes, 10, 100);

    assert.equal(flowed.length, 2);
    assert.equal(flowed[0].lines.length, 1);
    assert.equal(flowed[1].lines.length, 2);

    const [l1] = flowed[0].lines;
    const [l2, l3] = flowed[1].lines;

    assert.equal(l1.paraIndex, 0);
    assert.equal(l2.paraIndex, 0);
    assert.equal(l3.paraIndex, 0);

    assert.equal(l1.startChar, 0);
    assert.equal(l1.endChar, 2);
    assert.equal(l2.startChar, 3);
    assert.equal(l2.endChar, 5);
    assert.equal(l3.startChar, 6);
    assert.equal(l3.endChar, 8);
  });

  it('emits line map entry for empty paragraphs', () => {
    const shaper = {
      shapeRun() {
        return [{ ax: 5 }];
      },
    };
    const engine = new LayoutEngine({}, {}, shaper, {}, { _padding: 0 });

    const shapedParas = [
      {
        text: '',
        glyphs: [],
        paraIndex: 0,
        hyphToOrig: [],
        origLen: 0,
      },
      {
        text: 'abc',
        glyphs: [
          { cl: 0, ax: 10, style: STYLE },
          { cl: 1, ax: 10, style: STYLE },
          { cl: 2, ax: 10, style: STYLE },
        ],
        paraIndex: 1,
        hyphToOrig: [0, 1, 2],
        origLen: 3,
      },
    ];

    const boxes = [{ x: 0, y: 0, width: 80, height: 120 }];
    const flowed = engine.flowIntoBoxes(shapedParas, boxes, 10, 120);

    assert.equal(flowed[0].lines.length >= 2, true);
    assert.equal(flowed[0].lines[0].paraIndex, 0);
    assert.equal(flowed[0].lines[0].startChar, 0);
    assert.equal(flowed[0].lines[0].endChar, 0);
    assert.equal(flowed[0].lines[1].paraIndex, 1);
  });
});
