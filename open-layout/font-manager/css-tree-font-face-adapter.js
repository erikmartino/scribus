// css-tree-font-face-adapter.js - extract @font-face entries using css-tree

/**
 * Lazy-load css-tree from CDN so we integrate a maintained parser instead of
 * re-implementing CSS parsing logic.
 * @returns {Promise<any>}
 */
export async function loadCssTreeFromCdn() {
  const mod = await import('/vendor/css-tree/index.js');
  return mod.default || mod;
}

function stripQuoted(value) {
  const v = String(value || '').trim();
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
    return v.slice(1, -1);
  }
  return v;
}

function parseSrcList(srcText) {
  const out = [];
  const re = /url\(([^)]+)\)\s*(?:format\(([^)]+)\))?/g;
  let m;
  while ((m = re.exec(srcText))) {
    out.push({
      url: stripQuoted(m[1]),
      format: stripQuoted(m[2] || ''),
    });
  }
  return out;
}

export class CssTreeFontFaceAdapter {
  /**
   * @param {{ loader?: () => Promise<any> }} [options]
   */
  constructor(options = {}) {
    this._loader = options.loader || loadCssTreeFromCdn;
    this._cssTree = null;
  }

  async _getCssTree() {
    if (!this._cssTree) this._cssTree = await this._loader();
    return this._cssTree;
  }

  /**
   * @param {string} cssText
   * @returns {Promise<Array<{fontFamily: string, fontStyle: string, fontWeight: string, unicodeRange: string, src: Array<{url: string, format: string}>}>>}
   */
  async extractFontFaces(cssText) {
    const csstree = await this._getCssTree();
    const ast = csstree.parse(cssText);
    const faces = [];

    csstree.walk(ast, (node) => {
      if (node.type !== 'Atrule' || String(node.name).toLowerCase() !== 'font-face' || !node.block) return;

      const face = {
        fontFamily: '',
        fontStyle: 'normal',
        fontWeight: '400',
        unicodeRange: '',
        src: [],
      };

      csstree.walk(node.block, (decl) => {
        if (decl.type !== 'Declaration') return;
        const key = String(decl.property).toLowerCase();
        const valueText = csstree.generate(decl.value);
        if (key === 'font-family') face.fontFamily = stripQuoted(valueText);
        if (key === 'font-style') face.fontStyle = String(valueText || 'normal').trim();
        if (key === 'font-weight') face.fontWeight = String(valueText || '400').trim();
        if (key === 'unicode-range') face.unicodeRange = String(valueText || '').trim();
        if (key === 'src') face.src = parseSrcList(valueText);
      });

      if (face.fontFamily && face.src.length > 0) faces.push(face);
    });

    return faces;
  }
}
