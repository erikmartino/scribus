// justifier.js — compute justified word positions from a line's glyphs

import { SHY } from './line-breaker.js';

/**
 * @typedef {import('./text-extract.js').Style} Style
 * @typedef {import('./line-breaker.js').Line} Line
 */

/**
 * A styled text fragment within a word.
 * @typedef {object} Fragment
 * @property {string} text  — visible text (soft hyphens stripped; trailing '-' added if hyphenated)
 * @property {Style}  style — character style
 */

/**
 * A positioned word with its styled fragments.
 * @typedef {object} Word
 * @property {Fragment[]} fragments — one or more styled fragments composing the word
 * @property {number}     width     — total advance width of the word
 * @property {number}     x         — left-edge x offset within the line's available width
 */

/**
 * Extract words from a line's glyphs and compute justified x positions.
 *
 * @param {Line} line
 * @param {string} text — full paragraph text
 * @param {number} innerWidth — available width for text
 * @param {number} hyphenAdvance — width of a hyphen glyph
 * @param {boolean} isLastLine — last line of paragraph (left-aligned, not justified)
 * @returns {Word[]}
 */
export function justifyLine(line, text, innerWidth, hyphenAdvance, isLastLine) {
  const words = [];
  let curWord = { fragments: [], width: 0 };
  let fragStart = -1;
  let fragStyle = null;
  let spaceWidth = 0;

  function flushFrag(endCl) {
    if (fragStart >= 0 && fragStyle) {
      let ft = text.slice(fragStart, endCl).replace(/\u00AD/g, '');
      if (ft) curWord.fragments.push({ text: ft, style: fragStyle });
      fragStart = -1;
      fragStyle = null;
    }
  }

  function flushWord() {
    if (curWord.fragments.length > 0 || curWord.width > 0) {
      words.push(curWord);
      curWord = { fragments: [], width: 0 };
    }
  }

  for (let gi = 0; gi < line.glyphs.length; gi++) {
    const g = line.glyphs[gi];
    const ch = text[g.cl];
    if (ch === ' ') {
      flushFrag(g.cl);
      flushWord();
      spaceWidth += g.ax;
    } else if (ch === SHY) {
      curWord.width += g.ax;
    } else {
      if (fragStyle && (g.style.bold !== fragStyle.bold || g.style.italic !== fragStyle.italic)) {
        flushFrag(g.cl);
      }
      if (fragStart < 0) {
        fragStart = g.cl;
        fragStyle = g.style;
      }
      curWord.width += g.ax;
    }
  }

  flushFrag(line.endChar);
  if (line.hyphenated && curWord.fragments.length > 0) {
    const last = curWord.fragments[curWord.fragments.length - 1];
    last.text += '-';
    curWord.width += hyphenAdvance;
  }
  flushWord();

  // Compute gap width
  const totalWordWidth = words.reduce((s, w) => s + w.width, 0);
  const gaps = words.length - 1;
  let gapWidth;
  if (!isLastLine && gaps > 0) {
    gapWidth = (innerWidth - totalWordWidth) / gaps;
  } else {
    gapWidth = gaps > 0 ? spaceWidth / gaps : 0;
  }

  // Assign x positions
  let x = 0;
  for (const word of words) {
    word.x = x;
    x += word.width + gapWidth;
  }

  return words;
}
