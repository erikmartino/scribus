// document-store.js — centralized document load/save logic
//
// Single module for all store operations.  Both the spread editor and
// story editor import from here instead of maintaining their own copies.

import { cloneStyle } from '../../story-editor/lib/style.js';
import { cloneParagraphStyle } from '../../story-editor/lib/paragraph-style.js';

// ---------------------------------------------------------------------------
// Save helpers
// ---------------------------------------------------------------------------

/**
 * Serialize an EditorState into the store's story JSON format.
 *
 * @param {string} id - Story identifier (e.g. "story-main")
 * @param {import('../../story-editor/lib/editor-state.js').EditorState} editor
 * @returns {{ id: string, paragraphs: Array }}
 */
export function serializeStory(id, editor) {
  const paragraphs = [];
  const pStyles = editor.paragraphStyles || [];

  for (let pi = 0; pi < editor.story.length; pi++) {
    const runs = editor.story[pi].map(run => ({
      text: run.text,
      style: {
        ...(run.style.bold ? { bold: true } : {}),
        ...(run.style.italic ? { italic: true } : {}),
        ...(run.style.fontFamily ? { fontFamily: run.style.fontFamily } : {}),
      },
    }));
    paragraphs.push({
      styleRef: pStyles[pi]?.styleRef || 'body',
      runs,
    });
  }

  return { id, paragraphs };
}

/**
 * PUT a JSON object to the store.
 *
 * @param {string} url - Full URL path (e.g. "/store/alice/doc/stories/story-main.json")
 * @param {object} data - JSON-serializable object
 * @returns {Promise<Response>}
 */
export function putJson(url, data) {
  return fetch(url, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data, null, 2),
  });
}

/**
 * Update the `modified` timestamp in a document's `document.json`.
 * Fetches the current file, patches the timestamp, and PUTs it back.
 * Silently succeeds if document.json is missing or unreadable.
 *
 * @param {string} docPath - Document path (e.g. "alice/brochure-q2")
 * @returns {Promise<void>}
 */
export async function updateDocTimestamp(docPath) {
  const url = `/store/${docPath}/document.json`;
  try {
    const res = await fetch(url);
    if (!res.ok) return;
    const doc = await res.json();
    doc.modified = new Date().toISOString();
    await putJson(url, doc);
  } catch { /* ignore */ }
}

// ---------------------------------------------------------------------------
// Load helpers
// ---------------------------------------------------------------------------

/**
 * Load document metadata and the recursive file listing.
 *
 * @param {string} docPath - e.g. "demo/typography-sampler"
 * @returns {Promise<{ meta: object, files: string[] }>}
 */
export async function loadDocument(docPath) {
  const [metaRes, listRes] = await Promise.all([
    fetch(`/store/${docPath}/document.json`),
    fetch(`/store/${docPath}`),
  ]);

  if (!metaRes.ok) throw new Error(`Failed to load document.json: ${metaRes.status}`);
  if (!listRes.ok) throw new Error(`Failed to list document: ${listRes.status}`);

  const meta = await metaRes.json();
  const files = await listRes.json();
  return { meta, files };
}

/**
 * Load paragraph style definitions for a document.
 * Returns a map from style id to style object.
 *
 * @param {string} docPath
 * @returns {Promise<Record<string, object>>}
 */
export async function loadParagraphStyles(docPath) {
  const styleMap = {};
  try {
    const url = `/store/${docPath}/styles/paragraph.aggregate.json`;
    const res = await fetch(url);
    if (res.ok) {
      const styles = await res.json();
      for (const s of styles) {
        styleMap[s.id] = s;
      }
    }
  } catch { /* styles are optional */ }
  return styleMap;
}

/**
 * Load character style definitions for a document.
 *
 * @param {string} docPath
 * @returns {Promise<Record<string, object>>}
 */
export async function loadCharacterStyles(docPath) {
  const styleMap = {};
  try {
    const url = `/store/${docPath}/styles/character.aggregate.json`;
    const res = await fetch(url);
    if (res.ok) {
      const styles = await res.json();
      for (const s of styles) {
        styleMap[s.id] = s;
      }
    }
  } catch { /* styles are optional */ }
  return styleMap;
}

/**
 * Load a spread definition from the store.
 *
 * @param {string} docPath
 * @param {string} spreadId - e.g. "spread-1"
 * @returns {Promise<object>}
 */
export async function loadSpread(docPath, spreadId) {
  const url = `/store/${docPath}/spreads/${spreadId}.json`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to load spread: ${res.status} ${url}`);
  return res.json();
}

/**
 * Fetch a story from the document store and convert it to editor format.
 *
 * @param {string} docPath  - e.g. "demo/typography-sampler"
 * @param {string} storyId  - e.g. "story-main"
 * @param {object} [options]
 * @param {number} [options.baseFontSize=22]
 * @param {Record<string, object>} [options.styleMap] - pre-loaded paragraph styles
 * @returns {Promise<{ story: Array, paragraphStyles: Array }>}
 */
export async function loadStoryFromStore(docPath, storyId, options = {}) {
  const baseFontSize = options.baseFontSize ?? 22;

  // Fetch the story file.
  const storyUrl = `/store/${docPath}/stories/${storyId}.json`;
  const storyRes = await fetch(storyUrl);
  if (!storyRes.ok) throw new Error(`Failed to load story: ${storyRes.status} ${storyUrl}`);
  const storyJson = await storyRes.json();

  // Use provided styleMap or fetch from the store.
  let styleMap = options.styleMap;
  if (!styleMap) {
    styleMap = await loadParagraphStyles(docPath);
  }

  // Convert store format -> editor format.
  const story = [];
  const paragraphStyles = [];

  for (const para of storyJson.paragraphs) {
    const runs = (para.runs || []).map(run => ({
      text: run.text,
      style: cloneStyle(run.style),
    }));
    story.push(runs);

    const def = styleMap[para.styleRef] || {};
    paragraphStyles.push(cloneParagraphStyle({
      styleRef: para.styleRef || 'body',
      fontSize: def.fontSize ?? baseFontSize,
      fontFamily: def.fontFamily ?? 'EB Garamond',
    }));
  }

  return { story, paragraphStyles };
}

/**
 * Load a raw story JSON from the store (without editor conversion).
 *
 * @param {string} docPath
 * @param {string} storyId
 * @returns {Promise<object>}
 */
export async function loadStoryRaw(docPath, storyId) {
  const url = `/store/${docPath}/stories/${storyId}.json`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to load story: ${res.status} ${url}`);
  return res.json();
}
