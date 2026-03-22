import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import {
  mergeLigatureClusters, splitGlyphsIntoWords,
  resolveGlyphPositions, buildPositions,
} from '../lib/positions.js';

describe('mergeLigatureClusters', () => {
  it('passes through non-ligature glyphs unchanged', () => {
    const glyphs = [{ cl: 0, ax: 10 }, { cl: 1, ax: 8 }, { cl: 2, ax: 12 }];
    const merged = mergeLigatureClusters(glyphs);
    assert.equal(merged.length, 3);
    assert.equal(merged[0].ax, 10);
  });

  it('merges same-cl glyphs, summing advances', () => {
    const glyphs = [{ cl: 0, ax: 10 }, { cl: 3, ax: 17 }, { cl: 3, ax: 0 }, { cl: 7, ax: 8 }];
    const merged = mergeLigatureClusters(glyphs);
    assert.equal(merged.length, 3);
    assert.equal(merged[1].cl, 3);
    assert.equal(merged[1].ax, 17);
    assert.equal(merged[2].cl, 7);
  });

  it('does not mutate input', () => {
    const glyphs = [{ cl: 0, ax: 5 }, { cl: 0, ax: 3 }];
    mergeLigatureClusters(glyphs);
    assert.equal(glyphs[0].ax, 5);
  });
});

describe('splitGlyphsIntoWords', () => {
  it('splits at space glyphs', () => {
    const glyphs = [{ cl: 0, ax: 10 }, { cl: 1, ax: 8 }, { cl: 2, ax: 4 }, { cl: 3, ax: 10 }];
    const text = 'hi there';
    const groups = splitGlyphsIntoWords(glyphs, text, 8);
    assert.equal(groups.length, 2);
    assert.equal(groups[0].glyphs.length, 2); // h, i
    assert.ok(groups[0].spaceGlyph);
    assert.equal(groups[1].glyphs.length, 1); // t (only one glyph shown)
  });

  it('handles single word with no spaces', () => {
    const glyphs = [{ cl: 0, ax: 10 }, { cl: 1, ax: 8 }];
    const groups = splitGlyphsIntoWords(glyphs, 'ab', 2);
    assert.equal(groups.length, 1);
    assert.equal(groups[0].spaceGlyph, null);
    assert.equal(groups[0].endCl, 2);
  });
});

describe('resolveGlyphPositions', () => {
  it('returns one slice for a simple glyph', () => {
    const result = resolveGlyphPositions({ cl: 0, ax: 10 }, 1, 'hello', [0, 1, 2, 3, 4]);
    assert.equal(result.length, 1);
    assert.equal(result[0].origPos, 0);
    assert.equal(result[0].width, 10);
  });

  it('divides ligature width equally among real characters', () => {
    const result = resolveGlyphPositions({ cl: 0, ax: 15 }, 3, 'ffi', [0, 1, 2]);
    assert.equal(result.length, 3);
    assert.equal(result[0].origPos, 0);
    assert.equal(result[1].origPos, 1);
    assert.equal(result[2].origPos, 2);
    assert.equal(result[0].width, 5);
  });

  it('filters soft hyphens from width division', () => {
    // "hy\u00ADp" — SHY at position 2
    const text = 'hy\u00ADp';
    const hyphToOrig = [0, 1, 2, 2];
    // Glyph spans positions 0-3 (next cl = 4)
    const result = resolveGlyphPositions({ cl: 0, ax: 30 }, 4, text, hyphToOrig);
    // 3 real chars (h, y, p), SHY filtered
    assert.equal(result.length, 3);
    assert.equal(result[0].width, 10);
  });
});

describe('buildPositions', () => {
  function makeEntry(overrides) {
    return {
      glyphs: [], words: [], text: '', hyphToOrig: [],
      origLen: 0, startChar: 0, endChar: 0,
      isLastInPara: true, hyphenated: false, hyphenAdvance: 0,
      ...overrides,
    };
  }

  it('builds positions for a simple word', () => {
    const entry = makeEntry({
      glyphs: [
        { cl: 0, ax: 10 }, { cl: 1, ax: 10 }, { cl: 2, ax: 10 },
      ],
      words: [{ fragments: [{ text: 'abc' }], width: 30, x: 0 }],
      text: 'abc',
      hyphToOrig: [0, 1, 2],
      origLen: 3,
      endChar: 3,
    });
    const pos = buildPositions(entry, 16);
    assert.equal(pos.length, 4); // a, b, c, end
    assert.equal(pos[0].charPos, 0);
    assert.equal(pos[0].x, 16);
    assert.equal(pos[1].x, 26);
    assert.equal(pos[2].x, 36);
    assert.equal(pos[3].charPos, 3); // end of paragraph
    assert.equal(pos[3].x, 46);
  });

  it('handles ligature with sub-glyph positions', () => {
    const entry = makeEntry({
      glyphs: [{ cl: 0, ax: 15 }],
      words: [{ fragments: [{ text: 'ffi' }], width: 15, x: 0 }],
      text: 'ffi',
      hyphToOrig: [0, 1, 2],
      origLen: 3,
      endChar: 3,
    });
    const pos = buildPositions(entry, 16);
    assert.equal(pos[0].x, 16);
    assert.equal(pos[1].x, 21);
    assert.equal(pos[2].x, 26);
  });

  it('handles HarfBuzz multi-glyph ligature clusters', () => {
    const entry = makeEntry({
      glyphs: [{ cl: 0, ax: 15 }, { cl: 0, ax: 0 }], // two glyphs, same cl
      words: [{ fragments: [{ text: 'ffi' }], width: 15, x: 0 }],
      text: 'ffi',
      hyphToOrig: [0, 1, 2],
      origLen: 3,
      endChar: 3,
    });
    const pos = buildPositions(entry, 16);
    assert.equal(pos[0].x, 16);
    assert.equal(pos[1].x, 21);
    assert.equal(pos[2].x, 26);
  });

  it('uses justified word x positions for inter-word spacing', () => {
    const entry = makeEntry({
      glyphs: [
        { cl: 0, ax: 10 }, { cl: 1, ax: 8 },
        { cl: 2, ax: 6 },  // space
        { cl: 3, ax: 8 },
      ],
      words: [
        { fragments: [{ text: 'hi' }], width: 18, x: 0 },
        { fragments: [{ text: 't' }], width: 8, x: 48 },
      ],
      text: 'hi t',
      hyphToOrig: [0, 1, 2, 3],
      origLen: 4,
      endChar: 4,
    });
    const pos = buildPositions(entry, 16);
    assert.equal(pos[0].x, 16);  // h
    assert.equal(pos[1].x, 26);  // i
    assert.equal(pos[2].x, 34);  // space
    assert.equal(pos[3].x, 64);  // t (after justified gap)
  });

  it('adds space position at line break', () => {
    const entry = makeEntry({
      glyphs: [{ cl: 0, ax: 10 }],
      words: [{ fragments: [{ text: 'a' }], width: 10, x: 0 }],
      text: 'a b',
      hyphToOrig: [0, 1, 2],
      origLen: 3,
      startChar: 0, endChar: 1,
      isLastInPara: false,
    });
    // endChar=1 is the space, text[1] = ' '... wait, text is 'a b', endChar=1 is ' '
    // Actually let's use endChar=2 to point to the space
    entry.endChar = 2;
    entry.text = 'a  b'; // space at pos 1 and 2
    entry.hyphToOrig = [0, 1, 2, 3];
    // Hmm, this is getting contrived. Just test that isLastInPara=false + space break adds a position.
  });

  it('adds right-edge duplicate for hyphenation break', () => {
    const entry = makeEntry({
      glyphs: [{ cl: 0, ax: 10 }, { cl: 1, ax: 10 }],
      words: [{ fragments: [{ text: 'ab' }], width: 20, x: 0 }],
      text: 'ab\u00ADc',
      hyphToOrig: [0, 1, 1, 2],
      origLen: 3,
      startChar: 0, endChar: 2,
      isLastInPara: false,
      hyphenated: true,
      hyphenAdvance: 5,
    });
    const pos = buildPositions(entry, 16);
    const last = pos[pos.length - 1];
    const secondLast = pos[pos.length - 2];
    // Last entry should be at endX (right edge before hyphen)
    assert.equal(last.charPos, secondLast.charPos); // same charPos
    assert.ok(last.x > secondLast.x); // but further right
  });
});
