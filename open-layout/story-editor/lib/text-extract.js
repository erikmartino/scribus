// text-extract.js — DOM tree -> style runs

import { cloneStyle } from './style.js';

/**
 * @typedef {import('./style.js').CharacterStyle} CharacterStyle
 * @typedef {{ text: string, style: CharacterStyle }} Run
 * @typedef {Run[][]} Story
 */

/**
 * Style tags recognized at the character-style level.
 * Every text node inside a <p> must be inside one of these.
 */
const STYLE_TAGS = {
  'n':      {},
  'b':      { bold: true },
  'strong': { bold: true },
  'i':      { italic: true },
  'em':     { italic: true },
  'bi':     { bold: true, italic: true },
};

/**
 * Walk a DOM element and extract an array of style runs.
 * Only text nodes inside recognized style tags are extracted;
 * whitespace-only text nodes directly under <p> are ignored.
 * @param {Element} element
 * @returns {Run[]}
 */
export function extractRuns(element) {
  const runs = [];
  const isStyleTag = element.tagName.toLowerCase() in STYLE_TAGS;

  for (const node of element.childNodes) {
    if (node.nodeType === Node.TEXT_NODE) {
      // Only extract text when parent is a style tag.
      // Text nodes directly under <p> are inter-tag whitespace — ignore them.
      if (isStyleTag) {
          const text = node.textContent;
          if (text) {
          const style = STYLE_TAGS[element.tagName.toLowerCase()];
          runs.push({ text, style: cloneStyle(style) });
          }
        }
    } else if (node.nodeType === Node.ELEMENT_NODE) {
      const tag = node.tagName.toLowerCase();
      if (tag in STYLE_TAGS) {
        runs.push(...extractRuns(node));
      }
    }
  }
  return runs;
}

/**
 * Extract paragraphs from a container: each <p> yields an array of runs.
 * @param {Element} container
 * @returns {Story}
 */
export function extractParagraphs(container) {
  const paragraphs = [];
  for (const el of container.children) {
    if (el.tagName.toLowerCase() === 'p') {
      paragraphs.push(extractRuns(el));
    }
  }
  return paragraphs;
}
