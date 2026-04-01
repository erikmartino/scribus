import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { CommandHistory } from '../lib/command-manager.js';

describe('CommandHistory', () => {
  it('submits commands and updates stacks', () => {
    const history = new CommandHistory();
    let execCount = 0;
    let undoCount = 0;
    
    const cmd = {
      execute: () => execCount++,
      undo: () => undoCount++,
      label: 'test'
    };

    history.submit(cmd);
    assert.equal(execCount, 1);
    assert.equal(history.canUndo(), true);
    assert.equal(history.canRedo(), false);
    
    history.undo();
    assert.equal(undoCount, 1);
    assert.equal(history.canUndo(), false);
    assert.equal(history.canRedo(), true);
    
    history.redo();
    assert.equal(execCount, 2);
    assert.equal(history.canUndo(), true);
    assert.equal(history.canRedo(), false);
  });

  it('clears redo stack on new submit', () => {
    const history = new CommandHistory();
    history.submit({ execute: () => {}, undo: () => {} });
    history.undo();
    assert.equal(history.canRedo(), true);
    
    history.submit({ execute: () => {}, undo: () => {} });
    assert.equal(history.canRedo(), false);
  });
});
