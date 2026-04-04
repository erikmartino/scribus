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

  it('existing word positions remain stable when appending a new word', () => {
    // Simulates the "rocking text" scenario: typing "A   B" then "A   B C"
    // on a left-aligned (final) line. The position of word "B" should not change.
    const S = { bold: false, italic: false };

    // State 1: "A   B"
    const text1 = 'A   B';
    const line1 = {
      glyphs: [
        { cl: 0, ax: 10, style: S }, // A
        { cl: 1, ax: 5, style: S },  // space
        { cl: 2, ax: 5, style: S },  // space
        { cl: 3, ax: 5, style: S },  // space
        { cl: 4, ax: 10, style: S }, // B
      ],
      endChar: 5,
      hyphenated: false,
    };
    const words1 = justifyLine(line1, text1, 200, 4, true);
    const bX1 = words1.find(w => w.fragments.some(f => f.text === 'B'))?.x;

    // State 2: "A   B C" — appending " C" at the end
    const text2 = 'A   B C';
    const line2 = {
      glyphs: [
        { cl: 0, ax: 10, style: S }, // A
        { cl: 1, ax: 5, style: S },  // space
        { cl: 2, ax: 5, style: S },  // space
        { cl: 3, ax: 5, style: S },  // space
        { cl: 4, ax: 10, style: S }, // B
        { cl: 5, ax: 5, style: S },  // space
        { cl: 6, ax: 10, style: S }, // C
      ],
      endChar: 7,
      hyphenated: false,
    };
    const words2 = justifyLine(line2, text2, 200, 4, true);
    const bX2 = words2.find(w => w.fragments.some(f => f.text === 'B'))?.x;

    assert.ok(bX1 !== undefined, 'B should appear in first layout');
    assert.ok(bX2 !== undefined, 'B should appear in second layout');
    assert.equal(bX1, bX2, 'B position must not shift when appending a word after it');
  });
});
