import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { DragState } from '../app/drag-state.js';

const BOX = { id: 'box-1', x: 100, y: 50, width: 200, height: 150 };

describe('DragState', () => {
  it('starts in not-moved state', () => {
    const drag = new DragState({
      boxId: 'box-1',
      handle: 'body',
      start: { x: 10, y: 20 },
      startBox: BOX,
      wasAlreadySelected: false,
    });
    assert.equal(drag.moved, false);
  });

  it('small movements stay below threshold', () => {
    const drag = new DragState({
      boxId: 'box-1',
      handle: 'body',
      start: { x: 10, y: 20 },
      startBox: BOX,
      wasAlreadySelected: false,
    });
    const result = drag.pointerMove({ x: 10.5, y: 20.5 });
    assert.equal(result.moved, false);
    assert.equal(drag.moved, false);
  });

  it('movement beyond threshold marks as moved', () => {
    const drag = new DragState({
      boxId: 'box-1',
      handle: 'body',
      start: { x: 10, y: 20 },
      startBox: BOX,
      wasAlreadySelected: false,
    });
    const result = drag.pointerMove({ x: 15, y: 20 });
    assert.equal(result.dx, 5);
    assert.equal(result.dy, 0);
    assert.equal(result.moved, true);
    assert.equal(drag.moved, true);
  });

  it('once moved, stays moved even if pointer returns to start', () => {
    const drag = new DragState({
      boxId: 'box-1',
      handle: 'body',
      start: { x: 10, y: 20 },
      startBox: BOX,
      wasAlreadySelected: false,
    });
    drag.pointerMove({ x: 20, y: 20 }); // moved
    const result = drag.pointerMove({ x: 10, y: 20 }); // back to start
    assert.equal(result.moved, true); // still counts as moved
  });

  it('custom moveThreshold is respected', () => {
    const drag = new DragState({
      boxId: 'box-1',
      handle: 'body',
      start: { x: 10, y: 20 },
      startBox: BOX,
      wasAlreadySelected: false,
      moveThreshold: 5,
    });
    drag.pointerMove({ x: 14, y: 20 }); // dx=4, below threshold 5
    assert.equal(drag.moved, false);
    drag.pointerMove({ x: 16, y: 20 }); // dx=6, above threshold 5
    assert.equal(drag.moved, true);
  });
});

describe('DragState.resolve', () => {
  it('click on body without move is click-through', () => {
    const drag = new DragState({
      boxId: 'box-1',
      handle: 'body',
      start: { x: 10, y: 20 },
      startBox: BOX,
      wasAlreadySelected: true,
    });
    const result = drag.resolve();
    assert.deepEqual(result, {
      clickThrough: true,
      boxId: 'box-1',
      wasAlreadySelected: true,
    });
  });

  it('drag on body is not click-through', () => {
    const drag = new DragState({
      boxId: 'box-1',
      handle: 'body',
      start: { x: 10, y: 20 },
      startBox: BOX,
      wasAlreadySelected: true,
    });
    drag.pointerMove({ x: 30, y: 20 }); // significant move
    const result = drag.resolve();
    assert.equal(result.clickThrough, false);
  });

  it('click on resize handle is never click-through', () => {
    const drag = new DragState({
      boxId: 'box-1',
      handle: 'se',
      start: { x: 10, y: 20 },
      startBox: BOX,
      wasAlreadySelected: true,
    });
    // No movement, but handle is not 'body'
    const result = drag.resolve();
    assert.equal(result.clickThrough, false);
  });

  it('preserves wasAlreadySelected=false', () => {
    const drag = new DragState({
      boxId: 'box-2',
      handle: 'body',
      start: { x: 0, y: 0 },
      startBox: BOX,
      wasAlreadySelected: false,
    });
    const result = drag.resolve();
    assert.equal(result.wasAlreadySelected, false);
    assert.equal(result.boxId, 'box-2');
  });
});
