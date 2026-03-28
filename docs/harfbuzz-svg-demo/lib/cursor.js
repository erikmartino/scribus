// cursor.js — SVG cursor view (blinking caret, click/keyboard handlers)

import {
  moveLeft, moveRight, positionToPoint, pointToPos, xToPos,
} from './story-position.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const BLINK_MS = 500;

export class TextCursor {
  /**
   * @param {SVGElement} svg
   * @param {object[][]} story
   * @param {object[]} lineMap
   * @param {number} fontSize
   */
  constructor(svg, story, lineMap, fontSize) {
    this._svg = svg;
    this._story = story;
    this._lineMap = lineMap;
    this._fontSize = fontSize;
    this._pos = null;    // { paraIndex, charOffset, lineIndex }
    this._stickyX = null; // offset from line's left text edge for up/down

    this._cursorEl = document.createElementNS(SVG_NS, 'line');
    this._cursorEl.setAttribute('stroke', '#1a1a1a');
    this._cursorEl.setAttribute('stroke-width', '1.5');
    this._cursorEl.setAttribute('visibility', 'hidden');
    this._svg.appendChild(this._cursorEl);

    this._visible = false;
    this._blinkInterval = setInterval(() => {
      if (!this._pos) return;
      this._visible = !this._visible;
      this._cursorEl.setAttribute('visibility', this._visible ? 'visible' : 'hidden');
    }, BLINK_MS);
  }

  /**
   * Move cursor to a position and update visual.
   * @param {{ paraIndex: number, charOffset: number, lineIndex: number }} pos
   */
  moveTo(pos) {
    this._pos = pos;
    const pt = positionToPoint(pos, this._lineMap, this._fontSize);
    if (pt) this._draw(pt.x, pt.y, pt.height);
  }

  _draw(x, y, height) {
    this._cursorEl.setAttribute('x1', x.toFixed(2));
    this._cursorEl.setAttribute('y1', y.toFixed(2));
    this._cursorEl.setAttribute('x2', x.toFixed(2));
    this._cursorEl.setAttribute('y2', (y + height).toFixed(2));
    this._visible = true;
    this._cursorEl.setAttribute('visibility', 'visible');
  }

  /** @param {MouseEvent} event */
  handleClick(event) {
    const pt = this._svg.createSVGPoint();
    pt.x = event.clientX;
    pt.y = event.clientY;
    const svgPt = pt.matrixTransform(this._svg.getScreenCTM().inverse());

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
    const cursorY = targetLine.y - this._fontSize * 0.8;
    const cursorH = this._fontSize * 1.2;
    this._draw(result.x, cursorY, cursorH);
  }

  updateLayout(svg, lineMap, fontSize) {
    if (this._svg !== svg) {
      if (this._cursorEl.parentNode) this._cursorEl.parentNode.removeChild(this._cursorEl);
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

  destroy() {
    clearInterval(this._blinkInterval);
    if (this._cursorEl.parentNode) this._cursorEl.parentNode.removeChild(this._cursorEl);
  }
}
