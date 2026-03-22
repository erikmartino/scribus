// layout-engine.js — orchestrates the full pipeline (public API)

import { FontRegistry } from './font-registry.js';
import { Shaper } from './shaper.js';
import { Hyphenator } from './hyphenator.js';
import { breakLines } from './line-breaker.js';
import { justifyLine } from './justifier.js';
import { SvgRenderer } from './svg-renderer.js';

export { buildPositions } from './positions.js';

export class LayoutEngine {
  constructor(hb, fontRegistry, shaper, hyphenator, svgRenderer) {
    this._hb = hb;
    this._fontRegistry = fontRegistry;
    this._shaper = shaper;
    this._hyphenator = hyphenator;
    this._svgRenderer = svgRenderer;
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

    return new LayoutEngine(hb, fontRegistry, shaper, hyphenator, svgRenderer);
  }

  /**
   * Shape and hyphenate paragraphs, returning shaped data ready for line breaking.
   *
   * @param {{ text: string, style: object }[][]} runsParagraphs
   * @param {number} fontSize
   * @returns {{ text: string, glyphs: object[], paraIndex: number }[]}
   */
  shapeParagraphs(runsParagraphs, fontSize) {
    const shaped = [];
    for (let pi = 0; pi < runsParagraphs.length; pi++) {
      const runs = runsParagraphs[pi];
      const hRuns = this._hyphenator.hyphenateRuns(runs);
      const { text, glyphs } = this._shaper.shapeParagraph(hRuns, fontSize);

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

      shaped.push({ text, glyphs, paraIndex: pi, hyphToOrig, origLen });
    }
    return shaped;
  }

  /**
   * Flow shaped paragraphs into a sequence of boxes, breaking lines per-box width.
   *
   * @param {{ text: string, glyphs: object[], paraIndex: number }[]} shapedParas
   * @param {{ x: number, y: number, width: number, height: number }[]} boxes
   * @param {number} fontSize
   * @param {number} lineHeightPct
   * @returns {{ box: object, lines: object[] }[]}
   */
  flowIntoBoxes(shapedParas, boxes, fontSize, lineHeightPct) {
    const padding = this._svgRenderer._padding;
    const lineHeight = fontSize * (lineHeightPct / 100);
    const paraSpacing = lineHeight * 0.5;
    const hyphenAdvance = this._measureHyphen(fontSize);

    const boxResults = boxes.map(box => ({ box, lines: [] }));
    let boxIdx = 0;
    let usedHeight = 0;

    for (const { text, glyphs, paraIndex, hyphToOrig, origLen } of shapedParas) {
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
          const available = boxes[boxIdx].height - padding * 2 - fontSize - usedHeight;

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
   * @param {{ text: string, style: object }[][]} paragraphs
   * @param {{ x: number, y: number, width: number, height: number }[]} boxes
   * @param {number} fontSize
   * @param {number} lineHeightPct
   * @returns {{ svg: SVGElement, lineMap: object[] }}
   */
  renderToContainer(container, paragraphs, boxes, fontSize, lineHeightPct) {
    const shaped = this.shapeParagraphs(paragraphs, fontSize);
    const boxResults = this.flowIntoBoxes(shaped, boxes, fontSize, lineHeightPct);
    const { svg, lineMap } = this._svgRenderer.render(boxResults, fontSize, lineHeightPct);
    container.innerHTML = '';
    container.appendChild(svg);
    return { svg, lineMap };
  }

  _measureHyphen(fontSize) {
    const glyphs = this._shaper.shapeRun('-', { bold: false, italic: false }, fontSize);
    return glyphs.length > 0 ? glyphs[0].ax : fontSize * 0.3;
  }
}
