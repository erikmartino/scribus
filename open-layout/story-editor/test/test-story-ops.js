import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import {
  paraTextLength,
  comparePositions,
  orderPositions,
  deleteRange,
  replaceRange,
  textInRange,
  normalizeParagraph,
  normalizeStory,
  clampPos,
  splitRunAtCharOffset,
  getStyleAtPos,
  resolveTypingStyle,
  insertText,
  deleteBackward,
  deleteForward,
  insertParagraphBreak,
  mergeParagraphs,
  applyStyleRange,
  getStoryFragment,
  insertStoryFragment,
} from '../lib/story-ops.js';
import { styleEq } from '../lib/style.js';

function run(text, style) {
  return { text, style };
}

const N = { bold: false, italic: false, fontFamily: '' };
const B = { bold: true, italic: false, fontFamily: '' };
const I = { bold: false, italic: true, fontFamily: '' };

describe('styleEq', () => {
  it('compares bold/italic only', () => {
    assert.equal(styleEq(N, { bold: false, italic: false, fontFamily: '' }), true);
    assert.equal(styleEq(N, B), false);
    assert.equal(styleEq(I, B), false);
  });
});

describe('normalizeParagraph', () => {
  it('drops empty runs and merges adjacent equal style', () => {
    const p = normalizeParagraph([
      run('', N),
      run('he', N),
      run('llo', N),
      run('', B),
      run('!', B),
      run('?', B),
    ]);
    assert.equal(p.length, 2);
    assert.equal(p[0].text, 'hello');
    assert.deepEqual(p[0].style, N);
    assert.equal(p[1].text, '!?');
    assert.deepEqual(p[1].style, B);
  });

  it('ensures at least one run exists', () => {
    const p = normalizeParagraph([]);
    assert.equal(p.length, 1);
    assert.equal(p[0].text, '');
    assert.deepEqual(p[0].style, N);
  });
});

describe('normalizeStory', () => {
  it('ensures at least one paragraph exists', () => {
    const s = normalizeStory([]);
    assert.equal(s.length, 1);
    assert.equal(s[0].length, 1);
    assert.equal(s[0][0].text, '');
  });

  it('is idempotent', () => {
    const input = [[run('a', N), run('', N), run('b', N)]];
    const once = normalizeStory(input);
    const twice = normalizeStory(once);
    assert.deepEqual(twice, once);
  });
});

describe('paraTextLength + clampPos', () => {
  const story = [[run('abc', N)], [run('xy', B)]];

  it('returns paragraph text length', () => {
    assert.equal(paraTextLength(story, 0), 3);
    assert.equal(paraTextLength(story, 1), 2);
  });

  it('clamps paraIndex/charOffset into valid bounds', () => {
    assert.deepEqual(clampPos(story, { paraIndex: 99, charOffset: 99 }), { paraIndex: 1, charOffset: 2 });
    assert.deepEqual(clampPos(story, { paraIndex: -4, charOffset: -1 }), { paraIndex: 0, charOffset: 0 });
  });
});

describe('position ordering helpers', () => {
  it('compares by paragraph then char offset', () => {
    assert.equal(comparePositions({ paraIndex: 0, charOffset: 2 }, { paraIndex: 0, charOffset: 3 }), -1);
    assert.equal(comparePositions({ paraIndex: 1, charOffset: 0 }, { paraIndex: 0, charOffset: 9 }), 1);
    assert.equal(comparePositions({ paraIndex: 2, charOffset: 5 }, { paraIndex: 2, charOffset: 5 }), 0);
  });

  it('orders range endpoints', () => {
    const ordered = orderPositions({ paraIndex: 3, charOffset: 1 }, { paraIndex: 2, charOffset: 4 });
    assert.deepEqual(ordered.start, { paraIndex: 2, charOffset: 4 });
    assert.deepEqual(ordered.end, { paraIndex: 3, charOffset: 1 });
  });
});

describe('splitRunAtCharOffset', () => {
  it('splits a paragraph by flattened character offset', () => {
    const para = [run('ab', N), run('CD', B), run('ef', I)];
    const parts = splitRunAtCharOffset(para, 3);
    assert.deepEqual(parts.leftRuns.map((r) => r.text), ['ab', 'C']);
    assert.deepEqual(parts.rightRuns.map((r) => r.text), ['D', 'ef']);
  });
});

describe('style resolution', () => {
  const story = [[run('ab', N), run('CD', B), run('ef', I)]];

  it('getStyleAtPos supports left/right bias at boundaries', () => {
    assert.deepEqual(getStyleAtPos(story, { paraIndex: 0, charOffset: 2 }, 'left'), N);
    assert.deepEqual(getStyleAtPos(story, { paraIndex: 0, charOffset: 2 }, 'right'), B);
  });

  it('resolveTypingStyle uses explicit typingStyle first', () => {
    const out = resolveTypingStyle(story, { paraIndex: 0, charOffset: 1 }, B);
    assert.deepEqual(out, B);
  });

  it('resolveTypingStyle uses right style at paragraph start', () => {
    const out = resolveTypingStyle(story, { paraIndex: 0, charOffset: 0 });
    assert.deepEqual(out, N);
  });

  it('resolveTypingStyle uses left style otherwise', () => {
    const out = resolveTypingStyle(story, { paraIndex: 0, charOffset: 4 });
    assert.deepEqual(out, B);
  });
});

describe('insertText', () => {
  it('inserts into middle of a run and moves cursor', () => {
    const story = [[run('abcd', N)]];
    const out = insertText(story, { paraIndex: 0, charOffset: 2 }, 'ZZ');
    assert.deepEqual(out.story, [[run('abZZcd', N)]]);
    assert.deepEqual(out.cursor, { paraIndex: 0, charOffset: 4 });
  });

  it('merges with adjacent runs when styles match', () => {
    const story = [[run('ab', N), run('CD', B)]];
    const out = insertText(story, { paraIndex: 0, charOffset: 2 }, 'x', { typingStyle: N });
    assert.equal(out.story[0].length, 2);
    assert.equal(out.story[0][0].text, 'abx');
    assert.equal(out.story[0][1].text, 'CD');
  });

  it('supports newline by splitting paragraphs', () => {
    const story = [[run('abcd', N)]];
    const out = insertText(story, { paraIndex: 0, charOffset: 2 }, 'X\nY');
    assert.equal(out.story.length, 2);
    assert.equal(out.story[0][0].text, 'abX');
    assert.equal(out.story[1][0].text, 'Ycd');
    assert.deepEqual(out.cursor, { paraIndex: 1, charOffset: 1 });
  });
});

describe('insertParagraphBreak', () => {
  it('splits paragraph at cursor', () => {
    const story = [[run('ab', N), run('CD', B)]];
    const out = insertParagraphBreak(story, { paraIndex: 0, charOffset: 3 });
    assert.equal(out.story.length, 2);
    assert.equal(out.story[0][0].text, 'ab');
    assert.equal(out.story[0][1].text, 'C');
    assert.equal(out.story[1][0].text, 'D');
    assert.deepEqual(out.cursor, { paraIndex: 1, charOffset: 0 });
  });
});

describe('deleteBackward', () => {
  it('deletes character before cursor within paragraph', () => {
    const story = [[run('abc', N)]];
    const out = deleteBackward(story, { paraIndex: 0, charOffset: 2 });
    assert.deepEqual(out.story, [[run('ac', N)]]);
    assert.deepEqual(out.cursor, { paraIndex: 0, charOffset: 1 });
  });

  it('merges with previous paragraph at paragraph start', () => {
    const story = [[run('ab', N)], [run('CD', B)]];
    const out = deleteBackward(story, { paraIndex: 1, charOffset: 0 });
    assert.equal(out.story.length, 1);
    assert.equal(out.story[0][0].text, 'ab');
    assert.equal(out.story[0][1].text, 'CD');
    assert.deepEqual(out.cursor, { paraIndex: 0, charOffset: 2 });
  });

  it('clamps at absolute start', () => {
    const story = [[run('ab', N)]];
    const out = deleteBackward(story, { paraIndex: 0, charOffset: 0 });
    assert.deepEqual(out.story, normalizeStory(story));
    assert.deepEqual(out.cursor, { paraIndex: 0, charOffset: 0 });
  });
});

describe('deleteForward', () => {
  it('deletes character at cursor within paragraph', () => {
    const story = [[run('abc', N)]];
    const out = deleteForward(story, { paraIndex: 0, charOffset: 1 });
    assert.deepEqual(out.story, [[run('ac', N)]]);
    assert.deepEqual(out.cursor, { paraIndex: 0, charOffset: 1 });
  });

  it('merges with next paragraph at paragraph end', () => {
    const story = [[run('ab', N)], [run('CD', B)]];
    const out = deleteForward(story, { paraIndex: 0, charOffset: 2 });
    assert.equal(out.story.length, 1);
    assert.equal(out.story[0][0].text, 'ab');
    assert.equal(out.story[0][1].text, 'CD');
    assert.deepEqual(out.cursor, { paraIndex: 0, charOffset: 2 });
  });

  it('clamps at absolute end', () => {
    const story = [[run('ab', N)]];
    const out = deleteForward(story, { paraIndex: 0, charOffset: 2 });
    assert.deepEqual(out.story, normalizeStory(story));
    assert.deepEqual(out.cursor, { paraIndex: 0, charOffset: 2 });
  });
});

describe('mergeParagraphs', () => {
  it('merges adjacent paragraphs', () => {
    const story = [[run('ab', N)], [run('CD', B)], [run('ef', I)]];
    const out = mergeParagraphs(story, 1);
    assert.equal(out.length, 2);
    assert.equal(out[1][0].text, 'CD');
    assert.equal(out[1][1].text, 'ef');
  });

  it('no-ops when index is out of merge range', () => {
    const story = [[run('ab', N)]];
    assert.deepEqual(mergeParagraphs(story, 0), normalizeStory(story));
    assert.deepEqual(mergeParagraphs(story, -1), normalizeStory(story));
  });
});

describe('range operations', () => {
  it('deleteRange within one paragraph', () => {
    const story = [[run('abcdef', N)]];
    const out = deleteRange(story, { paraIndex: 0, charOffset: 2 }, { paraIndex: 0, charOffset: 4 });
    assert.deepEqual(out.story, [[run('abef', N)]]);
    assert.deepEqual(out.cursor, { paraIndex: 0, charOffset: 2 });
  });

  it('deleteRange across paragraphs merges ends', () => {
    const story = [[run('abc', N)], [run('DEF', B)], [run('ghi', I)]];
    const out = deleteRange(story, { paraIndex: 0, charOffset: 2 }, { paraIndex: 2, charOffset: 1 });
    assert.equal(out.story.length, 1);
    assert.equal(out.story[0][0].text, 'ab');
    assert.equal(out.story[0][1].text, 'hi');
    assert.deepEqual(out.cursor, { paraIndex: 0, charOffset: 2 });
  });

  it('replaceRange inserts replacement and moves cursor after insertion', () => {
    const story = [[run('abcdef', N)]];
    const out = replaceRange(
      story,
      { paraIndex: 0, charOffset: 2 },
      { paraIndex: 0, charOffset: 5 },
      'ZZ',
      { typingStyle: N },
    );
    assert.deepEqual(out.story, [[run('abZZf', N)]]);
    assert.deepEqual(out.cursor, { paraIndex: 0, charOffset: 4 });
  });

  it('textInRange returns plain text across paragraphs using newlines', () => {
    const story = [[run('abc', N)], [run('DEF', B)], [run('ghi', I)]];
    const txt = textInRange(story, { paraIndex: 0, charOffset: 1 }, { paraIndex: 2, charOffset: 2 });
    assert.equal(txt, 'bc\nDEF\ngh');
  });

  it('applyStyleRange patches style across mixed run boundaries', () => {
    const story = [[run('ab', N), run('CD', B), run('ef', I)]];
    const out = applyStyleRange(
      story,
      { paraIndex: 0, charOffset: 1 },
      { paraIndex: 0, charOffset: 5 },
      { italic: true },
    );

    assert.equal(out.length, 1);
    assert.deepEqual(out[0].map((r) => r.text), ['a', 'b', 'CD', 'ef']);
    assert.deepEqual(out[0].map((r) => r.style), [
      N,
      { bold: false, italic: true, fontFamily: '' },
      { bold: true, italic: true, fontFamily: '' },
      I,
    ]);
  });
});

describe('getStoryFragment', () => {
  it('returns empty array for collapsed range', () => {
    const story = [[run('abc', N)]];
    const frag = getStoryFragment(story, { paraIndex: 0, charOffset: 1 }, { paraIndex: 0, charOffset: 1 });
    assert.deepEqual(frag, []);
  });

  it('extracts a fragment within a single paragraph', () => {
    const story = [[run('abcdef', N)]];
    const frag = getStoryFragment(story, { paraIndex: 0, charOffset: 1 }, { paraIndex: 0, charOffset: 4 });
    assert.equal(frag.length, 1);
    assert.equal(frag[0][0].text, 'bcd');
    assert.deepEqual(frag[0][0].style, N);
  });

  it('extracts across mixed-style runs in a single paragraph', () => {
    const story = [[run('ab', N), run('CD', B), run('ef', I)]];
    const frag = getStoryFragment(story, { paraIndex: 0, charOffset: 1 }, { paraIndex: 0, charOffset: 5 });
    assert.equal(frag.length, 1);
    const texts = frag[0].map(r => r.text);
    assert.equal(texts.join(''), 'bCDe');
  });

  it('extracts across two paragraphs', () => {
    const story = [[run('abc', N)], [run('DEF', B)]];
    const frag = getStoryFragment(story, { paraIndex: 0, charOffset: 1 }, { paraIndex: 1, charOffset: 2 });
    assert.equal(frag.length, 2);
    assert.equal(frag[0][0].text, 'bc');
    assert.equal(frag[1][0].text, 'DE');
  });

  it('extracts across three paragraphs preserving middle paragraph', () => {
    const story = [[run('abc', N)], [run('DEF', B)], [run('ghi', I)]];
    const frag = getStoryFragment(story, { paraIndex: 0, charOffset: 2 }, { paraIndex: 2, charOffset: 1 });
    assert.equal(frag.length, 3);
    assert.equal(frag[0][0].text, 'c');
    assert.equal(frag[1][0].text, 'DEF');
    assert.equal(frag[2][0].text, 'g');
  });

  it('preserves styles in extracted fragment', () => {
    const story = [[run('ab', N), run('CD', B)]];
    const frag = getStoryFragment(story, { paraIndex: 0, charOffset: 1 }, { paraIndex: 0, charOffset: 3 });
    assert.equal(frag.length, 1);
    assert.equal(frag[0][0].text, 'b');
    assert.deepEqual(frag[0][0].style, N);
    assert.equal(frag[0][1].text, 'C');
    assert.deepEqual(frag[0][1].style, B);
  });

  it('handles reversed positions', () => {
    const story = [[run('abcdef', N)]];
    const frag = getStoryFragment(story, { paraIndex: 0, charOffset: 4 }, { paraIndex: 0, charOffset: 1 });
    assert.equal(frag.length, 1);
    assert.equal(frag[0][0].text, 'bcd');
  });
});

describe('insertStoryFragment', () => {
  it('returns unchanged story for empty fragment', () => {
    const story = [[run('abc', N)]];
    const out = insertStoryFragment(story, { paraIndex: 0, charOffset: 1 }, []);
    assert.equal(out.story[0][0].text, 'abc');
    assert.deepEqual(out.cursor, { paraIndex: 0, charOffset: 1 });
  });

  it('inserts single-paragraph fragment into middle of paragraph', () => {
    const story = [[run('abcd', N)]];
    const frag = [[run('XY', B)]];
    const out = insertStoryFragment(story, { paraIndex: 0, charOffset: 2 }, frag);
    assert.equal(out.story.length, 1);
    const text = out.story[0].map(r => r.text).join('');
    assert.equal(text, 'abXYcd');
    assert.deepEqual(out.cursor, { paraIndex: 0, charOffset: 4 });
  });

  it('preserves styles when inserting single-paragraph fragment', () => {
    const story = [[run('ab', N)]];
    const frag = [[run('X', B)]];
    const out = insertStoryFragment(story, { paraIndex: 0, charOffset: 1 }, frag);
    assert.equal(out.story[0].length, 3);
    assert.equal(out.story[0][0].text, 'a');
    assert.deepEqual(out.story[0][0].style, N);
    assert.equal(out.story[0][1].text, 'X');
    assert.deepEqual(out.story[0][1].style, B);
    assert.equal(out.story[0][2].text, 'b');
    assert.deepEqual(out.story[0][2].style, N);
  });

  it('inserts multi-paragraph fragment splitting target paragraph', () => {
    const story = [[run('abcd', N)]];
    const frag = [[run('X', B)], [run('Y', I)]];
    const out = insertStoryFragment(story, { paraIndex: 0, charOffset: 2 }, frag);
    assert.equal(out.story.length, 2);
    // First paragraph: "ab" + "X"
    const firstText = out.story[0].map(r => r.text).join('');
    assert.equal(firstText, 'abX');
    // Second paragraph: "Y" + "cd"
    const secondText = out.story[1].map(r => r.text).join('');
    assert.equal(secondText, 'Ycd');
    assert.deepEqual(out.cursor, { paraIndex: 1, charOffset: 1 });
  });

  it('inserts three-paragraph fragment', () => {
    const story = [[run('abcd', N)]];
    const frag = [[run('X', N)], [run('MIDDLE', B)], [run('Z', N)]];
    const out = insertStoryFragment(story, { paraIndex: 0, charOffset: 2 }, frag);
    assert.equal(out.story.length, 3);
    assert.equal(out.story[0].map(r => r.text).join(''), 'abX');
    assert.equal(out.story[1][0].text, 'MIDDLE');
    assert.equal(out.story[2].map(r => r.text).join(''), 'Zcd');
    assert.deepEqual(out.cursor, { paraIndex: 2, charOffset: 1 });
  });

  it('inserts at paragraph start', () => {
    const story = [[run('abc', N)]];
    const frag = [[run('Z', B)]];
    const out = insertStoryFragment(story, { paraIndex: 0, charOffset: 0 }, frag);
    const text = out.story[0].map(r => r.text).join('');
    assert.equal(text, 'Zabc');
    assert.deepEqual(out.cursor, { paraIndex: 0, charOffset: 1 });
  });

  it('inserts at paragraph end', () => {
    const story = [[run('abc', N)]];
    const frag = [[run('Z', B)]];
    const out = insertStoryFragment(story, { paraIndex: 0, charOffset: 3 }, frag);
    const text = out.story[0].map(r => r.text).join('');
    assert.equal(text, 'abcZ');
    assert.deepEqual(out.cursor, { paraIndex: 0, charOffset: 4 });
  });

  it('round-trips with getStoryFragment', () => {
    const story = [[run('abc', N)], [run('DEF', B)], [run('ghi', I)]];
    const start = { paraIndex: 0, charOffset: 1 };
    const end = { paraIndex: 2, charOffset: 2 };
    const frag = getStoryFragment(story, start, end);

    // Insert into a fresh story
    const target = [[run('1234', N)]];
    const out = insertStoryFragment(target, { paraIndex: 0, charOffset: 2 }, frag);
    assert.equal(out.story.length, 3);
    assert.equal(out.story[0].map(r => r.text).join(''), '12bc');
    assert.equal(out.story[1][0].text, 'DEF');
    assert.equal(out.story[2].map(r => r.text).join(''), 'gh34');
  });
});
