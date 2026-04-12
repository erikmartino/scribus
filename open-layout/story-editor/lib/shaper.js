// shaper.js — shape runs and paragraphs using HarfBuzz

/**
 * @typedef {import('./style.js').Style} Style
 * @typedef {import('./text-extract.js').Run} Run
 */

/**
 * A single positioned glyph produced by HarfBuzz shaping.
 * @typedef {object} Glyph
 * @property {number} gid    — glyph ID in the font
 * @property {number} cl     — cluster index (character offset into paragraph text)
 * @property {number} ax     — horizontal advance (scaled to fontSize)
 * @property {number} ay     — vertical advance
 * @property {number} dx     — horizontal offset
 * @property {number} dy     — vertical offset
 * @property {Style}  style  — style of the run this glyph belongs to
 */

export class Shaper {
  /**
   * @param {object} hb — HarfBuzz WASM instance
   * @param {import('./font-registry.js').FontRegistry} fontRegistry
   */
  constructor(hb, fontRegistry) {
    this._hb = hb;
    this._fontRegistry = fontRegistry;
  }

  /**
   * Shape a single styled text run.
   * @param {string} text
   * @param {Style} style
   * @param {number} fontSize
   * @param {string} [defaultFamily]
   * @returns {Glyph[]}
   */
  shapeRun(text, style, fontSize, defaultFamily = '') {
    const family = style.fontFamily || defaultFamily;
    const vk = this._fontRegistry.variantForStyle(style);

    // Resolve the best available variant, falling back if the exact one isn't loaded.
    const fontEntry = this._resolveFontEntry(family, vk);
    
    if (!fontEntry) {
      // No variant at all loaded for this family — return placeholder advances.
      // One entry per character so line-breaking can at least split runs.
      return Array.from(text).map((_, i) => ({
        gid: 0, cl: i, ax: fontSize * 0.5, ay: 0, dx: 0, dy: 0, style,
      }));
    }

    const { hbFont, upem } = fontEntry;
    const scale = fontSize / upem;

    const buffer = this._hb.createBuffer();
    buffer.addText(text);
    buffer.guessSegmentProperties();
    this._hb.shape(hbFont, buffer);

    const glyphs = buffer.json(hbFont);
    buffer.destroy();

    return glyphs.map(g => ({
      gid: g.g,
      cl: g.cl,
      ax: (g.ax || 0) * scale,
      ay: (g.ay || 0) * scale,
      dx: (g.dx || 0) * scale,
      dy: (g.dy || 0) * scale,
      style,
    }));
  }

  /**
   * Shape a full paragraph (array of style runs) into a unified glyph stream.
   * Cluster indices are offset per run to form a single coordinate space.
   * @param {Run[]} runs
   * @param {number} fontSize
   * @param {string} [defaultFamily]
   * @returns {{ text: string, glyphs: Glyph[] }}
   */
  shapeParagraph(runs, fontSize, defaultFamily = '') {
    let fullText = '';
    const allGlyphs = [];

    for (const run of runs) {
      const offset = fullText.length;
      const shaped = this.shapeRun(run.text, run.style, fontSize, defaultFamily);
      for (const g of shaped) {
        g.cl += offset;
        allGlyphs.push(g);
      }
      fullText += run.text;
    }

    return { text: fullText, glyphs: allGlyphs };
  }

  /**
   * Measure the advance width of a string in a given style.
   * @param {string} text
   * @param {Style} style
   * @param {number} fontSize
   * @returns {number}
   */
  measureString(text, style, fontSize) {
    const glyphs = this.shapeRun(text, style, fontSize);
    return glyphs.reduce((sum, g) => sum + g.ax, 0);
  }

  /**
   * Resolve the best available FontEntry for a family+variant, cascading
   * through less specific variants when the exact one isn't loaded.
   * @param {string} family
   * @param {string} variant
   * @returns {import('./font-registry.js').FontEntry|undefined}
   */
  _resolveFontEntry(family, variant) {
    const get = (v) => this._fontRegistry.getFont(family, v);
    if (get(variant)) return get(variant);
    // Cascade: prefer dropping bold or italic before giving up entirely.
    if (variant === 'bolditalic') {
      return get('italic') || get('bold') || get('regular');
    }
    if (variant === 'bold' || variant === 'italic') {
      return get('regular');
    }
    return undefined;
  }
}
