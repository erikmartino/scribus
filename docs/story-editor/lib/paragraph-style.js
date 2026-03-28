// paragraph-style.js - paragraph-level style value helpers

/**
 * Paragraph-level style (block style on a paragraph).
 * @typedef {{
 *   firstLineScale?: number,
 *   fontSize?: number|null,
 *   [key: string]: unknown,
 * }} ParagraphStyle
 */

export const DEFAULT_PARAGRAPH_STYLE = Object.freeze({
  firstLineScale: 1,
  fontSize: null,
});

/**
 * Clone a paragraph style object with defaults applied.
 * @param {ParagraphStyle} [style]
 * @returns {ParagraphStyle}
 */
export function cloneParagraphStyle(style) {
  return { ...DEFAULT_PARAGRAPH_STYLE, ...(style || {}) };
}
