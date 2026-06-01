// svg-generator.js — loads a document from the store and renders per-page SVGs.
//
// This module is the single source of truth for document-to-SVG rendering.
// Both the spread-editor (for interactive display) and the svg-exporter viewer
// (for print preview) import from here.

import { LayoutEngine, buildParagraphLayoutStyles } from '../../story-editor/lib/layout-engine.js';
import {
  loadSpread,
  loadStoryFromStore,
  loadParagraphStyles,
  extFromMime,
} from '../../document-store/lib/document-store.js';
import { mergeLigatureClusters, splitGlyphsIntoWords } from '../../story-editor/lib/positions.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

// ---------------------------------------------------------------------------
// Default layout constants (A4 in points — matching spread-editor-app.js)
// ---------------------------------------------------------------------------

const DEFAULT_LAYOUT = {
  pageWidth: 595.28,
  pageHeight: 841.89,
  margin: 44,
  gutter: 140,
  colGap: 18,
  fontSize: 20,
  lineHeight: 138,
};

/** Generate a simple SVG data URL as a placeholder for empty image frames. */
function _emptyImagePlaceholder() {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="150" viewBox="0 0 200 150">
    <rect width="200" height="150" fill="#e0ddd5" stroke="#b0ab9f" stroke-width="1"/>
    <line x1="0" y1="0" x2="200" y2="150" stroke="#b0ab9f" stroke-width="0.5"/>
    <line x1="200" y1="0" x2="0" y2="150" stroke="#b0ab9f" stroke-width="0.5"/>
    <text x="100" y="80" text-anchor="middle" fill="#8a857a" font-size="14" font-family="sans-serif">Image</text>
  </svg>`;
  return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Create and initialise the shared LayoutEngine.
 * Call once at app startup and reuse the returned engine.
 *
 * @returns {Promise<LayoutEngine>}
 */
export async function createLayoutEngine() {
  return LayoutEngine.create({
    hbWasmUrl: '/vendor/harfbuzzjs/hb.wasm',
    hbJsUrl: '/vendor/harfbuzzjs/hbjs.js',
    hyphenUrl: '/vendor/hyphen/en.js',
    fontUrl: '/vendor/fonts/EBGaramond.ttf',
    fontItalicUrl: '/vendor/fonts/EBGaramond-Italic.ttf',
    fontFamily: 'EB Garamond',
    reserveBottom: false,
  });
}

/**
 * @typedef {object} PageSvgResult
 * @property {number}        pageIndex — 0-based page index within the spread
 * @property {string}        label     — page label (e.g. "1")
 * @property {SVGSVGElement} svg       — fully decorated page SVG
 * @property {number}        width     — SVG width in points
 * @property {number}        height    — SVG height in points
 */

/**
 * @typedef {object} SpreadRenderResult
 * @property {string}          spreadId  — spread identifier
 * @property {PageSvgResult[]} pages     — one entry per page
 * @property {object[]}        lineMaps  — lineMap per story (for cursor/editor use)
 * @property {object[]}        stories   — rendered stories with overflow flags
 */

/**
 * Render a single spread into per-page SVGs.
 *
 * @param {LayoutEngine} engine
 * @param {string}       docPath  — e.g. "demo/typography-sampler"
 * @param {string}       spreadId — e.g. "spread-1"
 * @param {object}       [opts]
 * @param {number}       [opts.fontSize]    — base font size (points)
 * @param {number}       [opts.lineHeight]  — line-height percentage
 * @returns {Promise<SpreadRenderResult>}
 */


// ---------------------------------------------------------------------------
// layoutDocument — DOM-free layout extraction for PDF export
// ---------------------------------------------------------------------------

/**
 * @typedef {object} FragmentData
 * @property {string} text
 * @property {{ bold?: boolean, italic?: boolean, fontFamily?: string }} style
 * @property {number} x  — x offset within box (after padding)
 */

/**
 * @typedef {object} WordData
 * @property {FragmentData[]} fragments
 * @property {number}         x
 */

/**
 * @typedef {object} LineData
 * @property {WordData[]} words
 * @property {number}     y          — baseline y in page coordinates
 * @property {number}     fontSize
 * @property {string}     fontFamily
 * @property {number}     lineHeight
 * @property {boolean}    isLastInPara
 * @property {number}     paraSpacing
 */

/**
 * @typedef {object} TextBoxLayoutData
 * @property {{ x: number, y: number, width: number, height: number }} box
 * @property {LineData[]} lines
 */

/**
 * @typedef {object} ImageBoxData
 * @property {string} imageUrl
 * @property {number} x
 * @property {number} y
 * @property {number} width
 * @property {number} height
 */

/**
 * @typedef {object} PageLayoutData
 * @property {number}              pageIndex
 * @property {string}              label
 * @property {number}              width   — points
 * @property {number}              height  — points
 * @property {TextBoxLayoutData[]} textBoxes
 * @property {ImageBoxData[]}      imageBoxes
 * @property {({ type: 'text', data: TextBoxLayoutData } | { type: 'image', data: ImageBoxData, index: number })[]} frames
 */

/**
 * @typedef {object} LayoutDocResult
 * @property {PageLayoutData[]} pages
 * @property {string}           fontFamily
 */

/**
 * Compute layout for all pages in a document without creating any DOM nodes.
 * Returns plain JS objects suitable for PDF generation.
 *
 * @param {LayoutEngine} engine
 * @param {string}       docPath  — e.g. "demo/typography-sampler"
 * @param {object}       [opts]
 * @param {number}       [opts.fontSize]
 * @param {number}       [opts.lineHeight]
 * @returns {Promise<LayoutDocResult>}
 */
export async function layoutDocument(engine, docPath, opts = {}) {
  // Discover spread IDs
  const lsRes = await fetch(`/store/${docPath}/spreads?ls`);
  let spreadIds;
  if (lsRes.ok) {
    const entries = await lsRes.json();
    spreadIds = entries
      .map(e => (typeof e === 'string' ? e : e.name))
      .filter(name => name && name.endsWith('.json'))
      .map(name => name.replace(/\.json$/, ''))
      .sort();
  } else {
    spreadIds = ['spread-1'];
  }

  const allPages = [];
  const fontFamily = engine._svgRenderer._fontFamily || 'EB Garamond';

  for (const spreadId of spreadIds) {
    const spreadPages = await _layoutSpread(engine, docPath, spreadId, opts);
    allPages.push(...spreadPages);
  }

  return { pages: allPages, fontFamily };
}

/**
 * Compute layout for a single spread, returning per-page layout data.
 * @private
 */
async function _layoutSpread(engine, docPath, spreadId, opts = {}) {
  const fontSize = opts.fontSize ?? DEFAULT_LAYOUT.fontSize;
  const lineHeight = opts.lineHeight ?? DEFAULT_LAYOUT.lineHeight;

  const spreadJson = await loadSpread(docPath, spreadId);
  const styleMap = await loadParagraphStyles(docPath);

  // Load asset metadata
  let assetMeta = {};
  try {
    const aggRes = await fetch(`/store/${docPath}/assets.aggregate.json`);
    if (aggRes.ok) {
      const arr = await aggRes.json();
      for (const m of arr) if (m.id) assetMeta[m.id] = m;
    }
  } catch { /* assets are optional */ }

  // Parse frames
  const textBoxes = [];
  const imageBoxes = [];
  const storyBoxMap = new Map();

  for (const frame of (spreadJson.frames || [])) {
    if (frame.type === 'image') {
      let imageUrl;
      if (frame.assetRef) {
        const meta = assetMeta[frame.assetRef];
        if (meta && meta.preview) {
          imageUrl = `/store/${docPath}/assets/${frame.assetRef}/${meta.preview}`;
        } else {
          imageUrl = _emptyImagePlaceholder();
        }
      } else {
        imageUrl = frame.imageUrl || _emptyImagePlaceholder();
      }
      imageBoxes.push({ id: frame.id, x: frame.x, y: frame.y, width: frame.width, height: frame.height, imageUrl, assetRef: frame.assetRef });
    } else {
      textBoxes.push({ id: frame.id, x: frame.x, y: frame.y, width: frame.width, height: frame.height });
      if (frame.storyRef) {
        if (!storyBoxMap.has(frame.storyRef)) storyBoxMap.set(frame.storyRef, []);
        storyBoxMap.get(frame.storyRef).push(frame.id);
      }
    }
  }

  // Shape + flow each story — collect boxResults (no SVG rendered)
  // boxResults: { box, lines }[]
  // We accumulate all box results keyed by box id.
  const boxLineMap = new Map(); // boxId -> LineData[]

  for (const [storyRef, boxIds] of storyBoxMap.entries()) {
    const storyBoxList = boxIds
      .map(id => textBoxes.find(b => b.id === id))
      .filter(Boolean);
    if (storyBoxList.length === 0) continue;

    const { story, paragraphStyles } = await import('../../document-store/lib/document-store.js')
      .then(m => m.loadStoryFromStore(docPath, storyRef, { baseFontSize: fontSize, styleMap }));

    const layoutStyles = buildParagraphLayoutStyles(fontSize, paragraphStyles);

    await engine.ensureFonts(story, layoutStyles);
    const shaped = engine.shapeParagraphs(story, fontSize, layoutStyles);
    const { boxResults } = engine.flowIntoBoxes(shaped, storyBoxList, fontSize, lineHeight);

    const padding = engine._svgRenderer.padding ?? engine._svgRenderer._padding ?? 16;

    for (const { box, lines } of boxResults) {
      // Convert LineEntry[] -> LineData[]
      const lineDataArr = [];
      let y = box.y + padding + (lines[0]?.fontSize ?? fontSize);

      for (let i = 0; i < lines.length; i++) {
        const entry = lines[i];
        const entryFontSize = entry.fontSize ?? fontSize;
        const entryFontFamily = entry.fontFamily || engine._svgRenderer._fontFamily || 'EB Garamond';
        const lh = entry.lineHeight ?? (entryFontSize * (lineHeight / 100));
        const paraSpacing = entry.paraSpacing ?? (lh * 0.5);

        if (i > 0 && lines[i - 1].isLastInPara) y += paraSpacing;

        // Convert words (justified WordEntry[]) -> WordData[]
        // Per-glyph advances let the PDF renderer reproduce exact GPOS kerning.
        const mergedGlyphs = mergeLigatureClusters(entry.glyphs || []);
        const wordGroups = splitGlyphsIntoWords(mergedGlyphs, entry.text, entry.endChar);

        const wordDataArr = (entry.words || []).map((word, wi) => {
          const group = wordGroups[wi] || { glyphs: [], endCl: entry.endChar };
          const isLastWord = wi === (entry.words || []).length - 1;

          // Build per-glyph rendering data: {text, ax, dx, style}
          const glyphData = group.glyphs.map((g, gi) => {
            const nextCl = gi + 1 < group.glyphs.length
              ? group.glyphs[gi + 1].cl
              : group.endCl;
            const rawText = entry.text.slice(g.cl, nextCl).replace(/\u00AD/g, '');
            return { text: rawText, ax: g.ax, ay: g.ay || 0, dx: g.dx || 0, dy: g.dy || 0, style: g.style || {} };
          });

          // Add synthetic hyphen glyph for hyphenated line breaks
          if (isLastWord && entry.hyphenated && glyphData.length > 0) {
            glyphData.push({ text: '-', ax: entry.hyphenAdvance || 0, dx: 0,
              style: glyphData[glyphData.length - 1].style });
          }

          return {
            x: word.x,
            fragments: (word.fragments || []).map(frag => ({
              text: frag.text,
              style: frag.style || {},
              x: word.x,
            })),
            glyphData,
          };
        });

        lineDataArr.push({
          words: wordDataArr,
          y,
          fontSize: entryFontSize,
          fontFamily: entryFontFamily,
          lineHeight: lh,
          isLastInPara: entry.isLastInPara,
          paraSpacing,
        });

        y += lh;
      }

      boxLineMap.set(box.id ?? JSON.stringify(box), { box, lines: lineDataArr });
    }
  }

  // Determine pages
  const spreadPages = (spreadJson.pages || [{ index: 0, label: '1' }]);
  const pageWidth = DEFAULT_LAYOUT.pageWidth;
  const pageHeight = DEFAULT_LAYOUT.pageHeight;

  return spreadPages.map((page, i) => {
    const pageX = i * pageWidth;
    const pageRect = { x: pageX, y: 0, width: pageWidth, height: pageHeight };

    // Interleaved frames for this page, preserving spreadJson.frames order
    const pageFrames = [];
    const pageTextBoxes = [];
    const pageImageBoxes = [];

    for (const frame of (spreadJson.frames || [])) {
      if (!_overlapsPage(frame, pageRect)) continue;

      if (frame.type === 'image') {
        const ib = imageBoxes.find(b => b.id === frame.id);
        if (ib) {
          const pageIb = {
            imageUrl: ib.imageUrl,
            assetRef: ib.assetRef,
            x: ib.x - pageX,
            y: ib.y,
            width: ib.width,
            height: ib.height,
          };
          const index = pageImageBoxes.length;
          pageImageBoxes.push(pageIb);
          pageFrames.push({ type: 'image', data: pageIb, index });
        }
      } else {
        const bl = boxLineMap.get(frame.id);
        if (bl) {
          const { box, lines } = bl;
          const localBox = {
            x: box.x - pageX,
            y: box.y,
            width: box.width,
            height: box.height,
          };
          const localLines = lines.map(l => ({
            ...l,
            y: l.y,
            words: l.words.map(w => ({
              ...w,
              fragments: w.fragments.map(f => ({ ...f })),
            })),
          }));
          const pageTb = { box: localBox, lines: localLines };
          pageTextBoxes.push(pageTb);
          pageFrames.push({ type: 'text', data: pageTb });
        }
      }
    }

    return {
      pageIndex: i,
      label: page.label ?? String(i + 1),
      width: pageWidth,
      height: pageHeight,
      textBoxes: pageTextBoxes,
      imageBoxes: pageImageBoxes,
      frames: pageFrames,
    };
  });
}

/** Does a box overlap a page rect? */
function _overlapsPage(box, page) {
  return (
    box.x < page.x + page.width &&
    box.x + box.width > page.x &&
    box.y < page.y + page.height &&
    box.y + box.height > page.y
  );
}


