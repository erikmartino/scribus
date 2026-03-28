// line-breaker.js — greedy line breaking with hyphenation support

/** @typedef {import('./shaper.js').Glyph} Glyph */

/**
 * A single broken line produced by the line breaker.
 * @typedef {object} Line
 * @property {number}  startChar  — character offset of the first glyph in paragraph text
 * @property {number}  endChar    — character offset one past the last character on this line
 * @property {Glyph[]} glyphs     — shaped glyphs belonging to this line
 * @property {number}  width      — total advance width of glyphs (plus hyphen if applicable)
 * @property {boolean} hyphenated — true if the line ends with a soft-hyphen break
 */

export const SHY = '\u00AD';

/**
 * Break shaped glyphs into lines using a greedy algorithm.
 * @param {Glyph[]} shapedGlyphs
 * @param {string} text — the full paragraph text
 * @param {number} maxWidth
 * @param {number} hyphenAdvance — width of a hyphen glyph
 * @returns {Line[]}
 */
export function breakLines(shapedGlyphs, text, maxWidth, hyphenAdvance) {
  const lines = [];
  let lineGlyphs = [];
  let lineWidth = 0;
  let lastBreak = null;

  for (let i = 0; i < shapedGlyphs.length; i++) {
    const g = shapedGlyphs[i];
    const ch = text[g.cl];

    if (ch === ' ') {
      lastBreak = { glyphIdx: i, localIdx: lineGlyphs.length, width: lineWidth, type: 'space' };
    } else if (ch === SHY) {
      lastBreak = { glyphIdx: i, localIdx: lineGlyphs.length, width: lineWidth + hyphenAdvance, type: 'shy' };
    }

    lineWidth += g.ax;
    lineGlyphs.push(g);

    if (lineWidth > maxWidth && lastBreak) {
      const { localIdx, type } = lastBreak;
      const kept = lineGlyphs.slice(0, localIdx);
      const breakCl = shapedGlyphs[lastBreak.glyphIdx].cl;

      lines.push({
        startChar: kept.length > 0 ? kept[0].cl : breakCl,
        endChar: breakCl,
        glyphs: kept,
        width: lastBreak.width,
        hyphenated: type === 'shy',
      });

      lineGlyphs = lineGlyphs.slice(localIdx + 1);
      lineWidth = lineGlyphs.reduce((s, g2) => s + g2.ax, 0);
      lastBreak = null;
    }
  }

  if (lineGlyphs.length > 0) {
    lines.push({
      startChar: lineGlyphs[0].cl,
      endChar: text.length,
      glyphs: lineGlyphs,
      width: lineWidth,
      hyphenated: false,
    });
  }

  return lines;
}
