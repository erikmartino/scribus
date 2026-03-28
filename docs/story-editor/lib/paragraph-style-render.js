// paragraph-style-render.js - paragraph style extraction and layout helpers

import { cloneParagraphStyle } from './paragraph-style.js';

export const PARAGRAPH_STYLE_PRESETS = Object.freeze({
  normal: Object.freeze({ fontSizeOffset: 0 }),
  lead: Object.freeze({ fontSizeOffset: 8 }),
});

/**
 * @param {string} [name]
 * @param {number} [baseFontSize]
 * @returns {import('./paragraph-style.js').ParagraphStyle}
 */
export function defaultParagraphStyle(name = 'normal', baseFontSize = 22) {
  const preset = PARAGRAPH_STYLE_PRESETS[name] || PARAGRAPH_STYLE_PRESETS.normal;
  return cloneParagraphStyle({
    fontSize: Math.max(1, baseFontSize + preset.fontSizeOffset),
  });
}

/**
 * @param {Element} container
 * @param {number} [baseFontSize]
 * @returns {import('./paragraph-style.js').ParagraphStyle[]}
 */
export function extractParagraphStyles(container, baseFontSize = 22) {
  const styles = [];
  for (const el of container.children) {
    if (el.tagName.toLowerCase() !== 'p') continue;
    const name = el.getAttribute('data-pstyle') || 'normal';
    styles.push(defaultParagraphStyle(name, baseFontSize));
  }
  return styles;
}

/**
 * @param {import('./paragraph-style.js').ParagraphStyle[]} paragraphStyles
 * @param {number} paragraphCount
 * @param {number} [baseFontSize]
 */
export function ensureParagraphStylesLength(paragraphStyles, paragraphCount, baseFontSize = 22) {
  while (paragraphStyles.length < paragraphCount) {
    paragraphStyles.push(defaultParagraphStyle('normal', baseFontSize));
  }
  if (paragraphStyles.length > paragraphCount) {
    paragraphStyles.length = paragraphCount;
  }
}

/**
 * @param {number} baseFontSize
 * @param {import('./paragraph-style.js').ParagraphStyle[]} paragraphStyles
 * @returns {{ fontSize: number, fontFamily: string }[]}
 */
export function buildParagraphLayoutStyles(baseFontSize, paragraphStyles) {
  void baseFontSize;
  return paragraphStyles.map((style) => ({
    fontSize: style.fontSize,
    fontFamily: style.fontFamily,
  }));
}
