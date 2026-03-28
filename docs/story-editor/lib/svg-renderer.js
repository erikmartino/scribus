// svg-renderer.js — laid-out paragraphs -> SVG element with columns/boxes

import { buildPositions } from './positions.js';

/**
 * @typedef {import('./positions.js').CursorPosition} CursorPosition
 * @typedef {import('./positions.js').LineEntry} LineEntry
 */

/**
 * A box defining a rectangular region for text flow.
 * @typedef {object} Box
 * @property {number} x      — left edge
 * @property {number} y      — top edge
 * @property {number} width
 * @property {number} height
 */

/**
 * A line-map entry produced by the renderer, linking a rendered line
 * back to its paragraph position and providing cursor-position data.
 * @typedef {object} LineMapEntry
 * @property {number}           lineIndex  — global index in the flat lineMap array
 * @property {number}           paraIndex  — which paragraph this line belongs to
 * @property {CursorPosition[]} positions  — per-character cursor positions
 * @property {number}           colX       — x of the containing box
 * @property {number}           boxY       — y of the containing box
 * @property {number}           boxWidth   — width of the containing box
 * @property {number}           boxHeight  — height of the containing box
 * @property {number}           y          — baseline y of this line in SVG coordinates
 */

const SVG_NS = 'http://www.w3.org/2000/svg';

/**
 * Apply SVG attributes for a character style.
 * @param {import('./style.js').Style} style
 * @param {string} [defaultFamily]
 * @returns {Record<string, string>}
 */
function svgAttrsForStyle(style, defaultFamily = '') {
  const attrs = {};
  if (style.bold) attrs['font-weight'] = 'bold';
  if (style.italic) attrs['font-style'] = 'italic';
  if (style.fontFamily) {
    attrs['font-family'] = `'${style.fontFamily}', serif`;
  } else if (defaultFamily) {
    attrs['font-family'] = `'${defaultFamily}', serif`;
  }
  return attrs;
}

export class SvgRenderer {
  /**
   * @param {{ fontFamily: string, padding?: number }} options
   */
  constructor({ fontFamily, padding = 16 }) {
    this._fontFamily = fontFamily;
    this._padding = padding;
  }

  get padding() {
    return this._padding;
  }

  /**
   * Render lines into arbitrarily placed boxes.
   *
   * @param {{ box: Box, lines: LineEntry[] }[]} boxResults
   *   Each entry has a `box` and `lines` (justified line entries).
   * @param {number} fontSize
   * @param {number} lineHeightPct
   * @returns {{ svg: SVGSVGElement, lineMap: LineMapEntry[] }}
   */
  render(boxResults, fontSize, lineHeightPct) {
    const defaultLineHeight = fontSize * (lineHeightPct / 100);
    const defaultParaSpacing = defaultLineHeight * 0.5;

    // Compute SVG bounds from boxes
    let maxX = 0, maxY = 0;
    for (const { box } of boxResults) {
      maxX = Math.max(maxX, box.x + box.width);
      maxY = Math.max(maxY, box.y + box.height);
    }

    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('width', String(maxX));
    svg.setAttribute('height', String(maxY));
    svg.setAttribute('viewBox', `0 0 ${maxX} ${maxY}`);

    // Draw box backgrounds
    for (const { box } of boxResults) {
      const bg = document.createElementNS(SVG_NS, 'rect');
      bg.setAttribute('x', box.x);
      bg.setAttribute('y', box.y);
      bg.setAttribute('width', box.width);
      bg.setAttribute('height', box.height);
      bg.setAttribute('fill', '#fffef8');
      bg.setAttribute('stroke', '#ccc');
      bg.setAttribute('stroke-width', '1');
      svg.appendChild(bg);
    }

    // Render lines in each box, building lineMap
    const lineMap = [];
    let globalLineIdx = 0;

    for (const { box, lines } of boxResults) {
      let y = box.y + this._padding + fontSize;

      for (let i = 0; i < lines.length; i++) {
        const entry = lines[i];
        const entryFontSize = entry.fontSize ?? fontSize;
        const entryFontFamily = entry.fontFamily || this._fontFamily;
        const lineHeight = entry.lineHeight || defaultLineHeight;
        const paraSpacing = entry.paraSpacing || defaultParaSpacing;
        const { words, isLastInPara } = entry;
        if (i > 0 && lines[i - 1].isLastInPara) y += paraSpacing;

        const textEl = document.createElementNS(SVG_NS, 'text');
        textEl.setAttribute('y', y.toFixed(1));
        textEl.setAttribute('font-size', entryFontSize);
        textEl.setAttribute('fill', '#222');
        textEl.setAttribute('style', 'user-select:none;pointer-events:none');

        for (const word of words) {
          for (let fi = 0; fi < word.fragments.length; fi++) {
            const frag = word.fragments[fi];
            const tspan = document.createElementNS(SVG_NS, 'tspan');
            if (fi === 0) tspan.setAttribute('x', (box.x + this._padding + word.x).toFixed(2));
            const attrs = svgAttrsForStyle(frag.style, entryFontFamily);
            for (const [k, v] of Object.entries(attrs)) tspan.setAttribute(k, v);
            tspan.textContent = frag.text;
            textEl.appendChild(tspan);
          }
        }

        svg.appendChild(textEl);

        const baseX = box.x + this._padding;
        const positions = buildPositions(entry, baseX);

        lineMap.push({
          lineIndex: globalLineIdx++,
          paraIndex: entry.paraIndex,
          positions,
          colX: box.x,
          boxY: box.y,
          boxWidth: box.width,
          boxHeight: box.height,
          y,
          fontSize: entryFontSize,
        });

        y += lineHeight;
      }
    }

    return { svg, lineMap };
  }
}
