/**
 * paragraph-font-style.js - Normalizes paragraph style font-family and weight/style 
 * for use with GoogleFontManager.
 */

/**
 * Normalizes a family name to a Google Fonts compatible ID.
 * @param {string} family - Family name (e.g., 'Roboto').
 * @returns {string} ID (e.g., 'roboto').
 */
export function normalizeFamilyId(family) {
  return String(family || '').toLowerCase().replace(/\s+/g, '-');
}

/**
 * Normalizes font weight and style to a variant ID.
 * @param {string|number} weight - Font weight (e.g., '400', 700).
 * @param {string} style - Font style (e.g., 'normal', 'italic').
 * @returns {string} Variant ID (e.g., 'regular', '700italic').
 */
export function normalizeVariantId(weight, style) {
  const w = String(weight || '400');
  const s = String(style || 'normal').toLowerCase();

  let v = w;
  if (w === '400') v = 'regular';
  if (s === 'italic') {
    if (v === 'regular') return 'italic';
    return v + 'italic';
  }
  return v;
}

/**
 * Normalizes a paragraph style object to find the appropriate font binary.
 * @param {GoogleFontManager} manager
 * @param {{fontFamily: string, fontWeight: string|number, fontStyle: string}} style
 * @returns {Promise<Uint8Array|null>}
 */
export async function resolveParagraphFont(manager, style) {
  const familyId = normalizeFamilyId(style.fontFamily);
  const variantId = normalizeVariantId(style.fontWeight, style.fontStyle);
  return manager.resolveFont(familyId, variantId);
}
