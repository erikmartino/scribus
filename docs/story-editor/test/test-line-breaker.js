import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { breakLines, SHY } from '../lib/line-breaker.js';

describe('breakLines', () => {
  it('breaks on space overflow and excludes break-space glyph', () => {
    const text = 'ab cd';
    const glyphs = [
      { cl: 0, ax: 10 }, // a
      { cl: 1, ax: 10 }, // b
      { cl: 2, ax: 5 },  // space
      { cl: 3, ax: 10 }, // c
      { cl: 4, ax: 10 }, // d
    ];

    const lines = breakLines(glyphs, text, 22, 4);
    assert.equal(lines.length, 2);

    assert.equal(lines[0].startChar, 0);
    assert.equal(lines[0].endChar, 2); // break at space cluster
    assert.equal(lines[0].hyphenated, false);
    assert.deepEqual(lines[0].glyphs.map((g) => g.cl), [0, 1]);

    assert.equal(lines[1].startChar, 3);
    assert.deepEqual(lines[1].glyphs.map((g) => g.cl), [3, 4]);
  });

  it('breaks on soft hyphen and marks line as hyphenated', () => {
    const text = `ab${SHY}cd`;
    const glyphs = [
      { cl: 0, ax: 10 }, // a
      { cl: 1, ax: 10 }, // b
      { cl: 2, ax: 0 },  // SHY
      { cl: 3, ax: 10 }, // c
      { cl: 4, ax: 10 }, // d
    ];

    const hyphenAdvance = 5;
    const lines = breakLines(glyphs, text, 24, hyphenAdvance);
    assert.equal(lines.length, 2);

    assert.equal(lines[0].startChar, 0);
    assert.equal(lines[0].endChar, 2);
    assert.equal(lines[0].hyphenated, true);
    assert.equal(lines[0].width, 25); // 10 + 10 + hyphenAdvance
    assert.deepEqual(lines[0].glyphs.map((g) => g.cl), [0, 1]);

    assert.equal(lines[1].startChar, 3);
    assert.deepEqual(lines[1].glyphs.map((g) => g.cl), [3, 4]);
  });
});
