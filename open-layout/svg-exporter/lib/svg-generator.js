// svg-generator.js — loads a document from the store and renders per-page SVGs.
//
// This module is the single source of truth for document-to-SVG rendering.
// Both the spread-editor (for interactive display) and the svg-exporter viewer
// (for print preview) import from here.

import { LayoutEngine, buildParagraphLayoutStyles } from '../../story-editor/lib/layout-engine.js';
import { SvgRenderer } from '../../story-editor/lib/svg-renderer.js';
import {
  loadSpread,
  loadStoryFromStore,
  loadParagraphStyles,
  extFromMime,
} from '../../document-store/lib/document-store.js';

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
export async function renderSpread(engine, docPath, spreadId, opts = {}) {
  const fontSize = opts.fontSize ?? DEFAULT_LAYOUT.fontSize;
  const lineHeight = opts.lineHeight ?? DEFAULT_LAYOUT.lineHeight;

  // 1. Load spread definition
  const spreadJson = await loadSpread(docPath, spreadId);

  // 2. Load paragraph styles (needed to resolve styleRefs)
  const styleMap = await loadParagraphStyles(docPath);

  // 3. Load asset metadata for image frames
  let assetMeta = {};
  try {
    const aggRes = await fetch(`/store/${docPath}/assets.aggregate.json`);
    if (aggRes.ok) {
      const arr = await aggRes.json();
      for (const m of arr) if (m.id) assetMeta[m.id] = m;
    }
  } catch { /* assets are optional */ }

  // 4. Parse frames into text boxes, image boxes, and story references
  const textBoxes = [];
  const imageBoxes = [];
  const storyBoxMap = new Map(); // storyRef -> [boxId, ...]

  for (const frame of (spreadJson.frames || [])) {
    if (frame.type === 'image') {
      let imageUrl;
      if (frame.assetRef) {
        const meta = assetMeta[frame.assetRef];
        const ext = meta ? extFromMime(meta.mime) : 'jpg';
        imageUrl = `/store/${docPath}/assets/${frame.assetRef}/${frame.assetRef}.${ext}`;
      } else {
        imageUrl = frame.imageUrl || '';
      }
      imageBoxes.push({ id: frame.id, x: frame.x, y: frame.y, width: frame.width, height: frame.height, imageUrl });
    } else {
      textBoxes.push({ id: frame.id, x: frame.x, y: frame.y, width: frame.width, height: frame.height });
      if (frame.storyRef) {
        if (!storyBoxMap.has(frame.storyRef)) storyBoxMap.set(frame.storyRef, []);
        storyBoxMap.get(frame.storyRef).push(frame.id);
      }
    }
  }

  // 5. Load and render stories
  const storyResults = [];
  let baseSvg = null;

  for (const [storyRef, boxIds] of storyBoxMap.entries()) {
    const storyBoxes = boxIds
      .map(id => textBoxes.find(b => b.id === id))
      .filter(Boolean);
    if (storyBoxes.length === 0) continue;

    const { story, paragraphStyles } = await loadStoryFromStore(docPath, storyRef, {
      baseFontSize: fontSize,
      styleMap,
    });

    const layoutStyles = buildParagraphLayoutStyles(fontSize, paragraphStyles);

    if (!baseSvg) {
      const result = await engine.renderStory(story, storyBoxes, fontSize, lineHeight, layoutStyles);
      baseSvg = result.svg;
      storyResults.push({ storyRef, lineMap: result.lineMap, overflow: result.overflow || false });
    } else {
      const result = await engine.renderStory(story, storyBoxes, fontSize, lineHeight, layoutStyles);
      storyResults.push({ storyRef, lineMap: result.lineMap, overflow: result.overflow || false });
      // Transplant text content into base SVG (skip box background rects)
      for (const child of Array.from(result.svg.childNodes)) {
        if (child.tagName === 'rect') continue;
        baseSvg.appendChild(child);
      }
    }
  }

  // If no text stories, create an empty base SVG sized to the spread
  if (!baseSvg) {
    baseSvg = document.createElementNS(SVG_NS, 'svg');
  }

  // 6. Render image boxes into the SVG
  _renderImageBoxes(baseSvg, imageBoxes);

  // 7. Determine page layout from the spread JSON
  // Pages are defined in spread.pages; fall back to page 0 only
  const spreadPages = (spreadJson.pages || [{ index: 0, label: '1' }]);
  const pageWidth = DEFAULT_LAYOUT.pageWidth;
  const pageHeight = DEFAULT_LAYOUT.pageHeight;

  // 8. Split the spread SVG into per-page SVGs
  const pages = spreadPages.map((page, i) => {
    const pageX = i * pageWidth;
    const pageSvg = _clipToPage(baseSvg, { x: pageX, y: 0, width: pageWidth, height: pageHeight });
    _decoratePageBackground(pageSvg, { x: pageX, y: 0, width: pageWidth, height: pageHeight });
    return {
      pageIndex: i,
      label: page.label ?? String(i + 1),
      svg: pageSvg,
      width: pageWidth,
      height: pageHeight,
    };
  });

  return {
    spreadId,
    pages,
    stories: storyResults,
  };
}

/**
 * Render all spreads in a document into per-page SVGs.
 *
 * @param {LayoutEngine} engine
 * @param {string}       docPath — e.g. "demo/typography-sampler"
 * @param {object}       [opts]
 * @returns {Promise<PageSvgResult[]>}  — flat list of all pages across all spreads
 */
export async function renderDocument(engine, docPath, opts = {}) {
  // Discover spread IDs from the ?ls endpoint
  const lsRes = await fetch(`/store/${docPath}/spreads?ls`);
  let spreadIds;
  if (lsRes.ok) {
    const entries = await lsRes.json();
    // Server returns either an array of strings or array of { name, isDir } objects
    spreadIds = entries
      .map(e => (typeof e === 'string' ? e : e.name))
      .filter(name => name && name.endsWith('.json'))
      .map(name => name.replace(/\.json$/, ''))
      .sort();
  } else {
    // Fallback: assume single spread
    spreadIds = ['spread-1'];
  }

  const allPages = [];
  for (const spreadId of spreadIds) {
    const result = await renderSpread(engine, docPath, spreadId, opts);
    allPages.push(...result.pages);
  }
  return allPages;
}

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
        const ext = meta ? extFromMime(meta.mime) : 'jpg';
        imageUrl = `/store/${docPath}/assets/${frame.assetRef}/${frame.assetRef}.${ext}`;
      } else {
        imageUrl = frame.imageUrl || '';
      }
      imageBoxes.push({ id: frame.id, x: frame.x, y: frame.y, width: frame.width, height: frame.height, imageUrl });
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
        const wordDataArr = (entry.words || []).map(word => ({
          x: word.x,
          fragments: (word.fragments || []).map(frag => ({
            text: frag.text,
            style: frag.style || {},
            x: word.x,
          })),
        }));

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

    // Text boxes that overlap this page
    const pageTextBoxes = [];
    for (const { box, lines } of boxLineMap.values()) {
      if (_overlapsPage(box, pageRect)) {
        // Translate box and line y-coordinates to page-local space
        const localBox = {
          x: box.x - pageX,
          y: box.y,
          width: box.width,
          height: box.height,
        };
        const localLines = lines.map(l => ({
          ...l,
          y: l.y, // y is already spread-space; caller does pdf_y = pageHeight - l.y
          words: l.words.map(w => ({
            ...w,
            fragments: w.fragments.map(f => ({
              ...f,
              // x is word.x (relative to box interior, after padding),
              // absolute page x = localBox.x + padding + w.x
            })),
          })),
        }));
        pageTextBoxes.push({ box: localBox, lines: localLines });
      }
    }

    // Image boxes that overlap this page
    const pageImageBoxes = imageBoxes
      .filter(ib => _overlapsPage(ib, pageRect))
      .map(ib => ({
        imageUrl: ib.imageUrl,
        x: ib.x - pageX,
        y: ib.y,
        width: ib.width,
        height: ib.height,
      }));

    return {
      pageIndex: i,
      label: page.label ?? String(i + 1),
      width: pageWidth,
      height: pageHeight,
      textBoxes: pageTextBoxes,
      imageBoxes: pageImageBoxes,
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

// ---------------------------------------------------------------------------
// Spread decoration helpers (pure functions, no side-effects on the document)
// ---------------------------------------------------------------------------

/**
 * Decorate a page SVG with a white background and a thin border.
 * Elements are prepended so they appear behind text content.
 *
 * @param {SVGSVGElement} svg
 * @param {{ x: number, y: number, width: number, height: number }} pageRect
 */
export function decorateSpreadForEditor(svg, spread) {
  const firstContent = svg.firstChild;

  const _prepend = (el) => svg.insertBefore(el, firstContent);
  const _rect = (attrs) => {
    const r = document.createElementNS(SVG_NS, 'rect');
    for (const [k, v] of Object.entries(attrs)) r.setAttribute(k, String(v));
    return r;
  };

  // Pasteboard
  _prepend(_rect({ x: spread.pasteboardRect.x, y: spread.pasteboardRect.y, width: spread.pasteboardRect.width, height: spread.pasteboardRect.height, fill: '#ccc8bc' }));

  // Spread shadow
  _prepend(_rect({ x: spread.spreadRect.x, y: spread.spreadRect.y, width: spread.spreadRect.width, height: spread.spreadRect.height, fill: '#e9e3d6', stroke: '#b9b09f', 'stroke-width': '1.2' }));

  // Pages (white)
  for (const page of spread.pageRects) {
    _prepend(_rect({ x: page.x, y: page.y, width: page.width, height: page.height, fill: '#ffffff', stroke: '#c7c1b5', 'stroke-width': '1.2' }));
  }

  // Spine
  const spineX = spread.spreadRect.x + spread.spreadRect.width / 2;
  const spine = document.createElementNS(SVG_NS, 'line');
  spine.setAttribute('x1', String(spineX)); spine.setAttribute('y1', String(spread.spreadRect.y));
  spine.setAttribute('x2', String(spineX)); spine.setAttribute('y2', String(spread.spreadRect.y + spread.spreadRect.height));
  spine.setAttribute('stroke', '#aba18d'); spine.setAttribute('stroke-width', '1'); spine.setAttribute('stroke-dasharray', '4 4');
  svg.insertBefore(spine, firstContent);
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function _renderImageBoxes(svg, imageBoxes) {
  const prev = svg.querySelector('[data-layer="image-boxes"]');
  if (prev) prev.remove();
  if (imageBoxes.length === 0) return;

  const g = document.createElementNS(SVG_NS, 'g');
  g.setAttribute('data-layer', 'image-boxes');
  svg.appendChild(g);

  for (const box of imageBoxes) {
    const imgEl = document.createElementNS(SVG_NS, 'image');
    imgEl.setAttribute('href', box.imageUrl);
    imgEl.setAttribute('x', String(box.x));
    imgEl.setAttribute('y', String(box.y));
    imgEl.setAttribute('width', String(box.width));
    imgEl.setAttribute('height', String(box.height));
    imgEl.setAttribute('pointer-events', 'none');
    g.appendChild(imgEl);
  }
}

/**
 * Extract elements belonging to a specific page rectangle from a spread SVG,
 * returning a new self-contained SVG whose viewBox is the page rect.
 */
function _clipToPage(spreadSvg, pageRect) {
  const { x: px, y: py, width: pw, height: ph } = pageRect;

  const pageSvg = document.createElementNS(SVG_NS, 'svg');
  pageSvg.setAttribute('viewBox', `${px} ${py} ${pw} ${ph}`);
  pageSvg.setAttribute('width', String(pw));
  pageSvg.setAttribute('height', String(ph));
  pageSvg.setAttribute('xmlns', SVG_NS);

  // Clone all children from the spread SVG into the page SVG.
  // The viewBox clip will naturally hide content outside the page rect.
  for (const child of Array.from(spreadSvg.childNodes)) {
    pageSvg.appendChild(child.cloneNode(true));
  }

  return pageSvg;
}

/**
 * Decorate a single page SVG with a white background (for standalone print view).
 */
function _decoratePageBackground(pageSvg, pageRect) {
  const { x, y, width, height } = pageRect;
  const bg = document.createElementNS(SVG_NS, 'rect');
  bg.setAttribute('x', String(x));
  bg.setAttribute('y', String(y));
  bg.setAttribute('width', String(width));
  bg.setAttribute('height', String(height));
  bg.setAttribute('fill', '#ffffff');
  pageSvg.insertBefore(bg, pageSvg.firstChild);
}
