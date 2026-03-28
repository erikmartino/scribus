// shaper.js — shape runs and paragraphs using HarfBuzz

export class Shaper {
  constructor(hb, fontRegistry) {
    this._hb = hb;
    this._fontRegistry = fontRegistry;
  }

  /**
   * Shape a single styled text run.
   * @param {string} text
   * @param {{ bold: boolean, italic: boolean }} style
   * @param {number} fontSize
   * @returns {object[]} array of glyph objects
   */
  shapeRun(text, style, fontSize) {
    const fk = this._fontRegistry.fontKeyForStyle(style);
    const { hbFont, upem } = this._fontRegistry.getFont(fk);
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
   * @param {{ text: string, style: object }[]} runs
   * @param {number} fontSize
   * @returns {{ text: string, glyphs: object[] }}
   */
  shapeParagraph(runs, fontSize) {
    let fullText = '';
    const allGlyphs = [];

    for (const run of runs) {
      const offset = fullText.length;
      const shaped = this.shapeRun(run.text, run.style, fontSize);
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
   * @param {{ bold: boolean, italic: boolean }} style
   * @param {number} fontSize
   * @returns {number}
   */
  measureString(text, style, fontSize) {
    const glyphs = this.shapeRun(text, style, fontSize);
    return glyphs.reduce((sum, g) => sum + g.ax, 0);
  }
}
