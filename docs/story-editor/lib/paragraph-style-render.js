// paragraph-style-render.js - paragraph style extraction and SVG post-layout application

import { cloneParagraphStyle } from './paragraph-style.js';

export const PARAGRAPH_STYLE_PRESETS = Object.freeze({
  normal: Object.freeze({ firstLineScale: 1 }),
  lead: Object.freeze({ firstLineScale: 1.34 }),
});

/**
 * @param {Element} container
 * @returns {string[]}
 */
export function extractParagraphStyleNames(container) {
  const names = [];
  for (const el of container.children) {
    if (el.tagName.toLowerCase() !== 'p') continue;
    names.push(el.getAttribute('data-pstyle') || 'normal');
  }
  return names;
}

/**
 * @param {string} [name]
 * @returns {import('./paragraph-style.js').ParagraphStyle}
 */
export function defaultParagraphStyle(name = 'normal') {
  const preset = PARAGRAPH_STYLE_PRESETS[name] || PARAGRAPH_STYLE_PRESETS.normal;
  return cloneParagraphStyle({
    firstLineScale: preset.firstLineScale || 1,
    fontSize: null,
  });
}

/**
 * @param {Element} container
 * @returns {import('./paragraph-style.js').ParagraphStyle[]}
 */
export function extractParagraphStyles(container) {
  const styles = [];
  for (const el of container.children) {
    if (el.tagName.toLowerCase() !== 'p') continue;
    const name = el.getAttribute('data-pstyle') || 'normal';
    styles.push(defaultParagraphStyle(name));
  }
  return styles;
}

/**
 * @param {import('./paragraph-style.js').ParagraphStyle[]} paragraphStyles
 * @param {number} paragraphCount
 */
export function ensureParagraphStylesLength(paragraphStyles, paragraphCount) {
  while (paragraphStyles.length < paragraphCount) {
    paragraphStyles.push(defaultParagraphStyle('normal'));
  }
  if (paragraphStyles.length > paragraphCount) {
    paragraphStyles.length = paragraphCount;
  }
}

/**
 * @param {number} baseFontSize
 * @param {import('./paragraph-style.js').ParagraphStyle[]} paragraphStyles
 * @returns {{ fontSize?: number }[]}
 */
export function buildParagraphLayoutStyles(baseFontSize, paragraphStyles) {
  return paragraphStyles.map((style) => ({
    fontSize: style.fontSize || baseFontSize,
  }));
}

/**
 * Apply paragraph styles after SVG creation for first-line scaling behavior.
 *
 * @param {SVGSVGElement} svg
 * @param {Array<{ paraIndex: number, lineIndex: number, positions: Array<{ charPos: number, x: number }>, colX: number, boxY: number, boxWidth: number, boxHeight: number, y: number, fontSize?: number }>} lineMap
 * @param {number} baseFontSize
 * @param {import('./paragraph-style.js').ParagraphStyle[]} paragraphStyles
 */
export function applyParagraphStylesToSvg(svg, lineMap, baseFontSize, paragraphStyles) {
  const firstLineByPara = new Map();
  for (const line of lineMap) {
    if (!firstLineByPara.has(line.paraIndex)) {
      firstLineByPara.set(line.paraIndex, line.lineIndex);
    }
  }

  const textEls = svg.querySelectorAll('text');
  const lineOffsets = new Array(lineMap.length).fill(0);

  for (let paraIndex = 0; paraIndex < paragraphStyles.length; paraIndex++) {
    const style = paragraphStyles[paraIndex] || defaultParagraphStyle('normal');
    const paraScale = style.fontSize ? style.fontSize / baseFontSize : 1;
    const firstLineIndex = firstLineByPara.get(paraIndex);
    if (!Number.isInteger(firstLineIndex)) continue;

    for (let i = 0; i < lineMap.length; i++) {
      const line = lineMap[i];
      if (line.paraIndex !== paraIndex) continue;
      line.fontSize = baseFontSize * paraScale;
    }

    const firstLineScale = style.firstLineScale || 1;
    if (firstLineScale === 1) continue;

    const firstLine = lineMap[firstLineIndex];
    const textEl = textEls[firstLineIndex];
    if (!textEl) continue;

    const lineBaseSize = firstLine.fontSize || (baseFontSize * paraScale);
    const anchorX = firstLine.positions[0]?.x ?? firstLine.colX;
    textEl.setAttribute('font-size', (lineBaseSize * firstLineScale).toFixed(2));

    const tspans = textEl.querySelectorAll('tspan[x]');
    for (const tspan of tspans) {
      const x = Number(tspan.getAttribute('x'));
      if (!Number.isFinite(x)) continue;
      const scaledX = anchorX + (x - anchorX) * firstLineScale;
      tspan.setAttribute('x', scaledX.toFixed(2));
    }

    for (const pos of firstLine.positions) {
      pos.x = anchorX + (pos.x - anchorX) * firstLineScale;
    }

    firstLine.fontSize = lineBaseSize * firstLineScale;

    const delta = lineBaseSize * (firstLineScale - 1);
    const boxKey = `${firstLine.colX},${firstLine.boxY},${firstLine.boxWidth},${firstLine.boxHeight}`;
    for (let li = firstLineIndex + 1; li < lineMap.length; li++) {
      const line = lineMap[li];
      const key = `${line.colX},${line.boxY},${line.boxWidth},${line.boxHeight}`;
      if (key === boxKey) {
        lineOffsets[li] += delta;
      }
    }
  }

  for (let i = 0; i < lineMap.length; i++) {
    if (lineOffsets[i] === 0) continue;
    const textEl = textEls[i];
    if (!textEl) continue;
    const nextY = lineMap[i].y + lineOffsets[i];
    lineMap[i].y = nextY;
    textEl.setAttribute('y', nextY.toFixed(1));
  }
}
