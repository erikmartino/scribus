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
  }
};
