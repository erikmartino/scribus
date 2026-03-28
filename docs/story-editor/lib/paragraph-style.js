// paragraph-style.js - paragraph-level style value helpers

/**
 * Paragraph-level style (block style on a paragraph).
 * @typedef {{
 *   fontSize: number,
 *   [key: string]: unknown,
 * }} ParagraphStyle
 */

export const DEFAULT_PARAGRAPH_STYLE = Object.freeze({
  fontSize: 22,
});

/**
 * Clone a paragraph style object with defaults applied.
 * @param {ParagraphStyle} [style]
 * @returns {ParagraphStyle}
 */
export function cloneParagraphStyle(style) {
  return { ...DEFAULT_PARAGRAPH_STYLE, ...(style || {}) };
}
