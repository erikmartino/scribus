import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { EditorState } from '../lib/editor-state.js';

const N = { bold: false, italic: false, fontFamily: '' };

function makeEvent(inputType, data) {
  return { inputType, data };
}

describe('EditorState', () => {
  it('applies insert/delete/paragraph operations through beforeinput', () => {
    const editor = new EditorState([[{ text: 'ab', style: N }]]);
    editor.setCursor({ paraIndex: 0, charOffset: 1, lineIndex: 0 });

    assert.equal(editor.handleBeforeInput(makeEvent('insertText', 'X')), true);
    assert.equal(editor.story[0][0].text, 'aXb');
    assert.equal(editor.cursor.charOffset, 2);

    assert.equal(editor.handleBeforeInput(makeEvent('deleteContentBackward')), true);
    assert.equal(editor.story[0][0].text, 'ab');
    assert.equal(editor.cursor.charOffset, 1);

    assert.equal(editor.handleBeforeInput(makeEvent('insertParagraph', null)), true);
    assert.equal(editor.story.length, 2);
    assert.equal(editor.story[0][0].text, 'a');
    assert.equal(editor.story[1][0].text, 'b');
    assert.deepEqual(editor.cursor, { paraIndex: 1, charOffset: 0, lineIndex: 0 });
  });

  it('falls back to keydown editing when beforeinput is unavailable', () => {
    const editor = new EditorState([[{ text: 'ab', style: N }]]);
    editor.setCursor({ paraIndex: 0, charOffset: 2, lineIndex: 0 });

    assert.equal(editor.handleKeydown({ key: 'c', isComposing: false, ctrlKey: false, metaKey: false, altKey: false }), true);
    assert.equal(editor.story[0][0].text, 'abc');

    assert.equal(editor.handleKeydown({ key: 'Backspace', isComposing: false, ctrlKey: false, metaKey: false, altKey: false }), true);
    assert.equal(editor.story[0][0].text, 'ab');

    assert.equal(editor.handleKeydown({ key: 'Enter', isComposing: false, ctrlKey: false, metaKey: false, altKey: false }), true);
    assert.equal(editor.story.length, 2);
  });

  it('ignores unknown beforeinput and composition keydown', () => {
    const editor = new EditorState([[{ text: 'ab', style: N }]]);
    const before = JSON.stringify(editor.story);

    assert.equal(editor.handleBeforeInput(makeEvent('historyUndo', null)), false);
    assert.equal(editor.handleKeydown({ key: 'x', isComposing: true, ctrlKey: false, metaKey: false, altKey: false }), false);
    assert.equal(JSON.stringify(editor.story), before);
  });

  it('replace-selection-on-type and collapse selection after edit', () => {
    const editor = new EditorState([[{ text: 'abcdef', style: N }]]);
    editor.setCursor({ paraIndex: 0, charOffset: 4, lineIndex: 0 });
    editor.moveCursor({ paraIndex: 0, charOffset: 2, lineIndex: 0 }, true);

    assert.equal(editor.hasSelection(), true);
    const range = editor.getSelectionRange();
    assert.deepEqual(range, {
      start: { paraIndex: 0, charOffset: 2 },
      end: { paraIndex: 0, charOffset: 4 },
    });

    assert.equal(editor.handleBeforeInput(makeEvent('insertText', 'X')), true);
    assert.equal(editor.story[0][0].text, 'abXef');
    assert.equal(editor.hasSelection(), false);
    assert.deepEqual(editor.cursor, { paraIndex: 0, charOffset: 3, lineIndex: 0 });
  });

  it('delete with selection removes range regardless of direction', () => {
    const editor = new EditorState([
      [{ text: 'abc', style: N }],
      [{ text: 'DEF', style: N }],
      [{ text: 'ghi', style: N }],
    ]);

    editor.setSelection({ paraIndex: 2, charOffset: 1 }, { paraIndex: 0, charOffset: 2 });
    assert.equal(editor.hasSelection(), true);

    assert.equal(editor.handleBeforeInput(makeEvent('deleteContentBackward', null)), true);
    assert.equal(editor.story.length, 1);
    assert.equal(editor.story[0][0].text, 'abhi');
    assert.deepEqual(editor.cursor, { paraIndex: 0, charOffset: 2, lineIndex: 0 });
    assert.equal(editor.hasSelection(), false);
  });

  it('getSelectedText returns text with paragraph newlines', () => {
    const editor = new EditorState([
      [{ text: 'abc', style: N }],
      [{ text: 'DEF', style: N }],
      [{ text: 'ghi', style: N }],
    ]);
    editor.setSelection({ paraIndex: 0, charOffset: 1 }, { paraIndex: 2, charOffset: 2 });
    assert.equal(editor.getSelectedText(), 'bc\nDEF\ngh');
  });

  it('replaceSelectionWithText replaces range and collapses selection', () => {
    const editor = new EditorState([
      [{ text: 'abc', style: N }],
      [{ text: 'DEF', style: N }],
      [{ text: 'ghi', style: N }],
    ]);
    editor.setSelection({ paraIndex: 0, charOffset: 2 }, { paraIndex: 2, charOffset: 1 });

    assert.equal(editor.replaceSelectionWithText('X\nY'), true);
    assert.equal(editor.story.length, 2);
    assert.equal(editor.story[0][0].text, 'abX');
    assert.equal(editor.story[1][0].text, 'Yhi');
    assert.equal(editor.hasSelection(), false);
    assert.deepEqual(editor.cursor, { paraIndex: 1, charOffset: 1, lineIndex: 0 });
  });

  it('selectWordAt selects current word boundaries', () => {
    const editor = new EditorState([[{ text: 'alpha beta,gamma', style: N }]]);
    editor.selectWordAt({ paraIndex: 0, charOffset: 7, lineIndex: 2 });
    assert.equal(editor.getSelectedText(), 'beta');
    assert.deepEqual(editor.cursor, { paraIndex: 0, charOffset: 10, lineIndex: 2 });
  });

  it('selectAll selects full document', () => {
    const editor = new EditorState([
      [{ text: 'abc', style: N }],
      [{ text: 'DEF', style: N }],
    ]);
    editor.selectAll();
    assert.equal(editor.getSelectedText(), 'abc\nDEF');
    assert.equal(editor.hasSelection(), true);
    assert.deepEqual(editor.cursor, { paraIndex: 1, charOffset: 3, lineIndex: 0 });
  });

  it('moveCursorByWord moves by word boundaries with optional extension', () => {
    const editor = new EditorState([[{ text: 'one two three', style: N }]]);
    editor.setCursor({ paraIndex: 0, charOffset: 0, lineIndex: 0 });

    editor.moveCursorByWord('right', false);
    assert.deepEqual(editor.cursor, { paraIndex: 0, charOffset: 3, lineIndex: 0 });

    editor.moveCursorByWord('right', true);
    assert.deepEqual(editor.cursor, { paraIndex: 0, charOffset: 7, lineIndex: 0 });
    assert.equal(editor.getSelectedText(), ' two');
  });

  it('deleteWordBackward and deleteWordForward remove word chunks', () => {
    const editor = new EditorState([[{ text: 'one two three', style: N }]]);
    editor.setCursor({ paraIndex: 0, charOffset: 7, lineIndex: 0 });

    assert.equal(editor.deleteWordBackward(), true);
    assert.equal(editor.story[0][0].text, 'one three');
    assert.deepEqual(editor.cursor, { paraIndex: 0, charOffset: 4, lineIndex: 0 });

    assert.equal(editor.deleteWordForward(), true);
    assert.equal(editor.story[0][0].text, 'one ');
    assert.deepEqual(editor.cursor, { paraIndex: 0, charOffset: 4, lineIndex: 0 });
  });

  it('handleBeforeInput supports deleteWordBackward/deleteWordForward', () => {
    const editor = new EditorState([[{ text: 'alpha beta gamma', style: N }]]);
    editor.setCursor({ paraIndex: 0, charOffset: 10, lineIndex: 0 });

    assert.equal(editor.handleBeforeInput(makeEvent('deleteWordBackward', null)), true);
    assert.equal(editor.story[0][0].text, 'alpha gamma');
    assert.deepEqual(editor.cursor, { paraIndex: 0, charOffset: 6, lineIndex: 0 });

    assert.equal(editor.handleBeforeInput(makeEvent('deleteWordForward', null)), true);
    assert.equal(editor.story[0][0].text, 'alpha ');
    assert.deepEqual(editor.cursor, { paraIndex: 0, charOffset: 6, lineIndex: 0 });
  });

  it('applyCharacterStyle patches selected text styles', () => {
    const editor = new EditorState([[{ text: 'ab', style: N }, { text: 'CD', style: N }]]);
    editor.setSelection({ paraIndex: 0, charOffset: 1 }, { paraIndex: 0, charOffset: 3 });

    assert.equal(editor.applyCharacterStyle({ bold: true }), true);
    assert.equal(editor.hasSelection(), false);
    assert.deepEqual(editor.story[0].map((r) => ({ text: r.text, style: r.style })), [
      { text: 'a', style: N },
      { text: 'bC', style: { bold: true, italic: false, fontFamily: '' } },
      { text: 'D', style: N },
    ]);
  });

  it('applyCharacterStyle updates typing style at caret for new text', () => {
    const editor = new EditorState([[{ text: 'ab', style: N }]]);
    editor.setCursor({ paraIndex: 0, charOffset: 2, lineIndex: 0 });

    assert.equal(editor.applyCharacterStyle({ italic: true }), true);
    const typing = editor.getTypingStyle();
    assert.deepEqual(typing, { bold: false, italic: true, fontFamily: '' });

    assert.equal(editor.handleBeforeInput(makeEvent('insertText', 'X')), true);
    assert.deepEqual(editor.story[0].map((r) => ({ text: r.text, style: r.style })), [
      { text: 'ab', style: N },
      { text: 'X', style: { bold: false, italic: true, fontFamily: '' } },
    ]);
  });

  it('applyCharacterStyleToCurrentParagraph styles whole paragraph without moving cursor', () => {
    const editor = new EditorState([
      [{ text: 'hello', style: N }, { text: ' world', style: N }],
      [{ text: 'second', style: N }],
    ]);
    editor.setCursor({ paraIndex: 0, charOffset: 3, lineIndex: 0 });

    editor.applyCharacterStyleToCurrentParagraph({ fontFamily: 'Inter' });

    // Every run in paragraph 0 should have fontFamily: 'Inter'
    for (const run of editor.story[0]) {
      assert.equal(run.style.fontFamily, 'Inter');
    }

    // Paragraph 1 should be unaffected
    assert.equal(editor.story[1][0].style.fontFamily, '');

    // Cursor should remain where it was
    assert.deepEqual(editor.cursor, { paraIndex: 0, charOffset: 3, lineIndex: 0 });

    // Selection should be cleared
    assert.equal(editor.hasSelection(), false);
  });

  it('applyCharacterStyleToCurrentParagraph preserves existing mixed styles', () => {
    const B = { bold: true, italic: false, fontFamily: '' };
    const editor = new EditorState([
      [{ text: 'ab', style: N }, { text: 'CD', style: B }],
    ]);
    editor.setCursor({ paraIndex: 0, charOffset: 1, lineIndex: 0 });

    editor.applyCharacterStyleToCurrentParagraph({ italic: true });

    // Each run should now have italic: true, but bold unchanged
    assert.deepEqual(editor.story[0].map(r => ({ text: r.text, b: r.style.bold, i: r.style.italic })), [
      { text: 'ab', b: false, i: true },
      { text: 'CD', b: true, i: true },
    ]);
  });

  it('getState/setState snapshots and restores full state', () => {
    const editor = new EditorState([[{ text: 'abc', style: N }]]);
    editor.setSelection({ paraIndex: 0, charOffset: 0 }, { paraIndex: 0, charOffset: 2 });
    editor.applyCharacterStyle({ bold: true }); // Sets typing style at caret or applies to range
    editor.setCursor({ paraIndex: 0, charOffset: 1 });
    
    // Set a specific typing style
    editor.applyCharacterStyle({ italic: true });
    
    const snapshot = editor.getState();
    
    // Mutate state
    editor.applyOperation('insertText', { text: 'CHANGED' });
    editor.setCursor({ paraIndex: 0, charOffset: 0 });
    
    // Restore
    editor.setState(snapshot);
    
    assert.deepEqual(editor.getState(), snapshot);
    assert.equal(editor.story[0][0].text, 'ab'); // Applied bold to [0,2), so 'abc' became 'ab' (bold) + 'c' (normal)
    assert.deepEqual(editor.cursor, { paraIndex: 0, charOffset: 1, lineIndex: 0 });
    assert.deepEqual(editor.getTypingStyle(), { bold: true, italic: true, fontFamily: '' });
  });

  it('paragraphStyles tracks per-paragraph fontSize for UI panel binding', () => {
    const styles = [
      { fontSize: 30, fontFamily: 'EB Garamond' },
      { fontSize: 22, fontFamily: 'EB Garamond' },
    ];
    const editor = new EditorState([
      [{ text: 'Lead paragraph', style: N }],
      [{ text: 'Normal paragraph', style: N }],
    ], styles);

    // Cursor in first paragraph — UI panel should show 30
    editor.setCursor({ paraIndex: 0, charOffset: 0, lineIndex: 0 });
    assert.equal(editor.paragraphStyles[editor.cursor.paraIndex].fontSize, 30);

    // Move cursor to second paragraph — UI panel should show 22
    editor.setCursor({ paraIndex: 1, charOffset: 0, lineIndex: 1 });
    assert.equal(editor.paragraphStyles[editor.cursor.paraIndex].fontSize, 22);
  });

  it('paragraphStyles grows when inserting paragraph breaks', () => {
    const styles = [
      { fontSize: 30, fontFamily: 'EB Garamond' },
    ];
    const editor = new EditorState([
      [{ text: 'abc', style: N }],
    ], styles);

    editor.setCursor({ paraIndex: 0, charOffset: 1, lineIndex: 0 });
    editor.applyOperation('insertParagraphBreak');

    // Should now have two paragraphs and two styles
    assert.equal(editor.story.length, 2);
    assert.equal(editor.paragraphStyles.length, 2);
    // New paragraph inherits the base style's fontSize
    assert.equal(editor.paragraphStyles[1].fontSize, 30);
  });

  it('paragraphStyles shrinks when merging paragraphs via delete', () => {
    const styles = [
      { fontSize: 30, fontFamily: 'EB Garamond' },
      { fontSize: 22, fontFamily: 'EB Garamond' },
    ];
    const editor = new EditorState([
      [{ text: 'abc', style: N }],
      [{ text: 'def', style: N }],
    ], styles);

    // Delete backward at start of paragraph 1 merges with paragraph 0
    editor.setCursor({ paraIndex: 1, charOffset: 0, lineIndex: 1 });
    editor.applyOperation('deleteBackward');

    assert.equal(editor.story.length, 1);
    assert.equal(editor.paragraphStyles.length, 1);
  });
});
