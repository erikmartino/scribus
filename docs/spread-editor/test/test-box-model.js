import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import {
  createBoxesFromDefaults,
  replaceBox,
  clampBoxToBounds,
  clampBoxesToBounds,
  moveBox,
  resizeBox,
} from '../app/box-model.js';

const BOUNDS = { x: 0, y: 0, width: 800, height: 600 };

describe('createBoxesFromDefaults', () => {
  it('assigns default ids when none are provided', () => {
    const boxes = createBoxesFromDefaults([
      { x: 10, y: 20, width: 200, height: 100 },
      { x: 50, y: 60, width: 300, height: 150 },
    ]);
    assert.equal(boxes.length, 2);
    assert.equal(boxes[0].id, 'box-1');
    assert.equal(boxes[1].id, 'box-2');
  });

  it('preserves explicit ids', () => {
    const boxes = createBoxesFromDefaults([
      { id: 'my-box', x: 0, y: 0, width: 100, height: 100 },
    ]);
    assert.equal(boxes[0].id, 'my-box');
  });

  it('applies default minWidth and minHeight', () => {
    const boxes = createBoxesFromDefaults([
      { x: 0, y: 0, width: 200, height: 100 },
    ]);
    assert.equal(boxes[0].minWidth, 80);
    assert.equal(boxes[0].minHeight, 50);
  });

  it('respects custom minWidth and minHeight', () => {
    const boxes = createBoxesFromDefaults([
      { x: 0, y: 0, width: 200, height: 100, minWidth: 40, minHeight: 30 },
    ]);
    assert.equal(boxes[0].minWidth, 40);
    assert.equal(boxes[0].minHeight, 30);
  });

  it('copies x, y, width, height exactly', () => {
    const boxes = createBoxesFromDefaults([
      { x: 15, y: 25, width: 123, height: 456 },
    ]);
    assert.equal(boxes[0].x, 15);
    assert.equal(boxes[0].y, 25);
    assert.equal(boxes[0].width, 123);
    assert.equal(boxes[0].height, 456);
  });
});

describe('replaceBox', () => {
  it('replaces the box with matching id', () => {
    const boxes = [
      { id: 'a', x: 0, y: 0, width: 100, height: 100 },
      { id: 'b', x: 50, y: 50, width: 200, height: 200 },
    ];
    const updated = { id: 'b', x: 99, y: 99, width: 300, height: 300 };
    const result = replaceBox(boxes, updated);

    assert.equal(result.length, 2);
    assert.deepEqual(result[0], boxes[0]);
    assert.deepEqual(result[1], updated);
  });

  it('returns unchanged array when id not found', () => {
    const boxes = [{ id: 'a', x: 0, y: 0, width: 100, height: 100 }];
    const result = replaceBox(boxes, { id: 'z', x: 1, y: 1, width: 1, height: 1 });
    assert.deepEqual(result, boxes);
  });

  it('does not mutate the original array', () => {
    const boxes = [{ id: 'a', x: 0, y: 0, width: 100, height: 100 }];
    const result = replaceBox(boxes, { id: 'a', x: 50, y: 50, width: 100, height: 100 });
    assert.notEqual(result, boxes);
    assert.equal(boxes[0].x, 0);
  });
});

describe('clampBoxToBounds', () => {
  it('keeps box inside when already within bounds', () => {
    const box = { id: 'a', x: 100, y: 100, width: 200, height: 150 };
    const result = clampBoxToBounds(box, BOUNDS);
    assert.equal(result.x, 100);
    assert.equal(result.y, 100);
    assert.equal(result.width, 200);
    assert.equal(result.height, 150);
  });

  it('clamps x to left boundary', () => {
    const box = { id: 'a', x: -50, y: 100, width: 200, height: 100 };
    const result = clampBoxToBounds(box, BOUNDS);
    assert.equal(result.x, 0);
  });

  it('clamps x to right boundary', () => {
    const box = { id: 'a', x: 700, y: 100, width: 200, height: 100 };
    const result = clampBoxToBounds(box, BOUNDS);
    assert.equal(result.x, 600); // 800 - 200
  });

  it('clamps y to top boundary', () => {
    const box = { id: 'a', x: 100, y: -30, width: 200, height: 100 };
    const result = clampBoxToBounds(box, BOUNDS);
    assert.equal(result.y, 0);
  });

  it('clamps y to bottom boundary', () => {
    const box = { id: 'a', x: 100, y: 550, width: 200, height: 100 };
    const result = clampBoxToBounds(box, BOUNDS);
    assert.equal(result.y, 500); // 600 - 100
  });

  it('enforces minimum width', () => {
    const box = { id: 'a', x: 100, y: 100, width: 30, height: 100 };
    const result = clampBoxToBounds(box, BOUNDS);
    assert.equal(result.width, 80); // default MIN_WIDTH
  });

  it('enforces minimum height', () => {
    const box = { id: 'a', x: 100, y: 100, width: 200, height: 20 };
    const result = clampBoxToBounds(box, BOUNDS);
    assert.equal(result.height, 50); // default MIN_HEIGHT
  });

  it('caps width to bounds width', () => {
    const box = { id: 'a', x: 0, y: 0, width: 1000, height: 100 };
    const result = clampBoxToBounds(box, BOUNDS);
    assert.equal(result.width, 800);
  });

  it('works with non-zero bounds origin', () => {
    const bounds = { x: 100, y: 50, width: 400, height: 300 };
    const box = { id: 'a', x: 50, y: 20, width: 200, height: 100 };
    const result = clampBoxToBounds(box, bounds);
    assert.equal(result.x, 100); // clamped to bounds.x
    assert.equal(result.y, 50);  // clamped to bounds.y
  });
});

describe('clampBoxesToBounds', () => {
  it('clamps all boxes in array', () => {
    const boxes = [
      { id: 'a', x: -10, y: -10, width: 100, height: 100 },
      { id: 'b', x: 750, y: 550, width: 200, height: 200 },
    ];
    const result = clampBoxesToBounds(boxes, BOUNDS);
    assert.equal(result.length, 2);
    assert.equal(result[0].x, 0);
    assert.equal(result[0].y, 0);
    assert.equal(result[1].x, 600); // 800 - 200
    assert.equal(result[1].y, 400); // 600 - 200
  });
});

describe('moveBox', () => {
  const box = { id: 'a', x: 100, y: 100, width: 200, height: 150 };

  it('applies delta to position', () => {
    const result = moveBox(box, 50, 30, BOUNDS);
    assert.equal(result.x, 150);
    assert.equal(result.y, 130);
    assert.equal(result.width, 200);
    assert.equal(result.height, 150);
  });

  it('clamps to bounds after move', () => {
    const result = moveBox(box, 700, 500, BOUNDS);
    assert.equal(result.x, 600); // 800 - 200
    assert.equal(result.y, 450); // 600 - 150
  });

  it('clamps negative deltas to bounds', () => {
    const result = moveBox(box, -200, -200, BOUNDS);
    assert.equal(result.x, 0);
    assert.equal(result.y, 0);
  });

  it('preserves box dimensions', () => {
    const result = moveBox(box, 10, 10, BOUNDS);
    assert.equal(result.width, 200);
    assert.equal(result.height, 150);
  });
});

describe('resizeBox', () => {
  const box = { id: 'a', x: 100, y: 100, width: 200, height: 150 };

  it('resizes east handle (right edge)', () => {
    const result = resizeBox(box, 'e', 50, 0, BOUNDS);
    assert.equal(result.width, 250);
    assert.equal(result.x, 100);
  });

  it('resizes south handle (bottom edge)', () => {
    const result = resizeBox(box, 's', 0, 40, BOUNDS);
    assert.equal(result.height, 190);
    assert.equal(result.y, 100);
  });

  it('resizes west handle (left edge)', () => {
    const result = resizeBox(box, 'w', -30, 0, BOUNDS);
    assert.equal(result.x, 70);
    assert.equal(result.width, 230);
  });

  it('resizes north handle (top edge)', () => {
    const result = resizeBox(box, 'n', 0, -20, BOUNDS);
    assert.equal(result.y, 80);
    assert.equal(result.height, 170);
  });

  it('resizes se corner', () => {
    const result = resizeBox(box, 'se', 30, 20, BOUNDS);
    assert.equal(result.width, 230);
    assert.equal(result.height, 170);
    assert.equal(result.x, 100);
    assert.equal(result.y, 100);
  });

  it('resizes nw corner', () => {
    const result = resizeBox(box, 'nw', -10, -15, BOUNDS);
    assert.equal(result.x, 90);
    assert.equal(result.y, 85);
    assert.equal(result.width, 210);
    assert.equal(result.height, 165);
  });

  it('resizes ne corner', () => {
    const result = resizeBox(box, 'ne', 20, -10, BOUNDS);
    assert.equal(result.width, 220);
    assert.equal(result.y, 90);
    assert.equal(result.height, 160);
    assert.equal(result.x, 100);
  });

  it('resizes sw corner', () => {
    const result = resizeBox(box, 'sw', -15, 25, BOUNDS);
    assert.equal(result.x, 85);
    assert.equal(result.width, 215);
    assert.equal(result.height, 175);
    assert.equal(result.y, 100);
  });

  it('enforces minimum width on east shrink', () => {
    const result = resizeBox(box, 'e', -200, 0, BOUNDS);
    assert.equal(result.width, 80); // MIN_WIDTH
  });

  it('enforces minimum height on south shrink', () => {
    const result = resizeBox(box, 's', 0, -200, BOUNDS);
    assert.equal(result.height, 50); // MIN_HEIGHT
  });

  it('enforces minimum width on west handle and adjusts x', () => {
    const result = resizeBox(box, 'w', 200, 0, BOUNDS);
    // width would be 200 - 200 = 0, clamped to 80
    // x adjusts: 100 + 200 - (80 - 0) => corrected to maintain position
    assert.equal(result.width, 80);
    assert.equal(result.x, 220); // 100 + 200 - (80 - 0) = 220
  });

  it('enforces minimum height on north handle and adjusts y', () => {
    const result = resizeBox(box, 'n', 0, 200, BOUNDS);
    // height would be 150 - 200 = -50, clamped to 50
    // y adjusts: 100 + 200 - (50 - (-50)) => corrected
    assert.equal(result.height, 50);
    assert.equal(result.y, 200); // 100 + 200 - (50 - (-50)) = 200
  });

  it('clamps result to bounds', () => {
    const result = resizeBox(box, 'e', 800, 0, BOUNDS);
    // clampBoxToBounds caps width to bounds.width (800), then adjusts x
    // so the box fits: x = min(100, 800-800) = 0
    assert.equal(result.width, 800);
    assert.equal(result.x, 0); // pushed left to stay within bounds
  });

  it('respects custom minWidth on the box', () => {
    const customBox = { ...box, minWidth: 120 };
    const result = resizeBox(customBox, 'e', -200, 0, BOUNDS);
    assert.equal(result.width, 120);
  });
});
