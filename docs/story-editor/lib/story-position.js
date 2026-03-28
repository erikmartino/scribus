// story-position.js — pure functions for story position logic (no DOM/SVG)
//
// Cursor position is { paraIndex, charOffset, lineIndex }.
// lineIndex disambiguates which line the cursor is on when a charOffset
// falls at a line boundary (e.g. end of one line = start of next).
// Each lineMap entry has a `positions` array of { charPos, x } pairs.
// The last entry in positions is always the right edge of the line.

/**
 * @typedef {import('./text-extract.js').Story} Story
 * @typedef {import('./svg-renderer.js').LineMapEntry} LineMapEntry
 */

/**
 * A cursor position in the story: paragraph + character offset + line.
 * @typedef {object} CursorPos
 * @property {number} paraIndex  — index of the paragraph in the story
 * @property {number} charOffset — character offset into the paragraph's flattened text
 * @property {number} lineIndex  — index into the flat lineMap array
 */

/**
 * A visual point for rendering the cursor.
 * @typedef {object} CursorPoint
 * @property {number} x      — pixel x on the SVG canvas
 * @property {number} y      — top of the cursor line
 * @property {number} height — cursor height in pixels
 */

/**
 * Compute the total text length of a paragraph.
 * @param {Story} story
 * @param {number} paraIndex
 * @returns {number}
 */
export function paraTextLength(story, paraIndex) {
  return story[paraIndex].reduce((sum, run) => sum + run.text.length, 0);
}

/**
 * Find the preferred line for a charOffset. When the offset falls at a
 * boundary between two lines, prefer the later line (start of new line).
 * @param {number} paraIndex
 * @param {number} charOffset
 * @param {LineMapEntry[]} lineMap
 * @returns {number}
 */
function findLine(paraIndex, charOffset, lineMap) {
  let lastMatch = -1;
  for (let i = 0; i < lineMap.length; i++) {
    const line = lineMap[i];
    if (line.paraIndex !== paraIndex) continue;
    const positions = line.positions;
    if (positions.length === 0) continue;
    const first = positions[0].charPos;
    const last = positions[positions.length - 1].charPos;
    if (charOffset >= first && charOffset <= last) {
      lastMatch = i;
    }
  }
  if (lastMatch >= 0) return lastMatch;
  for (let i = lineMap.length - 1; i >= 0; i--) {
    if (lineMap[i].paraIndex === paraIndex) return i;
  }
  return 0;
}

/**
 * Move cursor one character to the left.
 * @param {CursorPos} pos
 * @param {Story} story
 * @param {LineMapEntry[]} lineMap
 * @returns {CursorPos}
 */
export function moveLeft(pos, story, lineMap) {
  if (pos.charOffset > 0) {
    const co = pos.charOffset - 1;
    return { paraIndex: pos.paraIndex, charOffset: co, lineIndex: findLine(pos.paraIndex, co, lineMap) };
  }
  if (pos.paraIndex > 0) {
    const pi = pos.paraIndex - 1;
    const co = paraTextLength(story, pi);
    return { paraIndex: pi, charOffset: co, lineIndex: findLine(pi, co, lineMap) };
  }
  return pos;
}

/**
 * Move cursor one character to the right.
 * @param {CursorPos} pos
 * @param {Story} story
 * @param {LineMapEntry[]} lineMap
 * @returns {CursorPos}
 */
export function moveRight(pos, story, lineMap) {
  const len = paraTextLength(story, pos.paraIndex);
  if (pos.charOffset < len) {
    const co = pos.charOffset + 1;
    return { paraIndex: pos.paraIndex, charOffset: co, lineIndex: findLine(pos.paraIndex, co, lineMap) };
  }
  if (pos.paraIndex < story.length - 1) {
    const pi = pos.paraIndex + 1;
    return { paraIndex: pi, charOffset: 0, lineIndex: findLine(pi, 0, lineMap) };
  }
  return pos;
}

/**
 * Convert a cursor position to visual (x, y) coordinates.
 * Uses lineIndex directly — no searching.
 * @param {CursorPos} pos
 * @param {LineMapEntry[]} lineMap
 * @param {number} fontSize
 * @returns {CursorPoint|null}
 */
export function positionToPoint(pos, lineMap, fontSize) {
  const line = lineMap[pos.lineIndex];
  if (!line) return null;

  const positions = line.positions;

  for (let i = 0; i < positions.length; i++) {
    if (positions[i].charPos === pos.charOffset) {
      return { x: positions[i].x, y: line.y - fontSize * 0.8, height: fontSize * 1.2 };
    }
  }

  // Fallback: last position on line
  const last = positions[positions.length - 1];
  return { x: last.x, y: line.y - fontSize * 0.8, height: fontSize * 1.2 };
}

/**
 * Given an x coordinate within a line, find the closest cursor position.
 * Uses left-half/right-half logic for sub-glyph precision.
 * @param {number} x — target x coordinate on the SVG canvas
 * @param {LineMapEntry} line
 * @param {number} lineIdx — index of the line in lineMap
 * @returns {CursorPos & { x: number }} — position with resolved pixel x
 */
export function xToPos(x, line, lineIdx) {
  const positions = line.positions;
  const base = { paraIndex: line.paraIndex, lineIndex: lineIdx };

  if (positions.length === 0) {
    return { ...base, charOffset: 0, x: 0 };
  }

  if (x <= positions[0].x) {
    return { ...base, charOffset: positions[0].charPos, x: positions[0].x };
  }

  for (let i = 0; i < positions.length - 1; i++) {
    const left = positions[i].x;
    const right = positions[i + 1].x;
    if (x >= left && x < right) {
      const mid = (left + right) / 2;
      const pick = x < mid ? i : i + 1;
      return { ...base, charOffset: positions[pick].charPos, x: positions[pick].x };
    }
  }

  const last = positions[positions.length - 1];
  return { ...base, charOffset: last.charPos, x: last.x };
}

/**
 * Convert SVG coordinates from a mouse click to a cursor position.
 * Finds the nearest box, then the nearest line, then the nearest character.
 * @param {number} svgX
 * @param {number} svgY
 * @param {LineMapEntry[]} lineMap
 * @returns {CursorPos & { x?: number }}
 */
export function pointToPos(svgX, svgY, lineMap) {
  if (lineMap.length === 0) return { paraIndex: 0, charOffset: 0, lineIndex: 0 };

  // Group lines by box
  const boxGroups = new Map();
  for (const line of lineMap) {
    const key = `${line.colX},${line.boxY}`;
    if (!boxGroups.has(key)) boxGroups.set(key, []);
    boxGroups.get(key).push(line);
  }

  // Find which box the click falls inside
  let candidates = null;
  for (const lines of boxGroups.values()) {
    const l = lines[0];
    if (svgX >= l.colX && svgX <= l.colX + l.boxWidth &&
        svgY >= l.boxY && svgY <= l.boxY + l.boxHeight) {
      candidates = lines;
      break;
    }
  }

  // If click is outside all boxes, find the nearest box
  if (!candidates) {
    let bestDist = Infinity;
    for (const lines of boxGroups.values()) {
      const l = lines[0];
      const dx = Math.max(l.colX - svgX, 0, svgX - (l.colX + l.boxWidth));
      const dy = Math.max(l.boxY - svgY, 0, svgY - (l.boxY + l.boxHeight));
      const dist = dx * dx + dy * dy;
      if (dist < bestDist) {
        bestDist = dist;
        candidates = lines;
      }
    }
  }

  // Find closest line by y within the box
  let bestLine = candidates[0];
  let bestDist = Math.abs(svgY - bestLine.y);
  for (let i = 1; i < candidates.length; i++) {
    const dist = Math.abs(svgY - candidates[i].y);
    if (dist < bestDist) {
      bestDist = dist;
      bestLine = candidates[i];
    }
  }

  return xToPos(svgX, bestLine, bestLine.lineIndex);
}
