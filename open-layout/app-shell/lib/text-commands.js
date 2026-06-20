/**
 * text-commands.js - Shared text formatting commands for Scribus editors.
 */

/**
 * Register standard text commands on the shell.
 * 
 * @param {import('./shell-core.js').AppShell} shell
 * @param {Object} context - { getEditor, submitAction }
 */
export function registerTextCommands(shell, context) {
  const { getEditor, submitAction } = context;
  shell.commands.register({
    id: 'text.bold',
    label: 'Bold',
    execute: () => {
      const editor = getEditor();
      if (!editor) return;
      const style = editor.getTypingStyle();
      submitAction('Toggle Bold', () => {
        editor.applyCharacterStyle({ bold: !style.bold });
      });
    }
  });

  shell.commands.register({
    id: 'text.italic',
    label: 'Italic',
    execute: () => {
      const editor = getEditor();
      if (!editor) return;
      const style = editor.getTypingStyle();
      submitAction('Toggle Italic', () => {
        editor.applyCharacterStyle({ italic: !style.italic });
      });
    }
  });

  shell.commands.register({
    id: 'text.font-family',
    label: 'Font Family',
    execute: (args) => {
      const editor = getEditor();
      if (!editor || !args?.fontFamily) return;
      submitAction('Change Font', () => {
        if (!editor.hasSelection()) {
          editor.applyCharacterStyleToCurrentParagraph({ fontFamily: args.fontFamily });
        } else {
          editor.applyCharacterStyle({ fontFamily: args.fontFamily });
        }
      });
    }
  });

  shell.commands.register({
    id: 'text.font-size',
    label: 'Font Size',
    execute: (args) => {
      const editor = getEditor();
      if (!editor || !args?.fontSize) return;
      const size = Number(args.fontSize);
      submitAction('Change Font Size', () => {
        if (context.applyFontSize) {
          context.applyFontSize(size);
        } else {
          if (!editor.hasSelection()) {
             // Fallback to paragraph style if editor has it
             const pi = editor.cursor.paraIndex;
             if (editor.paragraphStyles && editor.paragraphStyles[pi]) {
               editor.paragraphStyles[pi].fontSize = size;
             }
             editor.applyCharacterStyleToCurrentParagraph({ fontSize: size });
          } else {
             if (editor.paragraphStyles) {
               const range = editor.getSelectionRange();
               for (let pi = range.start.paraIndex; pi <= range.end.paraIndex; pi++) {
                 if (editor.paragraphStyles[pi]) {
                   editor.paragraphStyles[pi].fontSize = size;
                 }
               }
             }
             editor.applyCharacterStyle({ fontSize: size });
          }
        }
      });
    }
  });

  shell.commands.register({
    id: 'text.line-height',
    label: 'Line Height',
    execute: (args) => {
      const editor = getEditor();
      if (!editor || !args?.lineHeight) return;
      const lh = Number(args.lineHeight);
      submitAction('Change Line Height', () => {
        if (context.applyLineHeight) {
          context.applyLineHeight(lh);
        } else {
            // Default: dispatch event or update paragraph style if exists
            if (editor.paragraphStyles) {
               const range = editor.getSelectionRange();
               if (range) {
                 for (let pi = range.start.paraIndex; pi <= range.end.paraIndex; pi++) {
                   if (editor.paragraphStyles[pi]) {
                     editor.paragraphStyles[pi].lineHeight = lh;
                   }
                 }
               } else {
                 const pi = editor.cursor.paraIndex;
                 if (editor.paragraphStyles[pi]) editor.paragraphStyles[pi].lineHeight = lh;
               }
            }
            window.dispatchEvent(new CustomEvent('line-height-changed', { detail: lh }));
        }
      });
    }
  });
}
