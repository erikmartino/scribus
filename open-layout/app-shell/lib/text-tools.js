import { AppShell } from './shell-core.js';

/**
 * Shared utility for creating text formatting ribbon sections.
 * This ensures a consistent UI and logic across different editor types (Story, Spread, etc.)
 */
export const TextTools = {
  /**
   * Creates the standard Typography ribbon section (Font Family, Bold, Italic).
   * @param {AppShell} shell - The AppShell instance.
   * @param {Object} options - Configuration for commands and initial values.
   */
  createTypographySection(shell, { 
    fontFamily = 'EB Garamond',
    bold = false,
    italic = false,
    boldCommand = 'text.bold',
    italicCommand = 'text.italic',
    fontFamilyCommand = 'text.font-family'
  } = {}) {
    return AppShell.createRibbonSection('Typography', (container) => {
      // Font Family Selector
      const fontContainer = document.createElement('div');
      fontContainer.id = 'font-selector-container';
      container.appendChild(fontContainer);

      const selector = shell.ui.createFontSelector({
        label: '',
        value: fontFamily,
        layout: 'horizontal',
        onChange: (font) => shell.commands.execute(fontFamilyCommand, { fontFamily: font }),
        id: 'font-family-selector'
      });
      fontContainer.appendChild(selector);

      // Bold Button
      const boldBtn = shell.ui.createButton({ 
        label: 'B', 
        id: 'toggle-bold',
        commandId: boldCommand,
        active: bold
      });
      container.appendChild(boldBtn);

      // Italic Button
      const italicBtn = shell.ui.createButton({ 
        label: 'I', 
        id: 'toggle-italic',
        commandId: italicCommand,
        active: italic
      });
      container.appendChild(italicBtn);
    });
  },

  /**
   * Creates the standard Formatting ribbon section (Font Size, Line Height).
   * @param {AppShell} shell - The AppShell instance.
   * @param {Object} options - Configuration for inputs and initial values.
   */
  createFormattingSection(shell, {
    fontSize = 20,
    lineHeight = 138,
    fontSizeCommand = 'text.font-size',
    lineHeightCommand = 'text.line-height'
  } = {}) {
    return AppShell.createRibbonSection('Formatting', (container) => {
      const fontSizeInput = shell.ui.createInput({ 
        label: 'Size', 
        type: 'range', 
        min: 12, 
        max: 40, 
        value: fontSize, 
        id: 'font-size',
        onInput: (val) => shell.commands.execute(fontSizeCommand, { fontSize: Number(val) })
      });
      
      const lineHeightInput = shell.ui.createInput({ 
        label: 'Line %', 
        type: 'range', 
        min: 105, 
        max: 190, 
        value: lineHeight, 
        id: 'line-height',
        onInput: (val) => shell.commands.execute(lineHeightCommand, { lineHeight: Number(val) })
      });

      container.appendChild(fontSizeInput);
      container.appendChild(lineHeightInput);
    });
  }
};
