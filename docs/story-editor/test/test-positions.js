import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import {
  mergeLigatureClusters,
  splitGlyphsIntoWords,
  resolveGlyphPositions,
  buildPositions,
} from '../lib/positions.js';

const STYLE = { bold: false, italic: false };

describe('mergeLigatureClusters', () => {
  it('merges consecutive glyphs with same cluster index', () => {
    const raw = [
      { cl: 0, ax: 8, style: STYLE },
      { cl: 0, ax: 2, style: STYLE },
      { cl: 1, ax: 5, style: STYLE },
    ];
    const out = mergeLigatureClusters(raw);
    assert.equal(out.length, 2);
    assert.equal(out[0].cl, 0);
    assert.equal(out[0].ax, 10);
    assert.equal(out[1].cl, 1);
    assert.equal(out[1].ax, 5);
  });
});

describe('splitGlyphsIntoWords', () => {
  it('splits word groups around space glyphs', () => {
    const glyphs = [
      { cl: 0, ax: 10, style: STYLE },
      { cl: 1, ax: 10, style: STYLE },
      { cl: 2, ax: 5, style: STYLE }, // space
      { cl: 3, ax: 10, style: STYLE },
    ];
    const groups = splitGlyphsIntoWords(glyphs, 'ab c', 4);
    assert.equal(groups.length, 2);
    assert.deepEqual(groups[0].glyphs.map((g) => g.cl), [0, 1]);
    assert.equal(groups[0].spaceGlyph?.cl, 2);
    assert.deepEqual(groups[1].glyphs.map((g) => g.cl), [3]);
    assert.equal(groups[1].spaceGlyph, null);
  });
});

describe('resolveGlyphPositions', () => {
  it('splits ligature advance equally across original positions', () => {
    const slices = resolveGlyphPositions(
      { cl: 0, ax: 12, style: STYLE },
      3,
      'ffi',
      [0, 1, 2],
    );
    assert.deepEqual(slices, [
      { origPos: 0, width: 4 },
      { origPos: 1, width: 4 },
      { origPos: 2, width: 4 },
    ]);
  });

  it('drops soft hyphen positions from slices', () => {
    const slices = resolveGlyphPositions(
      { cl: 0, ax: 8, style: STYLE },
      3,
      'a\u00ADb',
      [0, 1, 1],
    );
    assert.deepEqual(slices, [
      { origPos: 0, width: 4 },
      { origPos: 1, width: 4 },
    ]);
  });
});

describe('buildPositions', () => {
  it('maps character starts and line end x', () => {
    const entry = {
      words: [
        { fragments: [{ text: 'ab', style: STYLE }], width: 20, x: 0 },
      ],
      glyphs: [
        { cl: 0, ax: 10, style: STYLE },
        { cl: 1, ax: 10, style: STYLE },
      ],
      text: 'ab',
      hyphToOrig: [0, 1],
      origLen: 2,
      isLastInPara: true,
      hyphenated: false,
      hyphenAdvance: 0,
      startChar: 0,
      endChar: 2,
      paraIndex: 0,
    };

    const positions = buildPositions(entry, 16);
    assert.deepEqual(positions, [
      { charPos: 0, x: 16 },
      { charPos: 1, x: 26 },
      { charPos: 2, x: 36 },
    ]);
  });

  it('preserves x advancement when a glyph span has only soft hyphens', () => {
    const entry = {
      words: [
        { fragments: [{ text: 'ab', style: STYLE }], width: 18, x: 0 },
      ],
      glyphs: [
        { cl: 0, ax: 6, style: STYLE },
        { cl: 1, ax: 8, style: STYLE }, // span [1,2) where text[1] is SHY
        { cl: 2, ax: 4, style: STYLE },
      ],
      text: 'a\u00ADb',
      hyphToOrig: [0, 1, 1],
      origLen: 2,
      isLastInPara: true,
      hyphenated: false,
      hyphenAdvance: 0,
      startChar: 0,
      endChar: 3,
      paraIndex: 0,
    };

    const positions = buildPositions(entry, 10);
    assert.deepEqual(positions, [
      { charPos: 0, x: 10 },
      { charPos: 1, x: 24 },
      { charPos: 2, x: 28 },
    ]);
  });

  it('emits a position after trailing space so cursor can advance past it', () => {
    // Simulates typing "A " — the space at the end must produce a position
    // beyond the space advance so the cursor visually moves right.
    const entry = {
      words: [
        { fragments: [{ text: 'A', style: STYLE }], width: 10, x: 0 },
      ],
      glyphs: [
        { cl: 0, ax: 10, style: STYLE }, // 'A'
        { cl: 1, ax: 5, style: STYLE },  // ' ' (trailing space)
      ],
      text: 'A ',
      hyphToOrig: [0, 1],
      origLen: 2,
      isLastInPara: true,
      hyphenated: false,
      hyphenAdvance: 0,
      startChar: 0,
      endChar: 2,
      paraIndex: 0,
    };

    const positions = buildPositions(entry, 16);

    // Position 0: start of 'A' at baseX
    assert.equal(positions[0].charPos, 0);
    assert.equal(positions[0].x, 16);

    // Position 1: start of space, at baseX + advance of 'A'
    const spacePos = positions.find(p => p.charPos === 1);
    assert.ok(spacePos, 'should have a position for the space character');
    assert.equal(spacePos.x, 26); // 16 + 10

    // Position 2: end (after the space), must be > space position
    const endPos = positions.find(p => p.charPos === 2);
    assert.ok(endPos, 'should have an end-of-paragraph position');
    assert.ok(endPos.x > spacePos.x, 'end position must be past the trailing space');
  });
});
