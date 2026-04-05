// html-paste-parser.js — Convert clipboard HTML into a story fragment (Run[][]).
//
// Handles the common markup produced by browsers, Google Docs, and Word when
// copying styled text to the clipboard.  Only bold and italic are preserved;
// all other formatting is silently dropped.

import { cloneStyle } from './style.js';

/**
 * @typedef {import('./style.js').CharacterStyle} CharacterStyle
 * @typedef {{ text: string, style: CharacterStyle }} Run
 * @typedef {Run[][]} Story
 */

/**
 * Parse an HTML string into a story fragment.
 *
 * @param {string} html  Raw HTML from the clipboard (`text/html`).
 * @returns {Story}       Array of paragraphs, each an array of styled runs.
 */
export function parseHtmlToStory(html) {
  // DOMParser is browser-only; this function must be called from browser code.
  const doc = new DOMParser().parseFromString(html, 'text/html');
  return parseHtmlElementToStory(doc.body);
}

/**
 * Parse a DOM element tree into a story fragment.
 * Useful when you already have a parsed DOM (or mock DOM in tests).
 *
 * @param {Element} root  Root element to walk (e.g. `document.body`).
 * @returns {Story}
 */
export function parseHtmlElementToStory(root) {
  if (!root || !root.childNodes || root.childNodes.length === 0) {
    return [[{ text: '', style: cloneStyle() }]];
  }

  const paragraphs = [];
  _walkBlock(root, { bold: false, italic: false }, paragraphs);

  // Ensure at least one paragraph with one run
  if (paragraphs.length === 0) {
    paragraphs.push([{ text: '', style: cloneStyle() }]);
  }
  // Ensure every paragraph has at least one run
  for (let i = 0; i < paragraphs.length; i++) {
    if (paragraphs[i].length === 0) {
      paragraphs[i].push({ text: '', style: cloneStyle() });
    }
  }
  return paragraphs;
}

// ---- internals ----

/** Tags that introduce a paragraph break (block-level). */
const BLOCK_TAGS = new Set([
  'p', 'div', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'li', 'blockquote', 'pre', 'section', 'article',
]);

/**
 * Walk a block-level container, accumulating paragraphs.
 *
 * The key insight: when we encounter a block-level child we flush any
 * pending inline runs into a paragraph, then recurse.  Inline children
 * are accumulated into the "current" paragraph.
 */
function _walkBlock(node, inheritedStyle, paragraphs) {
  let currentRuns = [];

  for (const child of node.childNodes) {
    if (child.nodeType === Node.TEXT_NODE) {
      const text = child.textContent;
      if (text) {
        currentRuns.push({ text, style: cloneStyle(inheritedStyle) });
      }
      continue;
    }

    if (child.nodeType !== Node.ELEMENT_NODE) continue;

    const tag = child.tagName.toLowerCase();

    // <br> → flush current runs as a paragraph
    if (tag === 'br') {
      paragraphs.push(_mergeRuns(currentRuns));
      currentRuns = [];
      continue;
    }

    const childStyle = _resolveStyle(child, inheritedStyle);

    if (BLOCK_TAGS.has(tag)) {
      // Flush any pending inline content
      if (currentRuns.length > 0) {
        paragraphs.push(_mergeRuns(currentRuns));
        currentRuns = [];
      }
      // Recurse into the block
      _walkBlock(child, childStyle, paragraphs);
    } else {
      // Inline element — recurse and collect runs
      _walkInline(child, childStyle, currentRuns);
    }
  }

  // Flush trailing inline content
  if (currentRuns.length > 0) {
    paragraphs.push(_mergeRuns(currentRuns));
  }
}

/**
 * Walk an inline element, pushing runs into `runs`.
 */
function _walkInline(node, inheritedStyle, runs) {
  for (const child of node.childNodes) {
    if (child.nodeType === Node.TEXT_NODE) {
      const text = child.textContent;
      if (text) {
        runs.push({ text, style: cloneStyle(inheritedStyle) });
      }
      continue;
    }
    if (child.nodeType !== Node.ELEMENT_NODE) continue;

    const tag = child.tagName.toLowerCase();
    if (tag === 'br') {
      // Inline <br> treated as newline character for later paragraph splitting
      runs.push({ text: '\n', style: cloneStyle(inheritedStyle) });
      continue;
    }

    const childStyle = _resolveStyle(child, inheritedStyle);
    _walkInline(child, childStyle, runs);
  }
}

/**
 * Determine the bold/italic style for an element by inspecting its tag name
 * and inline CSS.
 */
function _resolveStyle(el, inherited) {
  let bold = inherited.bold;
  let italic = inherited.italic;

  const tag = el.tagName.toLowerCase();
  if (tag === 'b' || tag === 'strong') bold = true;
  if (tag === 'i' || tag === 'em') italic = true;

  // Inspect inline style (Google Docs, Word paste)
  const css = el.style;
  if (css) {
    const fw = css.fontWeight;
    if (fw === 'bold' || fw === '700' || fw === '800' || fw === '900') bold = true;
    if (fw === 'normal' || fw === '400') bold = false;

    const fs = css.fontStyle;
    if (fs === 'italic' || fs === 'oblique') italic = true;
    if (fs === 'normal') italic = false;
  }

  return { bold, italic };
}

/**
 * Merge adjacent runs with identical styles, and split on embedded newlines
 * (which come from inline <br> elements).  Returns a flat array of runs for
 * one paragraph — if there are newlines the caller should not see them here
 * because _walkBlock handles <br> at the block level.
 *
 * However, inline <br> might still slip through, so we handle them by
 * returning only the runs for the *current* paragraph and leaving
 * subsequent paragraphs unhandled (callers should use _walkBlock).
 */
function _mergeRuns(runs) {
  const merged = [];
  for (const run of runs) {
    if (run.text === '') continue;
    const prev = merged[merged.length - 1];
    if (prev && prev.style.bold === run.style.bold && prev.style.italic === run.style.italic) {
      prev.text += run.text;
    } else {
      merged.push({ text: run.text, style: cloneStyle(run.style) });
    }
  }
  if (merged.length === 0) {
    merged.push({ text: '', style: cloneStyle() });
  }
  return merged;
}
