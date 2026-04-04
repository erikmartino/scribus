import '../../app-shell/test/dom-mock.js';
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { StoryEditorPlugin } from '../lib/story-editor-plugin.js';
import { EditorState } from '../lib/editor-state.js';

describe('StoryEditorPlugin Integration', () => {
  let editor;
  let plugin;
  let mockShell;
  let updateCount = 0;

  after(() => {
    delete globalThis.document;
  });

  const setup = () => {
    updateCount = 0;
    const initialStory = [[{ text: 'Initial', style: { bold: false, italic: false, fontFamily: '' } }]];
    editor = new EditorState(initialStory);
    const styles = [{ fontSize: 22, fontFamily: 'EB Garamond' }];
    plugin = new StoryEditorPlugin(editor, () => { updateCount++; }, styles);
    
    const registeredCommands = new Map();

    mockShell = {
      commands: {
          register: (cmd) => {
            registeredCommands.set(cmd.id, cmd);
          },
          execute: (id) => {
            const cmd = registeredCommands.get(id);
            if (cmd) cmd.execute();
          },
          get: (id) => registeredCommands.get(id)
      },
      history: {
          submit: (action) => {
              mockShell.history.lastSubmitted = action;
          }
      },
      doc: {
          registerItem: () => {}
      },
      ui: {
          createButton: (opts) => {
            const btn = document.createElement('scribus-button');
            btn.dataset.commandId = opts.commandId;
            return btn;
          },
          createInput: (opts) => {
            const input = document.createElement('scribus-input');
            input.dataset.label = opts.label;
            return input;
          }
      },
      selection: {
          select: () => {},
          clear: () => {}
      },
      addEventListener: () => {}
    };
    
    plugin.init(mockShell);
    // Move cursor to end for predictable typing tests
    editor.setCursor({ paraIndex: 0, charOffset: 7 });
    return { registeredCommands };
  };

  it('registers expected commands on init', () => {
    const { registeredCommands } = setup();
    assert.ok(registeredCommands.has('story.bold'));
    assert.ok(registeredCommands.has('story.italic'));
    assert.ok(registeredCommands.has('story.resetLayout'));
  });

  it('submitAction pushes to history and updates state', () => {
    setup();
    plugin.submitAction('Test Action', () => {
      editor.applyOperation('insertText', { text: '!' });
    });
    
    assert.strictEqual(updateCount, 1);
    assert.ok(mockShell.history.lastSubmitted);
    assert.strictEqual(mockShell.history.lastSubmitted.name, 'Test Action');
    assert.strictEqual(editor.story[0][0].text, 'Initial!');
  });

  it('undo restores state correctly', () => {
    setup();
    const originalText = editor.story[0][0].text;
    plugin.submitAction('Add text', () => {
      editor.applyOperation('insertText', { text: '?' });
    });
    
    const action = mockShell.history.lastSubmitted;
    action.undo();
    assert.strictEqual(editor.story[0][0].text, originalText);
    assert.strictEqual(updateCount, 2); // 1 for submit, 1 for undo
  });

  it('redo (execute) reapplies state correctly', () => {
    setup();
    const originalText = editor.story[0][0].text;
    plugin.submitAction('Add text', () => {
      editor.applyOperation('insertText', { text: '?' });
    });
    
    const action = mockShell.history.lastSubmitted;
    action.undo();
    action.execute(); // redo
    assert.strictEqual(editor.story[0][0].text, originalText + '?');
    assert.strictEqual(updateCount, 3); 
  });

  it('handlePaste correctly processes story items', () => {
    setup();
    const payload = {
      items: [
        {
          type: 'story',
          story: [[{ text: 'Pasted', style: {} }]]
        }
      ]
    };
    
    // Select all to replace
    editor.selectAll();
    plugin.handlePaste(payload);
    
    assert.strictEqual(editor.story[0][0].text, 'Pasted');
    assert.strictEqual(mockShell.history.lastSubmitted.name, 'Paste Story');
  });

  it('groups consecutive typing actions', (t) => {
    setup();
    // Use t.mock.timers() if needed, but here we can just check if submit is called
    const historySubmit = t.mock.method(mockShell.history, 'submit');
    
    plugin.submitAction('Insert Text', () => {
      editor.applyOperation('insertText', { text: 'a' });
    }, 'insertText');
    
    assert.strictEqual(historySubmit.mock.callCount(), 1);
    
    // Next character should NOT call submit again if within same group
    plugin.submitAction('Insert Text', () => {
      editor.applyOperation('insertText', { text: 'b' });
    }, 'insertText');
    
    assert.strictEqual(historySubmit.mock.callCount(), 1);
    assert.strictEqual(editor.story[0][0].text, 'Initialab');
  });
});
