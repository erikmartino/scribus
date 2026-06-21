// layout-engine.js — orchestrates the full pipeline (public API)

import { FontRegistry } from './font-registry.js';
import { Shaper } from './shaper.js';
import { GoogleFontManager } from '../../font-manager/google-font-manager.js';
import { Hyphenator } from './hyphenator.js';
import { breakLines } from './line-breaker.js';
import { justifyLine } from './justifier.js';
import { SvgRenderer } from '../../doc-renderer/lib/svg-renderer.js';

export { buildPositions } from './positions.js';
export { buildParagraphLayoutStyles } from './paragraph-style-render.js';
import { buildPositions, mergeLigatureClusters, splitGlyphsIntoWords } from './positions.js';

/**
 * @typedef {import('./text-extract.js').Story} Story
 * @typedef {import('./text-extract.js').Run} Run
 * @typedef {import('./shaper.js').Glyph} Glyph
 * @typedef {import('../../doc-renderer/lib/svg-renderer.js').Box} Box
 * @typedef {import('./positions.js').LineEntry} LineEntry
 * @typedef {import('./positions.js').CursorPosition} CursorPosition
 */

/**
 * A line-map entry produced by resolveLayout, linking a rendered line
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
 * @property {number}           fontSize   — font size for this line
 */

/**
 * Shaped paragraph data ready for line breaking.
 * @typedef {object} ShapedPara
 * @property {string}   text       - full hyphenated paragraph text
 * @property {Glyph[]}  glyphs     - shaped glyph stream
 * @property {number}   paraIndex  - index into the story
 * @property {number[]} hyphToOrig - mapping from hyphenated-text index to original-text index
 * @property {number}   origLen    - length of the original (un-hyphenated) paragraph text
 * @property {number}   fontSize   - paragraph-level font size used for shaping
 * @property {string}   fontFamily - paragraph-level font family used for shaping
 * @property {number}   [lineHeightPct] - paragraph-level custom line height percentage
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
    /** @private */
    this._hb = hb;
    /** @private */
    this._fontRegistry = fontRegistry;
    /** @private */
    this._shaper = shaper;
    /** @private */
    this._hyphenator = hyphenator;
    /** @private */
    this._svgRenderer = svgRenderer;
    /** @private */
    this._shapeCache = new Map();
    /** @private */
    this._hyphenAdvanceCache = new Map();
    /** @private */
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
   *   reserveBottom?: boolean,
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
    const fontManager = new GoogleFontManager();
    const fontRegistry = new FontRegistry(hb, fontManager);
    fontRegistry.setDefaultFamily(fontFamily);

    const [regularBuf, italicBuf, hyphenModule] = await Promise.all([
      fontRegistry.loadFont(fontFamily, fontUrl, [
        { variant: 'regular', bold: false },
        { variant: 'bold', bold: true },
      ]),
      fontRegistry.loadFont(fontFamily, fontItalicUrl, [
        { variant: 'italic', bold: false },
        { variant: 'bolditalic', bold: true },
      ]),
      import(hyphenUrl),
    ]);

    // Register @font-face variants
    await Promise.all([
      fontRegistry.registerFontFace(fontFamily, regularBuf, 'normal', 'normal'),
      fontRegistry.registerFontFace(fontFamily, regularBuf, 'bold', 'normal'),
      fontRegistry.registerFontFace(fontFamily, italicBuf, 'normal', 'italic'),
      fontRegistry.registerFontFace(fontFamily, italicBuf, 'bold', 'italic'),
    ]);

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
   * Get the layout padding size.
   * @returns {number}
   */
  get padding() {
    return this._svgRenderer.padding;
  }

  /**
   * Get the default font family.
   * @returns {string}
   */
  get defaultFamily() {
    return this._svgRenderer._fontFamily;
  }

  /**
   * Get the loaded font buffers as family:variant -> Uint8Array mapping.
   * @returns {Record<string, Uint8Array>}
   */
  get fontBuffers() {
    return this._fontRegistry.buffers;
  }

  /**
   * Resolve variant for a given style.
   * @param {import('./style.js').Style} style
   * @returns {string}
   */
  variantForStyle(style) {
    return this._fontRegistry.variantForStyle(style);
  }

  /**
   * Get a font buffer by family and variant.
   * @param {string} family
   * @param {string} variant
   * @returns {Uint8Array|undefined}
   */
  getFontBuffer(family, variant) {
    return this._fontRegistry.getFontBuffer(family, variant);
  }

  /**
   * Shape a single styled text run.
   * @param {string} text
   * @param {import('./style.js').Style} style
   * @param {number} fontSize
   * @param {string} [defaultFamily]
   * @returns {import('./shaper.js').Glyph[]}
   */
  shapeRun(text, style, fontSize, defaultFamily = '') {
    return this._shaper.shapeRun(text, style, fontSize, defaultFamily);
  }

  /**
   * Shape and hyphenate paragraphs, returning shaped data ready for line breaking.
   *
   * @param {Story} runsParagraphs
   * @param {number} fontSize
   * @param {{ fontSize: number, fontFamily: string, lineHeight?: number }[]} [paragraphStyles]
   * @returns {ShapedPara[]}
   */
  shapeParagraphs(runsParagraphs, fontSize, paragraphStyles = []) {
    this._pruneShapeCache(runsParagraphs.length);

    const shaped = [];
    for (let pi = 0; pi < runsParagraphs.length; pi++) {
      const runs = runsParagraphs[pi];
      const styleFontSize = paragraphStyles[pi]?.fontSize;
      const paraFontSize = Number.isFinite(styleFontSize) ? Number(styleFontSize) : fontSize;
      const styleLineHeight = paragraphStyles[pi]?.lineHeight;
      const paraLineHeightPct = (styleLineHeight !== undefined && Number.isFinite(styleLineHeight)) ? (styleLineHeight * 100) : undefined;
      const fingerprint = this._fingerprintRuns(runs);
      const cached = this._shapeCache.get(pi);
      const defaultFamily = paragraphStyles[pi]?.fontFamily || this._svgRenderer._fontFamily;

      if (cached && cached.fontSize === paraFontSize && cached.fontFamily === defaultFamily && cached.lineHeightPct === paraLineHeightPct && cached.fingerprint === fingerprint) {
        shaped.push(cached.shapedPara);
        continue;
      }

      const hRuns = this._hyphenator.hyphenateRuns(runs);
      const { text, glyphs } = this._shaper.shapeParagraph(hRuns, paraFontSize, defaultFamily);

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

      const shapedPara = { text, glyphs, paraIndex: pi, hyphToOrig, origLen, fontSize: paraFontSize, fontFamily: defaultFamily, lineHeightPct: paraLineHeightPct };
      this._shapeCache.set(pi, { fontSize: paraFontSize, fontFamily: defaultFamily, lineHeightPct: paraLineHeightPct, fingerprint, shapedPara });
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
   * @returns {{ boxResults: { box: Box, lines: LineEntry[] }[], overflow: boolean }}
   */
  flowIntoBoxes(shapedParas, boxes, fontSize, lineHeightPct) {
    const padding = this._svgRenderer.padding ?? this._svgRenderer._padding ?? 0;
    const bottomReserve = this._reserveBottom ? fontSize : 0;

    /** @type {{ box: Box, lines: LineEntry[] }[]} */
    const boxResults = boxes.map(box => ({ box, lines: [] }));
    let boxIdx = 0;
    let usedHeight = 0;
    let overflow = false;

    for (const { text, glyphs, paraIndex, hyphToOrig, origLen, fontSize: paraFontSize, fontFamily, lineHeightPct: paraLineHeightPct } of shapedParas) {
      const effectiveFontSize = paraFontSize;
      const effectiveLineHeightPct = paraLineHeightPct ?? lineHeightPct;
      const lineHeight = effectiveFontSize * (effectiveLineHeightPct / 100);
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
            fontFamily,
            lineHeight,
            paraSpacing,
          });
          usedHeight += needed;
          break;
        }
        // If we exhausted all boxes without placing this empty paragraph
        if (boxIdx >= boxes.length) overflow = true;
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
            fontFamily,
            lineHeight,
            paraSpacing,
          });

          usedHeight += needed;
          consumed = true;
        }

        if (consumed) break; // entire paragraph placed
      }
      // If glyphs remain after exhausting all boxes, we have overflow
      if (remainingGlyphs.length > 0 && boxIdx >= boxes.length) overflow = true;
    }

    return { boxResults, overflow };
  }

  /**
   * Ensure all fonts used in the story are loaded.
   * @param {Story} paragraphs
   * @param {import('./paragraph-style.js').ParagraphStyle[]} [paragraphStyles]
   */
  async ensureFonts(paragraphs, paragraphStyles = []) {
    const families = new Set();
    const defaultFamily = this._svgRenderer._fontFamily;
    if (defaultFamily) families.add(defaultFamily);

    for (const para of paragraphs) {
      for (const run of para) {
        if (run.style.fontFamily) families.add(run.style.fontFamily);
      }
    }
    for (const style of paragraphStyles) {
      if (style.fontFamily) families.add(style.fontFamily);
    }

    const loads = [];
    for (const family of families) {
      if (!this._fontRegistry.getFont(family, 'regular')) {
        loads.push(this._loadFamily(family));
      }
    }
    await Promise.all(loads);
  }

  /**
   * @param {string} family
   */
  async _loadFamily(family) {
    if (!family || !this._fontRegistry._fontManager) return;

    // We try to load regular, bold, italic, and bold-italic variants
    const variants = [
      { id: 'regular', weight: 'normal', style: 'normal' },
      { id: 'bold', weight: 'bold', style: 'normal', variant: '700' },
      { id: 'italic', weight: 'normal', style: 'italic' },
      { id: 'bolditalic', weight: 'bold', style: 'italic', variant: '700italic' },
    ];

    const tasks = variants.map(async (v) => {
      if (this._fontRegistry.getFont(family, v.id)) return;

      try {
        const binary = await this._fontRegistry._fontManager.resolveFont(family, v.variant || v.id);
        if (binary) {
          this._fontRegistry.registerFontBinaries(family, binary, [{ variant: v.id, bold: v.weight === 'bold' }]);
          await this._fontRegistry.registerFontFace(family, binary, v.weight, v.style);
        }
      } catch (e) {
        console.warn(`Failed to load font ${family} ${v.id}:`, e);
      }
    });

    await Promise.all(tasks);
  }

  /**
   * Full pipeline: shape, flow into boxes, render to SVG.
   *
   * @param {Element} container
   * @param {Story} paragraphs
   * @param {Box[]} boxes
   * @param {number} fontSize
   * @param {number} lineHeightPct
   * @param {{ fontSize: number, fontFamily: string }[]} [paragraphStyles]
   * @returns {Promise<{ svg: SVGSVGElement, lineMap: LineMapEntry[], overflow?: boolean }>}
   */
  async renderToContainer(container, paragraphs, boxes, fontSize, lineHeightPct, paragraphStyles = []) {
    const result = await this.renderStory(paragraphs, boxes, fontSize, lineHeightPct, paragraphStyles);
    container.innerHTML = '';
    container.appendChild(result.svg);
    return result;
  }

  /**
   * Resolve layout calculations: GPOS word/glyph positioning, absolute coordinates,
   * and build the interactive cursor lineMap.
   *
   * @param {{ box: Box, lines: LineEntry[] }[]} boxResults
   * @param {number} baseFontSize
   * @param {number} baseLineHeightPct
   * @returns {{ textBoxes: any[], lineMap: LineMapEntry[] }}
   */
  resolveLayout(boxResults, baseFontSize, baseLineHeightPct) {
    const padding = this._svgRenderer.padding ?? this._svgRenderer._padding ?? 0;
    const defaultLineHeight = baseFontSize * (baseLineHeightPct / 100);
    const defaultParaSpacing = defaultLineHeight * 0.5;

    const textBoxes = [];
    const lineMap = [];
    let globalLineIdx = 0;

    for (const { box, lines } of boxResults) {
      const resolvedLines = [];
      let y = box.y + padding + (lines[0]?.fontSize ? lines[0].fontSize * 0.8 : baseFontSize * 0.8);

      for (let i = 0; i < lines.length; i++) {
        const entry = lines[i];
        const entryFontSize = entry.fontSize ?? baseFontSize;
        const entryFontFamily = entry.fontFamily || this.defaultFamily || 'EB Garamond';
        const lineHeight = entry.lineHeight || defaultLineHeight;
        const paraSpacing = entry.paraSpacing || defaultParaSpacing;
        const { words, isLastInPara, text, hyphenated, hyphenAdvance } = entry;

        if (i > 0 && lines[i - 1].isLastInPara) {
          y += paraSpacing;
        }

        const mergedGlyphs = mergeLigatureClusters(entry.glyphs || []);
        const wordGroups = splitGlyphsIntoWords(mergedGlyphs, text, entry.endChar);

        let wx = box.x + padding;
        let wordIndex = 0;
        const wordDataArr = [];

        for (let wi = 0; wi < wordGroups.length; wi++) {
          const group = wordGroups[wi];
          let absX = wx;

          if (group.glyphs.length > 0) {
            const word = words[wordIndex++];
            if (word) {
              absX = box.x + padding + word.x;
              wx = absX;
            }
          }

          // Render each glyph in the word
          const glyphData = [];
          for (let gi = 0; gi < group.glyphs.length; gi++) {
            const g = group.glyphs[gi];
            const nextCl = gi + 1 < group.glyphs.length
              ? group.glyphs[gi + 1].cl
              : group.endCl;
            const rawText = text.slice(g.cl, nextCl).replace(/\u00AD/g, '');
            const family = g.style.fontFamily || entryFontFamily;
            const variant = this.variantForStyle(g.style);
            
            glyphData.push({
              text: rawText,
              absX: wx + g.dx,
              absY: y - g.dy,
              ax: g.ax,
              ay: g.ay || 0,
              dx: g.dx || 0,
              dy: g.dy || 0,
              style: g.style || {},
              gid: g.gid,
              fontFamily: family,
              variant: variant,
            });

            wx += g.ax;
          }

          // Add synthetic hyphen glyph for hyphenated line breaks
          const isLastWord = wi === wordGroups.length - 1;
          if (isLastWord && hyphenated && glyphData.length > 0) {
            const lastGStyle = glyphData[glyphData.length - 1].style;
            const family = lastGStyle.fontFamily || entryFontFamily;
            const variant = this.variantForStyle(lastGStyle);
            glyphData.push({
              text: '-',
              absX: wx,
              absY: y,
              ax: hyphenAdvance || 0,
              dx: 0,
              dy: 0,
              style: lastGStyle,
              fontFamily: family,
              variant: variant,
            });
          }

          // Process spaces following this word
          if (group.spaceGlyphs.length > 0) {
            const nextWord = words[wordIndex];
            let spaceAdvance = 0;
            if (nextWord) {
              const totalGap = (box.x + padding + nextWord.x) - wx;
              spaceAdvance = totalGap / group.spaceGlyphs.length;
            }

            for (const sg of group.spaceGlyphs) {
              if (nextWord) {
                wx += spaceAdvance;
              } else {
                wx += sg.ax;
              }
            }
          }

          const wordObj = words[wordIndex - 1];
          wordDataArr.push({
            x: wordObj ? wordObj.x : 0,
            absX,
            fragments: (wordObj?.fragments || []).map(frag => {
              const family = frag.style.fontFamily || entryFontFamily;
              const variant = this.variantForStyle(frag.style);
              return {
                text: frag.text,
                style: frag.style || {},
                absX,
                fontFamily: family,
                variant: variant,
              };
            }),
            glyphData,
          });
        }

        resolvedLines.push({
          words: wordDataArr,
          y,
          fontSize: entryFontSize,
          fontFamily: entryFontFamily,
          lineHeight,
          isLastInPara,
          paraSpacing,
          hyphenated,
          hyphenAdvance,
          text,
          endChar: entry.endChar,
          paraIndex: entry.paraIndex,
        });

        // Compute positions for the lineMap
        const baseX = box.x + padding;
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

      textBoxes.push({
        box,
        lines: resolvedLines,
      });
    }

    return { textBoxes, lineMap };
  }

  /**
   * Shape, flow, and render a single story into its boxes, returning
   * the SVG element and lineMap without modifying any container.
   *
   * @param {Story} paragraphs
   * @param {Box[]} boxes
   * @param {number} fontSize
   * @param {number} lineHeightPct
   * @param {{ fontSize: number, fontFamily: string }[]} [paragraphStyles]
   * @returns {Promise<{ svg: SVGSVGElement, lineMap: LineMapEntry[], overflow?: boolean }>}
   */
  async renderStory(paragraphs, boxes, fontSize, lineHeightPct, paragraphStyles = []) {
    await this.ensureFonts(paragraphs, paragraphStyles);
    const shaped = this.shapeParagraphs(paragraphs, fontSize, paragraphStyles);
    const { boxResults, overflow } = this.flowIntoBoxes(shaped, boxes, fontSize, lineHeightPct);
    const resolvedLayout = this.resolveLayout(boxResults, fontSize, lineHeightPct);
    /** @type {{ svg: SVGSVGElement, lineMap: LineMapEntry[], overflow?: boolean }} */
    const result = this._svgRenderer.render(resolvedLayout);
    result.overflow = overflow;
    return result;
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


