import { selection } from '../../app-shell/lib/selection-service.js';
import { AppShell } from '../../app-shell/lib/shell-core.js';
import { AbstractItem } from '../../app-shell/lib/document-model.js';
import { TextTools } from '../../app-shell/lib/text-tools.js';
import { parseHtmlToStory } from './html-paste-parser.js';
import { serializeStory, putJson, updateDocTimestamp } from '../../document-store/lib/document-store.js';
import { getTextPropertyDescriptors } from '../../app-shell/lib/text-property-descriptors.js';

/**
 * StoryEditorPlugin - Adapts the Story Editor logic to the Scribus App Shell.
 */
export class StoryEditorPlugin {
  /**
   * @param {EditorState} editor
   * @param {Function} update
   * @param {Array} initialParagraphStyles
   * @param {HTMLElement} container
   * @param {object} [storeContext] - { docPath, storyId } when loaded from store
   */
  constructor(editor, update, initialParagraphStyles, container, storeContext) {
    this.editor = editor;
    this.update = update;
    this.paragraphStyles = editor.paragraphStyles;
    this.container = container;
    
    // Store context for save-back
    this._docPath = storeContext?.docPath || null;
    this._storyId = storeContext?.storyId || null;
    this._saving = false;

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
      id: 'text.font-size',
      label: 'Font Size',
      execute: (args) => {
        if (!args || !args.fontSize) return;
        this.submitAction('Change Font Size', () => {
          const pi = Math.max(0, Math.min(this.editor.story.length - 1, this.editor.cursor.paraIndex));
          this.paragraphStyles[pi].fontSize = Number(args.fontSize);
          this.container.focus();
        });
      }
    });

    shell.commands.register({
      id: 'text.line-height',
      label: 'Line Height',
      execute: (args) => {
        if (!args || !args.lineHeight) return;
        this.submitAction('Change Line Height', () => {
          // In this simple demo, we store global line height for the whole story
          // but we could make it per-paragraph. For now we just trigger update.
          window.dispatchEvent(new CustomEvent('line-height-changed', { detail: args.lineHeight }));
          this.container.focus();
        });
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

    // Save command — only available when loaded from the store
    shell.commands.register({
      id: 'doc.save',
      label: 'Save',
      icon: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"></path>
        <polyline points="17 21 17 13 7 13 7 21"></polyline>
        <polyline points="7 3 7 8 15 8"></polyline>
      </svg>`,
      execute: () => this._save(),
      isEnabled: () => !!this._docPath && !this._saving,
      shortcut: 'Ctrl+S',
    });

    // Intercept Ctrl+S to prevent browser Save dialog
    window.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        if (this._docPath && !this._saving) {
          shell.commands.execute('doc.save');
        }
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

  async handlePaste(payload) {
    if (!payload || !payload.items) return;

    // 1. Image paste — insert inline image placeholder
    const imageItem = payload.items.find(it => it && it.type === 'image');
    if (imageItem) {
      const dataUrl = await this._blobToDataUrl(imageItem.data);
      this.submitAction('Paste Inline Image', () => {
        const run = { text: '\uFFFC', style: { bold: false, italic: false, inlineImage: dataUrl } };
        this.editor.insertStory([[run]]);
      });
      return;
    }

    // 2. Native Story Data (preferred)
    const storyItem = payload.items.find(it => it && it.type === 'story');
    if (storyItem && storyItem.story) {
      this.submitAction('Paste Story', () => {
        this.editor.insertStory(storyItem.story, storyItem.paragraphStyles);
      });
      return;
    }

    // 3. Rich text (HTML from external sources)
    const htmlItem = payload.items.find(it => it && it.type === 'text/html');
    if (htmlItem) {
      const story = parseHtmlToStory(htmlItem.data);
      if (story.length > 0) {
        this.submitAction('Paste Rich Text', () => {
          this.editor.insertStory(story);
        });
        return;
      }
    }

    // 4. Plain Text fallback
    const textItem = payload.items.find(it => it && (it.type === 'plain-text' || it.type === 'rich-text-fragment'));
    if (textItem) {
      this.submitAction('Paste Text', () => {
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

  /** Convert a Blob or File to a data URL string. */
  _blobToDataUrl(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(blob);
    });
  }

  async _save() {
    if (!this._docPath || !this._storyId || this._saving) return;

    this._saving = true;
    const statusEl = document.getElementById('status');
    if (statusEl) statusEl.setText('Saving...', '');
    this.shell?.requestUpdate();
    try {
      const json = serializeStory(this._storyId, this.editor);
      const res = await putJson(
        `/store/${this._docPath}/stories/${this._storyId}.json`,
        json
      );
      if (!res.ok) throw new Error(`PUT failed: ${res.status}`);

      await updateDocTimestamp(this._docPath);
      if (statusEl) statusEl.setText('Saved.', 'ok');
    } catch (err) {
      if (statusEl) statusEl.setText(`Save failed: ${err.message}`, 'error');
      console.error('Save failed:', err);
    } finally {
      this._saving = false;
      this.shell?.requestUpdate();
    }
  }

  getRibbonSections() {
    const sections = [];

    // Document section (Save button) — only when loaded from store
    if (this._docPath) {
      sections.push(AppShell.createRibbonSection('Document', (container) => {
        container.appendChild(this.shell.ui.createButton({
          commandId: 'doc.save',
        }));
      }));
    }

    sections.push(
      TextTools.createTypographySection(this.shell, {
        fontFamily: this.state.typingStyle.fontFamily || 'EB Garamond',
        bold: !!this.state.typingStyle.bold,
        italic: !!this.state.typingStyle.italic
      })
    );

    const pi = this.editor.cursor.paraIndex;
    const paraStyle = this.paragraphStyles[pi] || {};
    sections.push(
      TextTools.createFormattingSection(this.shell, {
        fontSize: paraStyle.fontSize || this.state.typingStyle.fontSize || 20,
        lineHeight: 138 // Fixed in this demo for now
      })
    );

    return sections;
  }

  getPanelDescriptors(selected) {
    const descriptors = [];

    // 1. Info Group
    descriptors.push({
      label: 'Status',
      properties: [
        {
          key: 'para-index',
          label: 'Paragraph',
          type: 'readonly',
          value: this.editor.cursor.paraIndex + 1
        },
        {
          key: 'selection',
          label: 'Selection',
          type: 'readonly',
          value: this.editor.hasSelection() ? 'Active' : 'None'
        }
      ]
    });

    // 2. Text Groups (Typography, Paragraph)
    const textGroups = getTextPropertyDescriptors(this.shell, this.editor);
    descriptors.push(...textGroups);

    return descriptors;
  }
}
