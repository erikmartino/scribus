// positions.js — build cursor positions from layout data (no DOM dependencies)

const SHY = '\u00AD';

/**
 * Merge consecutive glyphs that share the same cluster index (cl).
 * HarfBuzz emits multiple glyphs per ligature cluster — the first carries
 * the advance, the rest have ax=0. Merging sums the advances into one entry.
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
  } else if (entry.endChar < text.length && text[entry.endChar] === ' ') {
    addPos(hyphToOrig[entry.endChar], endX);
  } else {
    addPos(hyphToOrig[entry.endChar], endX);
  }

  return positions;
}
