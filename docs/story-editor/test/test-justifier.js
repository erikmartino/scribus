import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { justifyLine } from '../lib/justifier.js';

describe('justifyLine', () => {
  it('fully justifies non-final lines by distributing remaining width', () => {
    const text = 'ab cd';
    const line = {
      glyphs: [
        { cl: 0, ax: 10, style: { bold: false, italic: false } },
        { cl: 1, ax: 10, style: { bold: false, italic: false } },
        { cl: 2, ax: 5, style: { bold: false, italic: false } },
        { cl: 3, ax: 10, style: { bold: false, italic: false } },
        { cl: 4, ax: 10, style: { bold: false, italic: false } },
      ],
      endChar: 5,
      hyphenated: false,
    };

    const words = justifyLine(line, text, 60, 4, false);
    assert.equal(words.length, 2);
    assert.equal(words[0].x, 0);
    assert.equal(words[1].x, 40); // 20 width + 20 distributed gap
  });

  it('keeps natural spacing on final lines', () => {
    const text = 'ab cd';
    const line = {
      glyphs: [
        { cl: 0, ax: 10, style: { bold: false, italic: false } },
        { cl: 1, ax: 10, style: { bold: false, italic: false } },
        { cl: 2, ax: 5, style: { bold: false, italic: false } },
        { cl: 3, ax: 10, style: { bold: false, italic: false } },
        { cl: 4, ax: 10, style: { bold: false, italic: false } },
      ],
      endChar: 5,
      hyphenated: false,
    };

    const words = justifyLine(line, text, 60, 4, true);
    assert.equal(words.length, 2);
    assert.equal(words[0].x, 0);
    assert.equal(words[1].x, 25); // 20 width + original 5-space width
  });
});
