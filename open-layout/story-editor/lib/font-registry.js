// font-registry.js — load fonts, register @font-face, manage HB font objects

/**
 * @typedef {object} FontEntry
 * @property {object} hbFont  — HarfBuzz font handle
 * @property {object} hbFace  — HarfBuzz face handle
 * @property {number} upem    — units per em for this face
 */

export class FontRegistry {
  /** 
   * @param {object} hb — HarfBuzz WASM instance 
   * @param {object} [fontManager] - Optional GoogleFontManager for dynamic loading
   */
  constructor(hb, fontManager = null) {
    this._hb = hb;
    this._fontManager = fontManager;
    this._fonts = {}; // family -> variant -> FontEntry
    this._fontFaces = new Set(); // set of registered family:weight:style keys
    this._defaultFamily = '';
  }

  setDefaultFamily(family) {
    this._defaultFamily = family;
  }

  /**
   * Load a font from a URL and register variants.
   * @param {string} family
   * @param {string} url
   * @param {{ variant: string, bold?: boolean, italic?: boolean }[]} variants
   * @returns {Promise<Uint8Array>}
   */
  async loadFont(family, url, variants) {
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`Font fetch failed: ${resp.status} ${url}`);
    const buffer = await resp.arrayBuffer();
    const uint8 = new Uint8Array(buffer);

    this.registerFontBinaries(family, uint8, variants);
    return uint8;
  }

  /**
   * @param {string} family
   * @param {Uint8Array} buffer
   * @param {{ variant: string, bold?: boolean, italic?: boolean }[]} variants
   */
  registerFontBinaries(family, buffer, variants) {
    if (!this._fonts[family]) this._fonts[family] = {};

    for (const { variant, bold } of variants) {
      const blob = this._hb.createBlob(buffer);
      const face = this._hb.createFace(blob, 0);
      const font = this._hb.createFont(face);
      // If the font is a variable font, we can set variations.
      // For now, we follow the existing pattern.
      if (bold) {
        // Check if it's a variable font by looking for 'wght' axis (simplified check)
        // In this prototype, we assume the caller knows if it's variable.
        font.setVariations({ wght: 700 });
      }
      this._fonts[family][variant] = { hbFont: font, hbFace: face, upem: face.upem };
    }
  }

  /**
   * Register @font-face entries in the browser.
   * @param {string} family
   * @param {Uint8Array} buffer
   * @param {string} weight
   * @param {string} style
   */
  async registerFontFace(family, buffer, weight, style) {
    const key = `${family}:${weight}:${style}`;
    if (this._fontFaces.has(key)) return;

    const ff = new FontFace(family, buffer, { weight, style });
    await ff.load();
    document.fonts.add(ff);
    this._fontFaces.add(key);
  }

  /**
   * Get the HarfBuzz font entry.
   * @param {string} family
   * @param {string} variant
   * @returns {FontEntry|undefined}
   */
  getFont(family, variant) {
    const f = family || this._defaultFamily;
    if (!this._fonts[f]) return undefined;
    return this._fonts[f][variant];
  }

  /**
   * Derive the variant ID from a style object.
   * @param {import('./style.js').Style} style
   * @returns {string}
   */
  variantForStyle(style) {
    if (style.bold && style.italic) return 'bolditalic';
    if (style.bold) return 'bold';
    if (style.italic) return 'italic';
    return 'regular';
  }
}
