import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { ClickTracker } from '../lib/click-tracker.js';

describe('ClickTracker', () => {
  it('starts at click count 0', () => {
    const tracker = new ClickTracker();
    assert.equal(tracker.clickCount, 0);
  });

  it('first click sets count to 1', () => {
    const tracker = new ClickTracker();
    assert.equal(tracker.registerClick(1000), 1);
    assert.equal(tracker.clickCount, 1);
  });

  it('rapid second click increments to 2 (double-click)', () => {
    const tracker = new ClickTracker();
    tracker.registerClick(1000);
    assert.equal(tracker.registerClick(1200), 2);
  });

  it('rapid third click increments to 3 (triple-click)', () => {
    const tracker = new ClickTracker();
    tracker.registerClick(1000);
    tracker.registerClick(1100);
    assert.equal(tracker.registerClick(1200), 3);
  });

  it('slow second click resets to 1', () => {
    const tracker = new ClickTracker();
    tracker.registerClick(1000);
    assert.equal(tracker.registerClick(1500), 1); // 500ms > 350ms threshold
  });

  it('custom threshold is respected', () => {
    const tracker = new ClickTracker(100);
    tracker.registerClick(1000);
    assert.equal(tracker.registerClick(1050), 2); // within 100ms
    tracker.registerClick(1050);
    assert.equal(tracker.registerClick(1200), 1); // 150ms > 100ms
  });

  it('reset clears state', () => {
    const tracker = new ClickTracker();
    tracker.registerClick(1000);
    tracker.registerClick(1100);
    tracker.reset();
    assert.equal(tracker.clickCount, 0);
    // Next click after reset should be 1, not 3
    assert.equal(tracker.registerClick(1200), 1);
  });
});

describe('ClickTracker.resolveAction', () => {
  it('single click without shift returns caret/char', () => {
    const tracker = new ClickTracker();
    tracker.registerClick(1000);
    const result = tracker.resolveAction({ shiftKey: false });
    assert.deepEqual(result, { mode: 'char', action: 'caret' });
  });

  it('single click with shift returns extend/char', () => {
    const tracker = new ClickTracker();
    tracker.registerClick(1000);
    const result = tracker.resolveAction({ shiftKey: true });
    assert.deepEqual(result, { mode: 'char', action: 'extend' });
  });

  it('double click returns word mode', () => {
    const tracker = new ClickTracker();
    tracker.registerClick(1000);
    tracker.registerClick(1100);
    const result = tracker.resolveAction({ shiftKey: false });
    assert.deepEqual(result, { mode: 'word', action: 'word' });
  });

  it('triple click returns paragraph mode', () => {
    const tracker = new ClickTracker();
    tracker.registerClick(1000);
    tracker.registerClick(1100);
    tracker.registerClick(1200);
    const result = tracker.resolveAction({ shiftKey: false });
    assert.deepEqual(result, { mode: 'paragraph', action: 'paragraph' });
  });

  it('shift overrides even on double/triple click', () => {
    const tracker = new ClickTracker();
    tracker.registerClick(1000);
    tracker.registerClick(1100);
    const result = tracker.resolveAction({ shiftKey: true });
    assert.deepEqual(result, { mode: 'char', action: 'extend' });
  });
});
