import test from 'node:test';
import assert from 'node:assert';
import { StoryEditorPlugin } from '../lib/story-editor-plugin.js';

// Mock EditorState
class MockEditor {
  constructor() {
    this.story = [[{ text: 'Hello', style: {} }]];
    this.cursor = { paraIndex: 0, charOffset: 0 };
    this.selection = null;
    this.paragraphStyles = [{ fontSize: 22 }];
  }
  getState() { return { story: this.story, cursor: this.cursor }; }
  getTypingStyle() { return {}; }
  hasSelection() { return false; }
}

// Mock Shell
class MockShell {
  constructor() {
    this.updated = false;
    this.commands = { register: () => {} };
  }
  requestUpdate() {
    this.updated = true;
  }
}

test('StoryEditorPlugin calls update and requestUpdate on actions', async (t) => {
  let updateCalled = false;
  const editor = new MockEditor();
  const shell = new MockShell();
  
  const plugin = new StoryEditorPlugin(editor, () => {
    updateCalled = true;
    shell.requestUpdate();
  }, editor.paragraphStyles);
  
  plugin.init(shell);
  
  // Trigger an action
  plugin.submitAction('Test', () => {
    editor.story[0][0].text = 'Updated';
  });
  
  assert.strictEqual(updateCalled, true, 'update callback should be called');
  assert.strictEqual(shell.updated, true, 'shell.requestUpdate should be called via the callback');
});

test('StoryEditorPlugin returns valid panel descriptors', async (t) => {
  const editor = new MockEditor();
  const plugin = new StoryEditorPlugin(editor, () => {}, editor.paragraphStyles);
  
  const descriptors = plugin.getPanelDescriptors([]);
  assert.ok(Array.isArray(descriptors), 'descriptors should be an array');
  assert.ok(descriptors.length > 0, 'should have at least one descriptor group');
  
  const infoGroup = descriptors.find(d => d.label === 'Status');
  assert.ok(infoGroup, 'should have a Status group');
  const paraProp = infoGroup.properties.find(p => p.key === 'para-index');
  assert.strictEqual(paraProp.value, 1, 'paragraph index should be 1-based');
});
