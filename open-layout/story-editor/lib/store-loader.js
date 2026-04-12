// store-loader.js — load a story from the document store
//
// Fetches a story JSON file from /store/{user}/{doc}/stories/{storyId}.json
// and converts it into the editor's internal format:
//   Story  = Run[][]   (array of paragraphs, each an array of { text, style })
//   ParagraphStyle[]   (parallel array with per-paragraph layout properties)

import { cloneStyle } from './style.js';
import { cloneParagraphStyle } from './paragraph-style.js';

/**
 * Fetch a story from the document store and convert it to editor format.
 *
 * @param {string} docPath  - e.g. "demo/typography-sampler"
 * @param {string} storyId  - e.g. "story-main"
 * @returns {Promise<{ story: import('./text-extract.js').Story,
 *                      paragraphStyles: import('./paragraph-style.js').ParagraphStyle[] }>}
 */
export async function loadStoryFromStore(docPath, storyId) {
  const baseFontSize = 22;

  // Fetch the story file.
  const storyUrl = `/store/${docPath}/stories/${storyId}.json`;
  const storyRes = await fetch(storyUrl);
  if (!storyRes.ok) throw new Error(`Failed to load story: ${storyRes.status} ${storyUrl}`);
  const storyJson = await storyRes.json();

  // Fetch paragraph style definitions so we can resolve styleRef values.
  // Uses the ?aggregate endpoint to collect all per-style JSON files in the
  // styles/paragraph/ directory into a single array.
  let styleMap = {};
  try {
    const stylesUrl = `/store/${docPath}/styles/paragraph.aggregate.json`;
    const stylesRes = await fetch(stylesUrl);
    if (stylesRes.ok) {
      const styles = await stylesRes.json();
      for (const s of styles) {
        styleMap[s.id] = s;
      }
    }
  } catch {
    // Style definitions are optional — fall back to defaults.
  }

  // Convert store format → editor format.
  const story = [];
  const paragraphStyles = [];

  for (const para of storyJson.paragraphs) {
    // Runs: store format uses { text, style } — same shape as the editor,
    // but we normalize through cloneStyle to ensure defaults are present.
    const runs = (para.runs || []).map(run => ({
      text: run.text,
      style: cloneStyle(run.style),
    }));
    story.push(runs);

    // Paragraph style: resolve the styleRef to a concrete ParagraphStyle.
    const def = styleMap[para.styleRef] || {};
    paragraphStyles.push(cloneParagraphStyle({
      fontSize: def.fontSize ?? baseFontSize,
      fontFamily: def.fontFamily ?? 'EB Garamond',
    }));
  }

  return { story, paragraphStyles };
}
