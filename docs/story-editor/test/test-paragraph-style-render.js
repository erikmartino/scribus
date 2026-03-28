import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import {
  defaultParagraphStyle,
  applyParagraphStylesToSvg,
} from '../lib/paragraph-style-render.js';

function makeTextElement(fontSize, tspanXs) {
  const attrs = { 'font-size': String(fontSize), y: '0' };
  const tspans = tspanXs.map((x) => {
    const tspanAttrs = { x: String(x) };
    return {
      getAttribute(name) {
        return tspanAttrs[name] ?? null;
      },
      setAttribute(name, value) {
        tspanAttrs[name] = String(value);
      },
      _attrs: tspanAttrs,
    };
  });

  return {
    querySelectorAll(selector) {
      if (selector === 'tspan[x]') return tspans;
      return [];
    },
    setAttribute(name, value) {
      attrs[name] = String(value);
    },
    getAttribute(name) {
      return attrs[name] ?? null;
    },
    _attrs: attrs,
    _tspans: tspans,
  };
}

function makeSvg(textElements) {
  return {
    querySelectorAll(selector) {
      if (selector === 'text') return textElements;
      return [];
    },
  };
}

describe('paragraph style render integration', () => {
  it('applies larger rendered first-line letters with non-overlapping words', () => {
    const textEls = [
      makeTextElement(20, [10, 40, 78]),
      makeTextElement(20, [10, 36]),
    ];
    const svg = makeSvg(textEls);

    const lineMap = [
      {
        lineIndex: 0,
        paraIndex: 0,
        positions: [
          { charPos: 0, x: 10 },
          { charPos: 5, x: 40 },
          { charPos: 11, x: 78 },
        ],
        colX: 0,
        boxY: 0,
        boxWidth: 200,
        boxHeight: 120,
        y: 40,
        fontSize: 20,
      },
      {
        lineIndex: 1,
        paraIndex: 0,
        positions: [
          { charPos: 11, x: 10 },
          { charPos: 15, x: 36 },
        ],
        colX: 0,
        boxY: 0,
        boxWidth: 200,
        boxHeight: 120,
        y: 68,
        fontSize: 20,
      },
    ];

    const paragraphStyles = [defaultParagraphStyle('lead')];
    paragraphStyles[0].fontSize = 24;

    applyParagraphStylesToSvg(svg, lineMap, 20, paragraphStyles);

    const renderedFirstSize = Number(textEls[0].getAttribute('font-size'));
    assert.ok(renderedFirstSize > 20, 'first line should render larger than base size');

    const firstLineXs = textEls[0]._tspans.map((t) => Number(t.getAttribute('x')));
    assert.ok(firstLineXs[0] <= firstLineXs[1]);
    assert.ok(firstLineXs[1] <= firstLineXs[2]);

    // Ensure metrics were expanded (simulates no-overlap intent with scaled placements)
    assert.ok(firstLineXs[1] - firstLineXs[0] > 20);
    assert.ok(firstLineXs[2] - firstLineXs[1] > 20);

    // Next line should be pushed down in the same box
    assert.ok(lineMap[1].y > 68);
  });
});
