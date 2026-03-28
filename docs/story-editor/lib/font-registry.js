// font-registry.js — load fonts, register @font-face, manage HB font objects

/**
 * @typedef {object} FontEntry
 * @property {object} hbFont  — HarfBuzz font handle
 * @property {object} hbFace  — HarfBuzz face handle
 * @property {number} upem    — units per em for this face
 */

export class FontRegistry {
  /** @param {object} hb — HarfBuzz WASM instance */
  constructor(hb) {
    this._hb = hb;
    this._fonts = {};
    this._fontFaces = [];
  }

  /**
   * Load a font from a URL and register variants (e.g. regular + bold from same variable font).
   * @param {string} url
   * @param {{ key: string, bold: boolean }[]} variants
   * @returns {Promise<ArrayBuffer>}
   */
  async loadFont(url, variants) {
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`Font fetch failed: ${resp.status} ${url}`);
    const buffer = await resp.arrayBuffer();

    for (const { key, bold } of variants) {
      const blob = this._hb.createBlob(buffer);
      const face = this._hb.createFace(blob, 0);
      const font = this._hb.createFont(face);
      if (bold) font.setVariations({ wght: 700 });
      this._fonts[key] = { hbFont: font, hbFace: face, upem: face.upem };
    }

    return buffer;
  }

  /**
   * Register @font-face entries from raw buffers.
   * @param {{ buffer: ArrayBuffer, style: string, weight: string }[]} entries
   * @param {string} fontFamily
   * @returns {Promise<void>}
   */
  async registerFontFaces(entries, fontFamily) {
    for (const { buffer, style, weight } of entries) {
      const ff = new FontFace(fontFamily, buffer, { style, weight });
      await ff.load();
      document.fonts.add(ff);
      this._fontFaces.push(ff);
    }
  }

  /**
   * Get the HarfBuzz font/face/upem for a style key.
   * @param {"regular"|"bold"|"italic"|"bolditalic"} styleKey
   * @returns {FontEntry|undefined}
   */
  getFont(styleKey) {
    return this._fonts[styleKey];
  }

  /**
   * Derive the style key from a style object.
   * @param {import('./text-extract.js').Style} style
   * @returns {"regular"|"bold"|"italic"|"bolditalic"}
   */
  fontKeyForStyle(style) {
    if (style.bold && style.italic) return 'bolditalic';
    if (style.bold) return 'bold';
    if (style.italic) return 'italic';
    return 'regular';
  }
}
