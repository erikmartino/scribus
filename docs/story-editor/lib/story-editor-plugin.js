import { selection } from '../../app-shell/lib/selection-service.js';
import { AppShell } from '../../app-shell/lib/shell-core.js';
import { AbstractItem } from '../../app-shell/lib/document-model.js';

/**
 * StoryEditorPlugin - Adapts the Story Editor logic to the Scribus App Shell.
 */
export class StoryEditorPlugin {
  constructor(editor, updateCallback, paragraphStyles) {
    this.editor = editor;
    this.update = updateCallback;
    this.paragraphStyles = paragraphStyles;
    
    this._typingGroup = null;
    this._typingTimeout = null;
  }

  init(shell) {
    this.shell = shell;

    // Register as an AbstractItem for clipboard / multi-selection services
    const storyItem = new AbstractItem('main-story', 'story');
    storyItem.export = () => ({
      type: 'story',
      story: this.editor.story,
      styles: this.paragraphStyles
    });
    
    // Register the story item in the document-model
    this.shell.doc.registerItem(storyItem);
    
    // Listen for rich paste events
    this.shell.addEventListener('paste-received', (e) => this.handlePaste(e.detail));

    // Register Commands
    shell.commands.register({
      id: 'story.bold',
      label: 'Bold',
      icon: '<b>B</b>',
      execute: () => {
        const style = this.editor.getTypingStyle();
        this.submitAction('Toggle Bold', () => {
          this.editor.applyCharacterStyle({ bold: !style.bold });
        });
      }
    });

    shell.commands.register({
      id: 'story.italic',
      label: 'Italic',
      icon: '<i>I</i>',
      execute: () => {
        const style = this.editor.getTypingStyle();
        this.submitAction('Toggle Italic', () => {
          this.editor.applyCharacterStyle({ italic: !style.italic });
        });
      }
    });

    shell.commands.register({
      id: 'story.resetLayout',
      label: 'Reset Layout',
      execute: () => {
        this.submitAction('Reset Layout', () => {
          const boxWidthInput = document.getElementById('box-width');
          const lineHeightInput = document.getElementById('line-height');
          if (boxWidthInput) boxWidthInput.value = 1040;
          if (lineHeightInput) lineHeightInput.value = 140;
        });
      }
    });
  }

  /**
   * Performs an operation and submits it to history.
   * Handles grouping for consecutive "insertText" operations.
   */
  submitAction(label, transform, opType = 'generic') {
    const beforeState = this.editor.getState();
    const beforeStyles = JSON.parse(JSON.stringify(this.paragraphStyles));
    
    transform();
    
    const afterState = this.editor.getState();
    const afterStyles = JSON.parse(JSON.stringify(this.paragraphStyles));

    // Grouping logic for typing
    if (opType === 'insertText' && this._typingGroup) {
      this._typingGroup.after = afterState;
      this._typingGroup.afterStyles = afterStyles;
      clearTimeout(this._typingTimeout);
      this._typingTimeout = setTimeout(() => { this._typingGroup = null; }, 1000);
      this.update();
      return;
    }

    const action = {
      label,
      before: beforeState,
      beforeStyles,
      after: afterState,
      afterStyles,
      execute: () => {
        this.editor.setState(action.after);
        // Replace styles contents rather than the reference if possible, 
        // but since it's an array we can just splice if needed or just reassign if we own the ref.
        // The common way in these demos is to just reassign the array content.
        this.paragraphStyles.length = 0;
        this.paragraphStyles.push(...action.afterStyles);
        this.update();
      },
      undo: () => {
        this.editor.setState(action.before);
        this.paragraphStyles.length = 0;
        this.paragraphStyles.push(...action.beforeStyles);
        this.update();
      }
    };

    if (opType === 'insertText') {
      this._typingGroup = action;
      this._typingTimeout = setTimeout(() => { this._typingGroup = null; }, 1000);
    } else {
      this._typingGroup = null;
    }

    this.shell.history.submit(action);
    this.update();
  }

  handlePaste(payload) {
    // Look for story data in items
    const storyItem = payload.items.find(it => it.type === 'story');
    if (storyItem) {
      this.submitAction('Paste Story', () => {
         // Simplest implementation: replace what's selected with the pasted story text
         // or if it's matching the whole shell, maybe merge?
         // For now, let's just insert as text.
         const text = storyItem.story.map(p => p.map(r => r.text).join('')).join('\n');
         this.editor.replaceSelectionWithText(text);
      });
    }
  }

  getRibbonSections() {
    return [
      AppShell.createRibbonSection('Story Editor', (container) => {
        // Status indicator
        const status = document.createElement('div');
        status.style.fontSize = '0.75rem';
        status.style.padding = '4px 8px';
        status.style.background = 'rgba(0,255,100,0.1)';
        status.style.color = 'var(--accent-secondary)';
        status.style.borderRadius = '4px';
        status.textContent = 'Ready';
        container.appendChild(status);
      }),

      AppShell.createRibbonSection('Font', (container) => {
        // Font Family Select
        const select = document.createElement('select');
        select.id = 'font-family';
        select.style.background = 'rgba(255,255,255,0.05)';
        select.style.border = '1px solid var(--border)';
        select.style.color = 'var(--text-main)';
        select.style.padding = '4px 8px';
        select.style.borderRadius = '6px';
        select.style.outline = 'none';
        
        const defaultOpt = document.createElement('option');
        defaultOpt.value = 'EB Garamond';
        defaultOpt.textContent = 'EB Garamond';
        select.appendChild(defaultOpt);

        select.onchange = () => {
          this.submitAction('Change Font', () => {
            const pi = Math.max(0, Math.min(this.editor.story.length - 1, this.editor.cursor.paraIndex));
            this.paragraphStyles[pi].fontFamily = select.value;
          });
        };

        // Populate from font manager if available
        const fm = this.shell.element?.querySelector('scribus-app-shell')?.workspace?.querySelector('#svg-container')?.__layoutEngine?._fontRegistry?._fontManager;
        // Wait, better yet, the main script in index.html can pass the engine.
        // For now let's just use the select ID if we want to populate it later.
        
        container.appendChild(select);

        container.appendChild(this.shell.ui.createButton({
          commandId: 'story.bold',
          id: 'toggle-bold'
        }));
        
        container.appendChild(this.shell.ui.createButton({
          commandId: 'story.italic',
          id: 'toggle-italic'
        }));
      }),
      
      AppShell.createRibbonSection('Typography', (container) => {
        container.appendChild(this.shell.ui.createInput({
          label: 'Width',
          type: 'range',
          min: 400,
          max: 1400,
          value: 1040,
          id: 'box-width',
          onInput: (val) => this.update()
        }));
        
        container.appendChild(this.shell.ui.createInput({
          label: 'Line Height %',
          type: 'range',
          min: 100,
          max: 250,
          value: 140,
          id: 'line-height',
          onInput: (val) => this.update()
        }));
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
