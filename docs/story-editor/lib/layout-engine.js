// layout-engine.js — orchestrates the full pipeline (public API)

import { FontRegistry } from './font-registry.js';
import { Shaper } from './shaper.js';
import { Hyphenator } from './hyphenator.js';
import { breakLines } from './line-breaker.js';
import { justifyLine } from './justifier.js';
import { SvgRenderer } from './svg-renderer.js';

export { buildPositions } from './positions.js';

/**
 * @typedef {import('./text-extract.js').Story} Story
 * @typedef {import('./text-extract.js').Run} Run
 * @typedef {import('./shaper.js').Glyph} Glyph
 * @typedef {import('./svg-renderer.js').Box} Box
 * @typedef {import('./svg-renderer.js').LineMapEntry} LineMapEntry
 * @typedef {import('./positions.js').LineEntry} LineEntry
 */

/**
 * Shaped paragraph data ready for line breaking.
 * @typedef {object} ShapedPara
 * @property {string}   text       — full hyphenated paragraph text
 * @property {Glyph[]}  glyphs     — shaped glyph stream
 * @property {number}   paraIndex  — index into the story
 * @property {number[]} hyphToOrig — mapping from hyphenated-text index to original-text index
 * @property {number}   origLen    — length of the original (un-hyphenated) paragraph text
 * @property {number}   fontSize   — paragraph-level font size used for shaping
 */

export class LayoutEngine {
  /**
   * @param {object} hb — HarfBuzz WASM instance
   * @param {FontRegistry} fontRegistry
   * @param {Shaper} shaper
   * @param {Hyphenator} hyphenator
   * @param {SvgRenderer} svgRenderer
   */
  constructor(hb, fontRegistry, shaper, hyphenator, svgRenderer, options = {}) {
    this._hb = hb;
    this._fontRegistry = fontRegistry;
    this._shaper = shaper;
    this._hyphenator = hyphenator;
    this._svgRenderer = svgRenderer;
    this._shapeCache = new Map();
    this._hyphenAdvanceCache = new Map();
    this._reserveBottom = options.reserveBottom ?? true;
  }

  /**
   * Factory: loads HarfBuzz WASM, fonts, and hyphenation patterns.
   *
   * @param {{
   *   hbWasmUrl: string,
   *   hbJsUrl: string,
   *   hyphenUrl: string,
   *   fontUrl: string,
   *   fontItalicUrl: string,
   *   fontFamily: string,
   *   padding?: number,
   * }} options
   * @returns {Promise<LayoutEngine>}
   */
  static async create(options) {
    const {
      hbWasmUrl, hbJsUrl, hyphenUrl,
      fontUrl, fontItalicUrl, fontFamily,
      padding,
      reserveBottom,
    } = options;

    // Load HarfBuzz
    const jsText = await (await fetch(hbJsUrl)).text();
    const hbjsFactory = new Function('return ' + jsText)();
    const wasmBinary = await (await fetch(hbWasmUrl)).arrayBuffer();
    const { instance } = await WebAssembly.instantiate(wasmBinary, {});
    const hb = hbjsFactory(instance);

    // Load fonts and hyphenation in parallel
    const fontRegistry = new FontRegistry(hb);
    const [regularBuf, italicBuf, hyphenModule] = await Promise.all([
      fontRegistry.loadFont(fontUrl, [
        { key: 'regular', bold: false },
        { key: 'bold', bold: true },
      ]),
      fontRegistry.loadFont(fontItalicUrl, [
        { key: 'italic', bold: false },
        { key: 'bolditalic', bold: true },
      ]),
      import(hyphenUrl),
    ]);

    // Register @font-face variants
    await fontRegistry.registerFontFaces([
      { buffer: regularBuf, style: 'normal', weight: 'normal' },
      { buffer: regularBuf, style: 'normal', weight: 'bold' },
      { buffer: italicBuf,  style: 'italic', weight: 'normal' },
      { buffer: italicBuf,  style: 'italic', weight: 'bold' },
    ], fontFamily);

    const shaper = new Shaper(hb, fontRegistry);
    const hyphenator = new Hyphenator(hyphenModule.default.hyphenateSync);
    const svgRenderer = new SvgRenderer({
      fontFamily,
      ...(padding != null && { padding }),
    });

    return new LayoutEngine(hb, fontRegistry, shaper, hyphenator, svgRenderer, {
      reserveBottom,
    });
  }

  /**
   * Shape and hyphenate paragraphs, returning shaped data ready for line breaking.
   *
   * @param {Story} runsParagraphs
   * @param {number} fontSize
   * @param {{ fontSize: number }[]} [paragraphStyles]
   * @returns {ShapedPara[]}
   */
  shapeParagraphs(runsParagraphs, fontSize, paragraphStyles = []) {
    this._pruneShapeCache(runsParagraphs.length);

    const shaped = [];
    for (let pi = 0; pi < runsParagraphs.length; pi++) {
      const runs = runsParagraphs[pi];
      const styleFontSize = paragraphStyles[pi]?.fontSize;
      const paraFontSize = Number.isFinite(styleFontSize) ? Number(styleFontSize) : fontSize;
      const fingerprint = this._fingerprintRuns(runs);
      const cached = this._shapeCache.get(pi);

      if (cached && cached.fontSize === paraFontSize && cached.fingerprint === fingerprint) {
        shaped.push(cached.shapedPara);
        continue;
      }

      const hRuns = this._hyphenator.hyphenateRuns(runs);
      const { text, glyphs } = this._shaper.shapeParagraph(hRuns, paraFontSize);

      // Build mapping from hyphenated text positions to original text positions.
      // Soft hyphens (\u00AD) are inserted by the hyphenator and don't exist in the story.
      const origText = runs.map(r => r.text).join('');
      const hyphToOrig = [];
      let origIdx = 0;
      for (let hi = 0; hi < text.length; hi++) {
        if (text[hi] === '\u00AD') {
          hyphToOrig.push(origIdx); // soft hyphen maps to the position before next orig char
        } else {
          hyphToOrig.push(origIdx);
          origIdx++;
        }
      }
      // One past end
      const origLen = origText.length;

      const shapedPara = { text, glyphs, paraIndex: pi, hyphToOrig, origLen, fontSize: paraFontSize };
      this._shapeCache.set(pi, { fontSize: paraFontSize, fingerprint, shapedPara });
      shaped.push(shapedPara);
    }
    return shaped;
  }

  /**
   * Flow shaped paragraphs into a sequence of boxes, breaking lines per-box width.
   *
   * @param {ShapedPara[]} shapedParas
   * @param {Box[]} boxes
   * @param {number} fontSize
   * @param {number} lineHeightPct
   * @returns {{ box: Box, lines: LineEntry[] }[]}
   */
  flowIntoBoxes(shapedParas, boxes, fontSize, lineHeightPct) {
    const padding = this._svgRenderer.padding ?? this._svgRenderer._padding ?? 16;
    const bottomReserve = this._reserveBottom ? fontSize : 0;

    const boxResults = boxes.map(box => ({ box, lines: [] }));
    let boxIdx = 0;
    let usedHeight = 0;

    for (const { text, glyphs, paraIndex, hyphToOrig, origLen, fontSize: paraFontSize } of shapedParas) {
      const effectiveFontSize = paraFontSize;
      const lineHeight = effectiveFontSize * (lineHeightPct / 100);
      const paraSpacing = lineHeight * 0.5;
      const hyphenAdvance = this._measureHyphen(effectiveFontSize);
      if (glyphs.length === 0) {
        while (boxIdx < boxes.length) {
          const extraSpace = (boxResults[boxIdx].lines.length > 0 &&
            boxResults[boxIdx].lines[boxResults[boxIdx].lines.length - 1].isLastInPara)
            ? paraSpacing : 0;
          const needed = extraSpace + lineHeight;
          const available = boxes[boxIdx].height - padding * 2 - bottomReserve - usedHeight;

          if (needed > available && boxResults[boxIdx].lines.length > 0) {
            boxIdx++;
            usedHeight = 0;
            continue;
          }

          boxResults[boxIdx].lines.push({
            words: [],
            text,
            isLastInPara: true,
            paraIndex,
            startChar: 0,
            endChar: 0,
            glyphs: [],
            hyphToOrig,
            origLen,
            hyphenated: false,
            hyphenAdvance,
            fontSize: effectiveFontSize,
            lineHeight,
            paraSpacing,
          });
          usedHeight += needed;
          break;
        }
        continue;
      }

      // Remaining glyphs to place — re-broken when box width changes
      let remainingGlyphs = glyphs;

      while (remainingGlyphs.length > 0 && boxIdx < boxes.length) {
        const innerWidth = boxes[boxIdx].width - padding * 2;
        const lines = breakLines(remainingGlyphs, text, innerWidth, hyphenAdvance);

        let consumed = false;
        for (let li = 0; li < lines.length; li++) {
          const line = lines[li];
          const isLastInPara = li === lines.length - 1 && line.endChar === text.length;

          // Check if this line fits in current box
          const extraSpace = (boxResults[boxIdx].lines.length > 0 &&
            boxResults[boxIdx].lines[boxResults[boxIdx].lines.length - 1].isLastInPara)
            ? paraSpacing : 0;
          const needed = extraSpace + lineHeight;
          const available = boxes[boxIdx].height - padding * 2 - bottomReserve - usedHeight;

          if (needed > available && boxResults[boxIdx].lines.length > 0) {
            // Overflow: collect remaining glyphs and re-break in next box
            remainingGlyphs = glyphs.filter(g => g.cl >= line.startChar);
            boxIdx++;
            usedHeight = 0;
            consumed = false;
            break;
          }

          const words = justifyLine(line, text, innerWidth, hyphenAdvance, isLastInPara);

          boxResults[boxIdx].lines.push({
            words, text, isLastInPara,
            paraIndex,
            startChar: line.startChar,
            endChar: line.endChar,
            glyphs: line.glyphs,
            hyphToOrig,
            origLen,
            hyphenated: line.hyphenated,
            hyphenAdvance,
            fontSize: effectiveFontSize,
            lineHeight,
            paraSpacing,
          });

          usedHeight += needed;
          consumed = true;
        }

        if (consumed) break; // entire paragraph placed
      }
    }

    return boxResults;
  }

  /**
   * Full pipeline: shape, flow into boxes, render to SVG.
   *
   * @param {Element} container
   * @param {Story} paragraphs
   * @param {Box[]} boxes
   * @param {number} fontSize
   * @param {number} lineHeightPct
   * @param {{ fontSize: number }[]} [paragraphStyles]
   * @returns {{ svg: SVGSVGElement, lineMap: LineMapEntry[] }}
   */
  renderToContainer(container, paragraphs, boxes, fontSize, lineHeightPct, paragraphStyles = []) {
    const shaped = this.shapeParagraphs(paragraphs, fontSize, paragraphStyles);
    const boxResults = this.flowIntoBoxes(shaped, boxes, fontSize, lineHeightPct);
    const { svg, lineMap } = this._svgRenderer.render(boxResults, fontSize, lineHeightPct);
    container.innerHTML = '';
    container.appendChild(svg);
    return { svg, lineMap };
  }

  /**
   * Measure the advance width of a hyphen in the default style.
   * @param {number} fontSize
   * @returns {number}
   */
  _measureHyphen(fontSize) {
    if (this._hyphenAdvanceCache.has(fontSize)) {
      return this._hyphenAdvanceCache.get(fontSize);
    }
    const glyphs = this._shaper.shapeRun('-', { bold: false, italic: false }, fontSize);
    const advance = glyphs.length > 0 ? glyphs[0].ax : fontSize * 0.3;
    this._hyphenAdvanceCache.set(fontSize, advance);
    return advance;
  }

  _fingerprintRuns(runs) {
    let out = '';
    for (const run of runs) {
      out += `${run.text.length}:${run.text}|${JSON.stringify(run.style)}\n`;
    }
    return out;
  }

  _pruneShapeCache(paraCount) {
    for (const paraIndex of this._shapeCache.keys()) {
      if (paraIndex >= paraCount) {
        this._shapeCache.delete(paraIndex);
      }
    }
  }
}
