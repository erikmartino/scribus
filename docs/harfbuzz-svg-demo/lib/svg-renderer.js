// svg-renderer.js — laid-out paragraphs -> SVG element with columns/boxes

import { buildPositions } from './positions.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

function svgAttrsForStyle(style) {
  const attrs = {};
  if (style.bold) attrs['font-weight'] = 'bold';
  if (style.italic) attrs['font-style'] = 'italic';
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

  /**
   * Render lines into arbitrarily placed boxes.
   *
   * @param {{ box: object, lines: object[] }[]} boxResults
   *   Each entry has a `box` ({ x, y, width, height }) and `lines` (justified line entries).
   * @param {number} fontSize
   * @param {number} lineHeightPct
   * @returns {{ svg: SVGElement, lineMap: object[] }}
   */
  render(boxResults, fontSize, lineHeightPct) {
    const lineHeight = fontSize * (lineHeightPct / 100);
    const paraSpacing = lineHeight * 0.5;

    // Compute SVG bounds from boxes
    let maxX = 0, maxY = 0;
    for (const { box } of boxResults) {
      maxX = Math.max(maxX, box.x + box.width);
      maxY = Math.max(maxY, box.y + box.height);
    }

    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('width', maxX);
    svg.setAttribute('height', maxY);
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
        const { words, isLastInPara } = entry;
        if (i > 0 && lines[i - 1].isLastInPara) y += paraSpacing;

        const textEl = document.createElementNS(SVG_NS, 'text');
        textEl.setAttribute('y', y.toFixed(1));
        textEl.setAttribute('font-family', `'${this._fontFamily}', serif`);
        textEl.setAttribute('font-size', fontSize);
        textEl.setAttribute('fill', '#222');

        for (const word of words) {
          for (let fi = 0; fi < word.fragments.length; fi++) {
            const frag = word.fragments[fi];
            const tspan = document.createElementNS(SVG_NS, 'tspan');
            if (fi === 0) tspan.setAttribute('x', (box.x + this._padding + word.x).toFixed(2));
            const attrs = svgAttrsForStyle(frag.style);
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
        });

        y += lineHeight;
      }
    }

    return { svg, lineMap };
  }
}
