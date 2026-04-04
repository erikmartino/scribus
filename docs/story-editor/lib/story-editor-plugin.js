import { selection } from '../../app-shell/lib/selection-service.js';
import { AppShell } from '../../app-shell/lib/shell-core.js';
import { AbstractItem } from '../../app-shell/lib/document-model.js';
import { TextTools } from '../../app-shell/lib/text-tools.js';

/**
 * StoryEditorPlugin - Adapts the Story Editor logic to the Scribus App Shell.
 */
export class StoryEditorPlugin {
  constructor(editor, update, initialParagraphStyles, container) {
    this.editor = editor;
    this.update = update;
    this.paragraphStyles = editor.paragraphStyles;
    this.container = container;
    
    // If the editor was initialized without the initial styles, sync them now
    if (this.paragraphStyles.length === 0 && initialParagraphStyles) {
      this.paragraphStyles.push(...initialParagraphStyles);
    }
    
    this._typingGroup = null;
    this._typingTimeout = null;
    this._lastState = this.editor.getState();

    // Initialize state for the ribbon/panels
    this.state = {
      typingStyle: this.editor.getTypingStyle()
    };
  }

  init(shell) {
    this.shell = shell;

    // Register as an AbstractItem for clipboard / multi-selection services
    const storyItem = new AbstractItem('main-story', 'story');
    storyItem.serialize = () => {
      const selectedText = this.editor.getSelectedText();
      const range = this.editor.getSelectionRange();
      if (selectedText && range) {
        return {
          type: 'story',
          data: selectedText,
          story: this.editor.getRichSelection(),
          paragraphStyles: this.paragraphStyles.slice(range.start.paraIndex, range.end.paraIndex + 1).map(s => ({...s}))
        };
      }
      return null;
    };
    this.storyItem = storyItem;

    // Register the story item in the document-model and select it
    this.shell.doc.registerItem(storyItem);

    // Select the story and delay update so Shell can render panels
    setTimeout(() => {
      this.shell.selection.select(storyItem);
      this.update();
    }, 100);
    
    // Listen for rich paste events
    this.shell.addEventListener('paste-received', (e) => this.handlePaste(e.detail));

    // Handle 'cut' deletion (fired by Shell after successful serialization)
    this.shell.addEventListener('cut-executed', () => {
      if (!this.editor.hasSelection()) return;
      this.submitAction('Cut', () => {
        this.editor.replaceSelectionWithText('');
      });
    });

    // Register Commands (Standardized to text.*)
    shell.commands.register({
      id: 'text.bold',
      label: 'Bold',
      icon: '<b>B</b>',
      execute: () => {
        const style = this.editor.getTypingStyle();
        this.submitAction('Toggle Bold', () => {
          this.editor.applyCharacterStyle({ bold: !style.bold });
          this.container.focus();
        });
      }
    });

    shell.commands.register({
      id: 'text.italic',
      label: 'Italic',
      icon: '<i>I</i>',
      execute: () => {
        const style = this.editor.getTypingStyle();
        this.submitAction('Toggle Italic', () => {
          this.editor.applyCharacterStyle({ italic: !style.italic });
          this.container.focus();
        });
      }
    });

    shell.commands.register({
      id: 'text.font-family',
      label: 'Font Family',
      execute: (args) => {
        if (!args || !args.fontFamily) return;
        this.updateTypingStyle({ fontFamily: args.fontFamily });
      }
    });

    shell.commands.register({
      id: 'story.resetLayout',
      label: 'Reset Layout',
      execute: () => {
        this.submitAction('Reset Layout', () => {
          this.editor.reset();
        });
      }
    });
  }

  /**
   * Performs an operation and submits it to history.
   * Handles grouping for consecutive "insertText" operations.
   */
  submitAction(label, fn) {
    const prevState = this.editor.getState();
    const action = {
      label,
      execute: () => {
        fn();
        this.update();
      },
      undo: () => {
         this.editor.setState(prevState);
         this.update();
      }
    };
    this.shell.history.submit(action);
  }

  /**
   * Updates the current typing style and potentially the selection.
   */
  updateTypingStyle(style) {
    this.submitAction('Update Style', () => {
      if (!this.editor.hasSelection()) {
        this.editor.applyCharacterStyleToCurrentParagraph(style);
      } else {
        this.editor.applyCharacterStyle(style);
      }
      // Sync internal state
      this.state.typingStyle = { ...this.state.typingStyle, ...style };
      this.container.focus();
    });
  }

  handlePaste(payload) {
    if (!payload || !payload.items) return;
    
    // 1. Native Story Data (preferred)
    const storyItem = payload.items.find(it => it && it.type === 'story');
    if (storyItem && storyItem.story) {
      this.submitAction('Paste Story', () => {
        this.editor.insertStory(storyItem.story, storyItem.paragraphStyles);
      });
      return;
    }

    // 2. Plain Text / Rich Text Fallbacks
    const textItem = payload.items.find(it => it && (it.type === 'plain-text' || it.type === 'rich-text-fragment'));
    if (textItem) {
      this.submitAction('Paste Text', () => {
        // For rich text, we currently just extract text content for simplicity in this demo
        const raw = textItem.data;
        const text = textItem.type === 'rich-text-fragment' 
          ? raw.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ') 
          : raw;
        
        if (this.editor.hasSelection()) {
          this.editor.replaceSelectionWithText(text);
        } else {
          this.editor.applyOperation('insertText', { text });
        }
      });
    }
  }

  getRibbonSections() {
    return [
      TextTools.createTypographySection(this.shell, {
        fontFamily: this.state.typingStyle.fontFamily || 'EB Garamond'
      })
    ];
  }

  getPanelContent(selected) {
    const container = document.createElement('div');
    container.style.display = 'flex';
    container.style.flexDirection = 'column';
    container.style.gap = '1rem';

    container.innerHTML = `
      <div style="color: var(--text-dim); font-size: 0.85rem;">
        <p>Paragraph: <span id="current-para" style="color: var(--accent);">1</span></p>
        <p>Selection: <span id="selection-status" style="color: var(--accent-secondary);">None</span></p>
      </div>
      <hr style="border: 0; border-top: 1px solid var(--border);">
    `;

    // Add font size input
    const fontSizeInput = this.shell.ui.createInput({
      label: 'Font Size',
      type: 'number',
      min: 8,
      max: 200,
      value: 22,
      id: 'font-size',
      onInput: (val) => {
         this.submitAction('Change Font Size', () => {
           const pi = Math.max(0, Math.min(this.editor.story.length - 1, this.editor.cursor.paraIndex));
           this.paragraphStyles[pi].fontSize = +val;
         });
      }
    });
    container.appendChild(fontSizeInput);

    return container;
  }
}
