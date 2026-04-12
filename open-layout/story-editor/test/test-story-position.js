import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import {
  paraTextLength, moveLeft, moveRight,
  positionToPoint, xToPos, pointToPos, resolveLineIndex,
} from '../lib/story-position.js';

const story = [
  [{ text: 'hello', style: {} }, { text: ' world', style: {} }],
  [{ text: 'foo', style: {} }],
];

function makeLine(lineIndex, paraIndex, positions, overrides) {
  return {
    lineIndex, paraIndex, positions,
    colX: 0, boxY: 0, boxWidth: 200, boxHeight: 400, y: 30 + lineIndex * 30,
    ...overrides,
  };
}

describe('paraTextLength', () => {
  it('sums run lengths', () => {
    assert.equal(paraTextLength(story, 0), 11);
    assert.equal(paraTextLength(story, 1), 3);
  });
});

describe('moveLeft', () => {
  const lineMap = [
    makeLine(0, 0, [{ charPos: 0, x: 16 }, { charPos: 11, x: 126 }]),
    makeLine(1, 1, [{ charPos: 0, x: 16 }, { charPos: 3, x: 46 }]),
  ];

  it('decrements charOffset', () => {
    const r = moveLeft({ paraIndex: 0, charOffset: 5, lineIndex: 0 }, story, lineMap);
    assert.equal(r.charOffset, 4);
  });

  it('wraps to previous paragraph', () => {
    const r = moveLeft({ paraIndex: 1, charOffset: 0, lineIndex: 1 }, story, lineMap);
    assert.equal(r.paraIndex, 0);
    assert.equal(r.charOffset, 11);
  });

  it('clamps at start', () => {
    const r = moveLeft({ paraIndex: 0, charOffset: 0, lineIndex: 0 }, story, lineMap);
    assert.equal(r.charOffset, 0);
    assert.equal(r.paraIndex, 0);
  });
});

describe('moveRight', () => {
  const lineMap = [
    makeLine(0, 0, [{ charPos: 0, x: 16 }, { charPos: 11, x: 126 }]),
    makeLine(1, 1, [{ charPos: 0, x: 16 }, { charPos: 3, x: 46 }]),
  ];

  it('increments charOffset', () => {
    const r = moveRight({ paraIndex: 0, charOffset: 3, lineIndex: 0 }, story, lineMap);
    assert.equal(r.charOffset, 4);
  });

  it('wraps to next paragraph', () => {
    const r = moveRight({ paraIndex: 0, charOffset: 11, lineIndex: 0 }, story, lineMap);
    assert.equal(r.paraIndex, 1);
    assert.equal(r.charOffset, 0);
  });

  it('clamps at end', () => {
    const r = moveRight({ paraIndex: 1, charOffset: 3, lineIndex: 1 }, story, lineMap);
    assert.equal(r.charOffset, 3);
    assert.equal(r.paraIndex, 1);
  });
});

describe('positionToPoint', () => {
  it('returns x from positions array', () => {
    const lineMap = [makeLine(0, 0, [
      { charPos: 0, x: 16 }, { charPos: 1, x: 26 }, { charPos: 2, x: 36 },
    ])];
    const pt = positionToPoint({ paraIndex: 0, charOffset: 1, lineIndex: 0 }, lineMap, 20);
    assert.equal(pt.x, 26);
  });

  it('returns character-start x even when right-edge entry exists at higher charPos', () => {
    const lineMap = [makeLine(0, 0, [
      { charPos: 0, x: 16 }, { charPos: 1, x: 26 },
      { charPos: 2, x: 40 }, // right-edge entry (next char's charPos)
    ])];
    // charOffset 1 should return the character-start x, not the right edge
    const pt = positionToPoint({ paraIndex: 0, charOffset: 1, lineIndex: 0 }, lineMap, 20);
    assert.equal(pt.x, 26);
  });
});

describe('xToPos', () => {
  const line = makeLine(0, 0, [
    { charPos: 0, x: 16 }, { charPos: 1, x: 26 }, { charPos: 2, x: 36 },
  ]);

  it('snaps to nearest position', () => {
    const r = xToPos(20, line, 0);
    assert.equal(r.charOffset, 0);
  });

  it('uses left/right half logic', () => {
    const r = xToPos(22, line, 0);
    assert.equal(r.charOffset, 1); // right half of char 0
  });

  it('clamps to last position', () => {
    const r = xToPos(100, line, 0);
    assert.equal(r.charOffset, 2);
  });

  it('returns lineIndex', () => {
    const r = xToPos(20, line, 7);
    assert.equal(r.lineIndex, 7);
  });
});

describe('pointToPos', () => {
  it('finds correct box', () => {
    const lineMap = [
      makeLine(0, 0, [{ charPos: 0, x: 16 }, { charPos: 2, x: 36 }],
        { colX: 0, boxY: 0, boxWidth: 100, boxHeight: 200 }),
      makeLine(1, 0, [{ charPos: 3, x: 146 }, { charPos: 5, x: 166 }],
        { colX: 130, boxY: 40, boxWidth: 80, boxHeight: 160, y: 70 }),
    ];
    const r1 = pointToPos(20, 30, lineMap);
    assert.ok(r1.charOffset <= 2);
    const r2 = pointToPos(150, 70, lineMap);
    assert.ok(r2.charOffset >= 3);
  });
});

describe('line boundary disambiguation', () => {
  it('moveRight at boundary prefers later line', () => {
    const lineMap = [
      makeLine(0, 0, [{ charPos: 0, x: 16 }, { charPos: 4, x: 56 }]),
      makeLine(1, 0, [{ charPos: 4, x: 16 }, { charPos: 8, x: 56 }]),
    ];
    // moveRight from charOffset 3 → 4, which exists on both lines
    const r = moveRight({ paraIndex: 0, charOffset: 3, lineIndex: 0 }, story, lineMap);
    assert.equal(r.charOffset, 4);
    assert.equal(r.lineIndex, 1); // prefers later line
  });

  it('resolveLineIndex prefers later line at shared boundary', () => {
    const lineMap = [
      makeLine(0, 0, [{ charPos: 0, x: 16 }, { charPos: 4, x: 56 }]),
      makeLine(1, 0, [{ charPos: 4, x: 16 }, { charPos: 8, x: 56 }]),
    ];
    const lineIndex = resolveLineIndex({ paraIndex: 0, charOffset: 4 }, lineMap);
    assert.equal(lineIndex, 1);
  });
});
