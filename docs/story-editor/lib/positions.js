// positions.js — build cursor positions from layout data (no DOM dependencies)

/**
 * @typedef {import('./shaper.js').Glyph} Glyph
 * @typedef {import('./justifier.js').Word} Word
 */

/**
 * A cursor position mapping an original-text character offset to a pixel x coordinate.
 * @typedef {object} CursorPosition
 * @property {number} charPos — character offset in the original (un-hyphenated) paragraph text
 * @property {number} x       — pixel x coordinate on the SVG canvas
 */

/**
 * A line entry produced by layout, carrying everything needed for cursor positioning.
 * @typedef {object} LineEntry
 * @property {Word[]}   words         — justified words with x offsets
 * @property {Glyph[]}  glyphs        — raw shaped glyphs for this line
 * @property {string}   text          — full hyphenated paragraph text
 * @property {number[]} hyphToOrig    — mapping from hyphenated-text index to original-text index
 * @property {number}   origLen       — length of the original (un-hyphenated) paragraph text
 * @property {boolean}  isLastInPara  — true if this is the last line of its paragraph
 * @property {boolean}  hyphenated    — true if the line ends with a soft-hyphen break
 * @property {number}   hyphenAdvance — width of a hyphen glyph
 * @property {number}   startChar     — start character offset in hyphenated text
 * @property {number}   endChar       — end character offset in hyphenated text
 * @property {number}   paraIndex     — index of the paragraph in the story
 */

const SHY = '\u00AD';

/**
 * Merge consecutive glyphs that share the same cluster index (cl).
 * HarfBuzz emits multiple glyphs per ligature cluster — the first carries
 * the advance, the rest have ax=0. Merging sums the advances into one entry.
 * @param {Glyph[]} rawGlyphs
 * @returns {Glyph[]}
 */
export function mergeLigatureClusters(rawGlyphs) {
  const merged = [];
  for (const g of rawGlyphs) {
    const prev = merged.length > 0 ? merged[merged.length - 1] : null;
    if (prev && prev.cl === g.cl) {
      prev.ax += g.ax;
    } else {
      merged.push({ ...g });
    }
  }
  return merged;
}

/**
 * Split a merged glyph array into word groups separated by space glyphs.
 * Each group is { glyphs, endCl, spaceGlyph }.
 * @param {Glyph[]} glyphs
 * @param {string} text — full hyphenated paragraph text
 * @param {number} lineEndChar — end character offset of the line
 * @returns {{ glyphs: Glyph[], endCl: number, spaceGlyph: Glyph|null }[]}
 */
export function splitGlyphsIntoWords(glyphs, text, lineEndChar) {
  const wordGroups = [];
  let i = 0;
  while (i < glyphs.length) {
    const start = i;
    while (i < glyphs.length && text[glyphs[i].cl] !== ' ') i++;
    const wordGlyphs = glyphs.slice(start, i);
    const endCl = i < glyphs.length ? glyphs[i].cl : lineEndChar;
    const spaceGlyph = (i < glyphs.length && text[glyphs[i].cl] === ' ') ? glyphs[i++] : null;
    wordGroups.push({ glyphs: wordGlyphs, endCl, spaceGlyph });
  }
  return wordGroups;
}

/**
 * For a single glyph, resolve its cluster span to original-text character
 * positions, filtering out zero-width characters (soft hyphens).
 * Divides the glyph's advance equally among the real characters (sub-glyph hack).
 * @param {Glyph} glyph
 * @param {number} nextCl — cluster index of the next glyph (or line end)
 * @param {string} text — full hyphenated paragraph text
 * @param {number[]} hyphToOrig — mapping from hyphenated-text index to original-text index
 * @returns {{ origPos: number, width: number }[]}
 */
export function resolveGlyphPositions(glyph, nextCl, text, hyphToOrig) {
  const span = Math.max(1, nextCl - glyph.cl);
  const origPositions = [];
  for (let c = 0; c < span; c++) {
    const hp = glyph.cl + c;
    if (text[hp] !== SHY) {
      origPositions.push(hyphToOrig[hp]);
    }
  }
  const sliceWidth = origPositions.length > 0 ? glyph.ax / origPositions.length : glyph.ax;
  return origPositions.map((origPos) => ({ origPos, width: sliceWidth }));
}

/**
 * Build cursor positions for a line: an array of { charPos, x } in
 * original-text space. The last entry is always the right edge of the line.
 * @param {LineEntry} entry
 * @param {number} baseX — pixel x of the line's left text edge (box.x + padding)
 * @returns {CursorPosition[]}
 */
export function buildPositions(entry, baseX) {
  const { glyphs: rawGlyphs, words, text, hyphToOrig, origLen, isLastInPara,
          hyphenated, hyphenAdvance } = entry;

  const glyphs = mergeLigatureClusters(rawGlyphs);
  const wordGroups = splitGlyphsIntoWords(glyphs, text, entry.endChar);

  const positions = [];
  const seen = new Set();

  function addPos(origOffset, x) {
    if (!seen.has(origOffset)) {
      seen.add(origOffset);
      positions.push({ charPos: origOffset, x });
    }
  }

  for (let wi = 0; wi < words.length && wi < wordGroups.length; wi++) {
    const word = words[wi];
    const group = wordGroups[wi];
    let wx = baseX + word.x;

    for (let gi = 0; gi < group.glyphs.length; gi++) {
      const g = group.glyphs[gi];
      const nextCl = gi + 1 < group.glyphs.length
        ? group.glyphs[gi + 1].cl
        : group.endCl;
      const charSlices = resolveGlyphPositions(g, nextCl, text, hyphToOrig);

      if (charSlices.length === 0) {
        wx += g.ax;
        continue;
      }

      for (const { origPos, width } of charSlices) {
        addPos(origPos, wx);
        wx += width;
      }
    }

    if (group.spaceGlyph) {
      addPos(hyphToOrig[group.spaceGlyph.cl], wx);
    }
  }

  const rawEndX = words.length > 0
    ? baseX + words[words.length - 1].x + words[words.length - 1].width
    : baseX;
  const endX = hyphenated ? rawEndX - (hyphenAdvance || 0) : rawEndX;

  if (isLastInPara) {
    addPos(origLen, endX);
  } else {
    addPos(hyphToOrig[entry.endChar], endX);
  }

  return positions;
}
