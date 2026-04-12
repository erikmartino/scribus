import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { buildPositions } from '../lib/positions.js';
import { pointToPos, positionToPoint } from '../lib/story-position.js';

const STYLE = { bold: false, italic: false };

describe('lineMap cursor integration', () => {
  it('round-trips positionToPoint -> pointToPos on ligature boundary', () => {
    const entry = {
      words: [{ fragments: [{ text: 'ffi', style: STYLE }], width: 15, x: 0 }],
      glyphs: [{ cl: 0, ax: 15, style: STYLE }],
      text: 'ffi',
      hyphToOrig: [0, 1, 2],
      origLen: 3,
      isLastInPara: true,
      hyphenated: false,
      hyphenAdvance: 0,
      startChar: 0,
      endChar: 3,
      paraIndex: 0,
    };

    const line = {
      lineIndex: 0,
      paraIndex: 0,
      positions: buildPositions(entry, 16),
      colX: 0,
      boxY: 0,
      boxWidth: 200,
      boxHeight: 100,
      y: 30,
    };
    const lineMap = [line];

    for (const charOffset of [0, 1, 2, 3]) {
      const pos = { paraIndex: 0, charOffset, lineIndex: 0 };
      const pt = positionToPoint(pos, lineMap, 20);
      const back = pointToPos(pt.x, line.y, lineMap);
      assert.equal(back.paraIndex, 0);
      assert.equal(back.lineIndex, 0);
      assert.equal(back.charOffset, charOffset);
    }
  });

  it('keeps hyphenated line end mapped to next original char', () => {
    const entry = {
      words: [{ fragments: [{ text: 'ab-', style: STYLE }], width: 20, x: 0 }],
      glyphs: [{ cl: 0, ax: 10, style: STYLE }, { cl: 1, ax: 10, style: STYLE }],
      text: 'ab\u00ADc',
      hyphToOrig: [0, 1, 2, 2],
      origLen: 3,
      isLastInPara: false,
      hyphenated: true,
      hyphenAdvance: 5,
      startChar: 0,
      endChar: 2,
      paraIndex: 0,
    };

    const positions = buildPositions(entry, 16);
    const line = {
      lineIndex: 0,
      paraIndex: 0,
      positions,
      colX: 0,
      boxY: 0,
      boxWidth: 200,
      boxHeight: 100,
      y: 30,
    };

    const last = positions[positions.length - 1];
    assert.equal(last.charPos, 2);

    const pt = positionToPoint({ paraIndex: 0, charOffset: 2, lineIndex: 0 }, [line], 20);
    const back = pointToPos(pt.x, line.y, [line]);
    assert.equal(back.charOffset, 2);
  });
});
