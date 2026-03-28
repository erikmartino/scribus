// style.js - style value helpers (opaque to most modules)

/**
 * Shared style value type.
 * Keep this as the single source of truth for style shape.
 * @typedef {{ bold?: boolean, italic?: boolean, [key: string]: unknown }} Style
 */

/**
 * Style defaults for plain text.
 * Keep style-shape knowledge centralized in this module.
 */
export const DEFAULT_STYLE = Object.freeze({ bold: false, italic: false });

/**
 * Clone a style object with defaults applied.
 * @param {Style} [style]
 * @returns {Style}
 */
export function cloneStyle(style) {
  return { ...DEFAULT_STYLE, ...(style || {}) };
}

/**
 * Shallow value equality for style objects.
 * @param {Style} a
 * @param {Style} b
 * @returns {boolean}
 */
export function styleEq(a, b) {
  const sa = cloneStyle(a);
  const sb = cloneStyle(b);
  const keys = new Set([...Object.keys(sa), ...Object.keys(sb)]);
  for (const key of keys) {
    if (sa[key] !== sb[key]) return false;
  }
  return true;
}
