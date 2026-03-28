/**
 * GoogleFontManager - Dynamically resolves and loads Google Font binaries (TTF/OTF only).
 * Excludes WOFF/WOFF2 for HarfBuzz compatibility.
 * 
 * Uses Grida Fonts Mirror (CORS-friendly mirror of official API).
 */

export class GoogleFontManager {
  /**
   * @param {Object} [options]
   * @param {string} [options.apiBase] - URL for the font metadata JSON.
   * @param {Function} [options.fetch] - Custom fetch implementation.
   */
  constructor(options = {}) {
    // Grida Fonts mirror: 1.7MB, supports CORS, returns direct TTF URLs.
    this._apiBase = options.apiBase || 'https://fonts.grida.co/webfonts.json';
    this._fetch = options.fetch || globalThis.fetch.bind(globalThis);
    this._catalog = null; // Array of font objects
    this._cache = new Map(); // Map of url -> Uint8Array
    this._loading = null; // Promise for the catalog fetch
  }

  /**
   * Loads the full font catalog if not already loaded.
   * @returns {Promise<void>}
   */
  async _ensureCatalog() {
    if (this._catalog) return;
    if (this._loading) return this._loading;

    this._loading = (async () => {
      try {
        const response = await this._fetch(this._apiBase);
        if (!response.ok) throw new Error(`Failed to fetch font catalog: ${response.statusText}`);
        const data = await response.json();
        // Grida/Google API structure: { items: [...] }
        this._catalog = data.items || [];
      } finally {
        this._loading = null;
      }
    })();

    return this._loading;
  }

  /**
   * Returns a list of available font families.
   * @returns {Promise<Array<{id: string, family: string}>>}
   */
  async getFamilies() {
    await this._ensureCatalog();
    return this._catalog.map(f => ({
      id: String(f.family).toLowerCase().replace(/\s+/g, '-'),
      family: f.family
    }));
  }

  /**
   * Resolves a font family and variant to a TTF/OTF binary.
   * @param {string} familyId - The ID or name of the font family.
   * @param {string} variant - The variant (e.g., 'regular', '700italic').
   * @returns {Promise<Uint8Array|null>}
   */
  async resolveFont(familyId, variant) {
    await this._ensureCatalog();
    
    // Grida/Google API uses family name, but we normalize it for easier lookup.
    const font = this._catalog.find(f => 
      String(f.family).toLowerCase().replace(/\s+/g, '-') === familyId ||
      f.family === familyId
    );
    if (!font || !font.files) return null;

    // Use variant ID directly if it exists in the 'files' object
    const url = font.files[variant];
    if (!url) return null;

    // Filter for TTF/OTF only
    if (!url.endsWith('.ttf') && !url.endsWith('.otf')) {
      return null;
    }

    return this._fetchBinary(url);
  }

  /**
   * @param {string} url
   * @returns {Promise<Uint8Array>}
   */
  async _fetchBinary(url) {
    if (this._cache.has(url)) return this._cache.get(url);

    const response = await this._fetch(url);
    if (!response.ok) throw new Error(`Failed to fetch font binary: ${response.statusText}`);
    
    const buffer = await response.arrayBuffer();
    const uint8 = new Uint8Array(buffer);
    this._cache.set(url, uint8);
    return uint8;
  }
}
