/**
 * text-property-descriptors.js
 * 
 * Shared logic for creating text-related PropertyGroups.
 * Usable by StoryEditor, SpreadEditor, or any plugin dealing with text.
 */

/**
 * @param {import('./shell-core.js').AppShell} shell
 * @param {import('../../story-editor/lib/editor-state.js').EditorState} editor
 * @param {Object} options
 * @returns {import('./property-descriptors.js').PropertyGroup[]}
 */
export function getTextPropertyDescriptors(shell, editor, options = {}) {
  const typingStyle = editor.getTypingStyle();
  const paraIndex = Math.max(0, Math.min(editor.story.length - 1, editor.cursor.paraIndex));
  const paraStyle = editor.paragraphStyles[paraIndex] || {};

  const typographyGroup = {
    label: 'Typography',
    properties: [
      {
        key: 'font-family',
        label: 'Font',
        type: 'readonly', // For now, since it uses a custom font selector in ribbon
        value: typingStyle.fontFamily || 'EB Garamond'
      },
      {
        key: 'bold',
        label: 'Bold',
        type: 'readonly', // We'll use ribbon for toggles, or we could add 'checkbox' type
        value: typingStyle.bold ? 'Yes' : 'No'
      },
      {
        key: 'italic',
        label: 'Italic',
        type: 'readonly',
        value: typingStyle.italic ? 'Yes' : 'No'
      }
    ]
  };

  const paragraphGroup = {
    label: 'Paragraph',
    properties: [
      {
        key: 'font-size',
        label: 'Size',
        type: 'number',
        value: Math.round(paraStyle.fontSize || 22),
        onChange: (val) => {
          shell.commands.execute(options.fontSizeCommand || 'text.font-size', { fontSize: Number(val) });
        }
      },
      {
        key: 'line-height',
        label: 'Line %',
        type: 'number',
        value: Math.round(options.lineHeight || 140),
        onChange: (val) => {
          shell.commands.execute(options.lineHeightCommand || 'text.line-height', { lineHeight: Number(val) });
        }
      }
    ]
  };

  return [typographyGroup, paragraphGroup];
}
