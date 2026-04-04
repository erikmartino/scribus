// cursor.js — SVG cursor view (blinking caret, click/keyboard handlers)

import {
  moveLeft, moveRight, positionToPoint, pointToPos, xToPos, resolveLineIndex,
} from './story-position.js';

/**
 * @typedef {import('./text-extract.js').Story} Story
 * @typedef {import('./svg-renderer.js').LineMapEntry} LineMapEntry
 * @typedef {import('./story-position.js').CursorPos} CursorPos
 */

const SVG_NS = 'http://www.w3.org/2000/svg';
const BLINK_MS = 500;

export class TextCursor {
  /**
   * @param {SVGSVGElement} svg
   * @param {Story} story
   * @param {LineMapEntry[]} lineMap
   * @param {number} fontSize
   */
  constructor(svg, story, lineMap, fontSize) {
    this._svg = svg;
    this._story = story;
    this._lineMap = lineMap;
    this._fontSize = fontSize;
    this._pos = null;    // { paraIndex, charOffset, lineIndex }
    this._stickyX = null; // offset from line's left text edge for up/down

    // Selection rendering
    this._selectionGroup = document.createElementNS(SVG_NS, 'g');
    this._selectionGroup.classList.add('text-selection');
    this._selectionGroup.setAttribute('id', 'text-selection');
    this._svg.appendChild(this._selectionGroup);

    this._cursorEl = document.createElementNS(SVG_NS, 'line');
    this._cursorEl.classList.add('text-cursor');
    this._cursorEl.setAttribute('id', 'text-cursor');
    this._cursorEl.setAttribute('stroke', '#1a1a1a');
    this._cursorEl.setAttribute('stroke-width', '1.5');
    this._cursorEl.setAttribute('visibility', 'hidden');
    this._svg.appendChild(this._cursorEl);

    this._blinkingEnabled = false;
    this._visible = false;
    this._blinkInterval = setInterval(() => {
      // Only blink if specifically enabled AND we have a position
      if (!this._blinkingEnabled || !this._pos) {
        if (this._cursorEl.getAttribute('visibility') !== 'hidden') {
          this._cursorEl.setAttribute('visibility', 'hidden');
        }
        return;
      }
      this._visible = !this._visible;
      this._cursorEl.setAttribute('visibility', this._visible ? 'visible' : 'hidden');
    }, BLINK_MS);
  }

  /**
   * Move cursor to a position and update the visual caret.
   * @param {CursorPos} pos
   */
  moveTo(pos) {
    const lineIndex = resolveLineIndex(pos, this._lineMap);
    this._pos = { paraIndex: pos.paraIndex, charOffset: pos.charOffset, lineIndex };
    const pt = positionToPoint(this._pos, this._lineMap, this._fontSize);
    if (pt) this._draw(pt.x, pt.y, pt.height);
  }

  /**
   * Render selection rectangles for the given range.
   * @param {{ start: CursorPos, end: CursorPos }|null} range
   */
  updateSelection(range) {
    this._selectionGroup.innerHTML = '';
    if (!range) return;

    for (const line of this._lineMap) {
      if (line.paraIndex < range.start.paraIndex || line.paraIndex > range.end.paraIndex) continue;
      if (!line.positions || line.positions.length === 0) continue;

      const lineStart = line.positions[0].charPos;
      const lineEnd = line.positions[line.positions.length - 1].charPos;
      const from = line.paraIndex === range.start.paraIndex ? Math.max(range.start.charOffset, lineStart) : lineStart;
      const to = line.paraIndex === range.end.paraIndex ? Math.min(range.end.charOffset, lineEnd) : lineEnd;
      
      if (to <= from) continue;

      const x1 = this._xAtChar(line, from);
      const x2 = this._xAtChar(line, to);
      if (x2 <= x1) continue;

      const lineFontSize = line.fontSize ?? this._fontSize;
      const rect = document.createElementNS(SVG_NS, 'rect');
      rect.setAttribute('x', x1.toFixed(2));
      rect.setAttribute('y', (line.y - lineFontSize * 0.8).toFixed(2));
      rect.setAttribute('width', (x2 - x1).toFixed(2));
      rect.setAttribute('height', (lineFontSize * 1.2).toFixed(2));
      rect.setAttribute('fill', 'rgba(0, 120, 215, 0.25)');
      this._selectionGroup.appendChild(rect);
    }
  }

  _xAtChar(line, charPos) {
    const positions = line.positions;
    if (!positions || positions.length === 0) return 0;
    
    // Find exact match
    for (let i = 0; i < positions.length; i++) {
        if (positions[i].charPos === charPos) return positions[i].x;
    }

    if (charPos <= positions[0].charPos) return positions[0].x;
    for (let i = 0; i < positions.length - 1; i++) {
        if (charPos >= positions[i].charPos && charPos <= positions[i+1].charPos) {
            return positions[i].x;
        }
    }
    return positions[positions.length - 1].x;
  }

  /**
   * @returns {CursorPos|null}
   */
  getPosition() {
    if (!this._pos) return null;
    return { ...this._pos };
  }

  /**
   * Replace story reference used for keyboard navigation.
   * @param {Story} story
   */
  setStory(story) {
    this._story = story;
  }

  getLineMap() {
    return this._lineMap;
  }

  /**
   * Draw the cursor line at the given position.
   * @param {number} x
   * @param {number} y — top of the cursor
   * @param {number} height
   */
  _draw(x, y, height) {
    this._cursorEl.setAttribute('x1', x.toFixed(2));
    this._cursorEl.setAttribute('y1', y.toFixed(2));
    this._cursorEl.setAttribute('x2', x.toFixed(2));
    this._cursorEl.setAttribute('y2', (y + height).toFixed(2));
    this._visible = true;
    this._cursorEl.setAttribute('visibility', 'visible');
  }

  setVisible(visible) {
    this._blinkingEnabled = !!visible;
    this._visible = this._blinkingEnabled;
    this._cursorEl.setAttribute('visibility', this._blinkingEnabled ? 'visible' : 'hidden');
  }

  /** @param {MouseEvent} event */
  handleClick(event) {
    const ctm = this._svg.getScreenCTM();
    if (!ctm) return;
    const PointCtor = typeof DOMPoint === 'function'
      ? DOMPoint
      : (typeof window !== 'undefined' && typeof window.DOMPoint === 'function' ? window.DOMPoint : null);
    if (!PointCtor) return;
    const svgPt = new PointCtor(event.clientX, event.clientY).matrixTransform(ctm.inverse());

    const pos = pointToPos(svgPt.x, svgPt.y, this._lineMap);
    this._stickyX = null;
    this.moveTo(pos);
  }

  /** @param {KeyboardEvent} event */
  handleKeydown(event) {
    if (!this._pos) return;

    const { key } = event;
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(key)) return;
    event.preventDefault();

    if (key === 'ArrowLeft') {
      this._stickyX = null;
      this.moveTo(moveLeft(this._pos, this._story, this._lineMap));
      return;
    }

    if (key === 'ArrowRight') {
      this._stickyX = null;
      this.moveTo(moveRight(this._pos, this._story, this._lineMap));
      return;
    }

    // Up/Down: move to previous/next line in text flow order
    const targetLineIdx = key === 'ArrowUp'
      ? this._pos.lineIndex - 1
      : this._pos.lineIndex + 1;

    if (targetLineIdx < 0 || targetLineIdx >= this._lineMap.length) return;

    if (this._stickyX === null) {
      const curLine = this._lineMap[this._pos.lineIndex];
      const pt = positionToPoint(this._pos, this._lineMap, this._fontSize);
      const lineLeftX = curLine.positions.length > 0 ? curLine.positions[0].x : 0;
      this._stickyX = pt ? pt.x - lineLeftX : 0;
    }

    const targetLine = this._lineMap[targetLineIdx];
    const targetLeftX = targetLine.positions.length > 0 ? targetLine.positions[0].x : 0;
    const result = xToPos(this._stickyX + targetLeftX, targetLine, targetLineIdx);
    this._pos = { paraIndex: result.paraIndex, charOffset: result.charOffset, lineIndex: result.lineIndex };

    // Use the resolved x from xToPos directly (preserves right-edge position)
    const lineFontSize = targetLine.fontSize ?? this._fontSize;
    const cursorY = targetLine.y - lineFontSize * 0.8;
    const cursorH = lineFontSize * 1.2;
    this._draw(result.x, cursorY, cursorH);
  }

  /**
   * Update layout references after a re-render (e.g. slider change).
   * Clamps the current position to valid range and redraws.
   * @param {SVGSVGElement} svg
   * @param {LineMapEntry[]} lineMap
   * @param {number} fontSize
   */
  updateLayout(svg, lineMap, fontSize) {
    if (this._svg !== svg) {
      if (this._cursorEl.parentNode) this._cursorEl.parentNode.removeChild(this._cursorEl);
      if (this._selectionGroup.parentNode) this._selectionGroup.parentNode.removeChild(this._selectionGroup);
      svg.appendChild(this._selectionGroup);
      svg.appendChild(this._cursorEl);
      this._svg = svg;
    }
    this._lineMap = lineMap;
    this._fontSize = fontSize;

    if (this._pos) {
      // Re-resolve lineIndex in case line structure changed
      this._pos.lineIndex = Math.min(this._pos.lineIndex, lineMap.length - 1);
      this.moveTo(this._pos);
    }
  }

  /** Remove the cursor element and stop blinking. */
  destroy() {
    clearInterval(this._blinkInterval);
    if (this._cursorEl.parentNode) this._cursorEl.parentNode.removeChild(this._cursorEl);
    if (this._selectionGroup.parentNode) this._selectionGroup.parentNode.removeChild(this._selectionGroup);
  }
}
