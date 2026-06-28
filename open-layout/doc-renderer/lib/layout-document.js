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
import { emptyImagePlaceholder } from './svg-renderer.js';

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
export function sliceStory(story, paragraphStyles, lastParaIndex, lastCharIndex) {
  const slicedStory = [];
  const slicedStyles = [];
  let sliceStartOffset = 0;

  for (let pi = lastParaIndex; pi < story.length; pi++) {
    const origRuns = story[pi];
    if (pi === lastParaIndex) {
      sliceStartOffset = lastCharIndex;
      let accumulatedLen = 0;
      const newRuns = [];

      for (const run of origRuns) {
        const runLen = run.text.length;
        if (accumulatedLen + runLen <= lastCharIndex) {
          accumulatedLen += runLen;
          continue;
        }

        if (accumulatedLen < lastCharIndex && accumulatedLen + runLen > lastCharIndex) {
          const startIdx = lastCharIndex - accumulatedLen;
          newRuns.push({
            text: run.text.substring(startIdx),
            style: { ...run.style }
          });
          accumulatedLen += runLen;
          continue;
        }

        newRuns.push({
          text: run.text,
          style: { ...run.style }
        });
        accumulatedLen += runLen;
      }

      if (newRuns.length > 0) {
        newRuns.origParaIndex = pi;
        slicedStory.push(newRuns);
        slicedStyles.push(paragraphStyles[pi]);
      }
    } else {
      const newRuns = origRuns.map(r => ({ ...r }));
      newRuns.origParaIndex = pi;
      slicedStory.push(newRuns);
      slicedStyles.push(paragraphStyles[pi]);
    }
  }

  // Ensure at least one paragraph to avoid engine crashes
  if (slicedStory.length === 0) {
    const dummy = [{ text: '', style: {} }];
    dummy.origParaIndex = story.length - 1;
    slicedStory.push(dummy);
    slicedStyles.push(paragraphStyles[paragraphStyles.length - 1] || {});
  }

  return { slicedStory, slicedStyles, sliceStartOffset };
}

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
  // Pre-load styleMap and assetMeta to prevent redundant network fetches
  const { loadParagraphStyles, loadAssets } = await import('../../document-store/lib/document-store.js');
  const styleMap = await loadParagraphStyles(docPath);
  const assetMeta = await loadAssets(docPath);

  // Initialize a story cache for reuse across spreads
  const storyCache = new Map();

  const layoutOpts = {
    ...opts,
    styleMap,
    assetMeta,
    storyCache
  };

  // Discover spread IDs
  const lsRes = await fetch(`/store/${docPath}/spreads?ls`);
  let spreadIds;
  if (lsRes.ok) {
    const entries = await lsRes.json();
    spreadIds = entries
      .map(e => (typeof e === 'string' ? e : e.name))
      .filter(name => name && name.endsWith('.json'))
      .map(name => name.replace(/\.json$/, ''));
    spreadIds.sort((a, b) => {
      const numA = parseInt(a.replace(/[^\d]/g, ''), 10);
      const numB = parseInt(b.replace(/[^\d]/g, ''), 10);
      if (!isNaN(numA) && !isNaN(numB)) return numA - numB;
      return a.localeCompare(b);
    });
  } else {
    spreadIds = ['spread-1'];
  }

  const allPages = [];
  const fontFamily = engine.defaultFamily || 'EB Garamond';

  // Keep track of active story offsets
  // storyRef -> { paragraphIndex, charOffset }
  const currentOffsets = {};

  const activeSpreadId = opts.activeSpreadId;
  const layoutCache = opts.layoutCache || {};
  const activeIdx = activeSpreadId ? spreadIds.indexOf(activeSpreadId) : -1;
  const maxIdx = activeIdx !== -1 ? activeIdx : spreadIds.length - 1;

  for (let i = 0; i <= maxIdx; i++) {
    const spreadId = spreadIds[i];
    
    // Check cache
    const cached = layoutCache[spreadId];
    const startOffsetsMatch = cached && JSON.stringify(cached.startOffsets) === JSON.stringify(currentOffsets);
    
    let spreadPages, nextOffsets;
    
    if (startOffsetsMatch) {
      // Cache Hit!
      console.log(`[layoutDocument] Cache hit for ${spreadId}, skipping layout.`);
      spreadPages = cached.pages || [];
      nextOffsets = cached.nextOffsets || {};
    } else {
      // Cache Miss!
      console.log(`[layoutDocument] Cache miss for ${spreadId}, running layout.`);
      const res = await _layoutSpread(engine, docPath, spreadId, currentOffsets, layoutOpts);
      spreadPages = res.spreadPages;
      nextOffsets = res.nextOffsets;
      
      // Store in cache
      layoutCache[spreadId] = {
        startOffsets: { ...currentOffsets },
        nextOffsets: { ...nextOffsets },
        pages: spreadPages
      };
    }
    
    allPages.push(...spreadPages);

    // If there is a next spread, save nextOffsets as its flowAnchors in the store
    if (i < spreadIds.length - 1) {
      const nextSpreadId = spreadIds[i + 1];
      const nextSpreadJson = await loadSpread(docPath, nextSpreadId);
      
      const oldAnchorsStr = JSON.stringify(nextSpreadJson.flowAnchors || {});
      const newAnchorsStr = JSON.stringify(nextOffsets || {});
      
      if (oldAnchorsStr !== newAnchorsStr) {
        // Update in-memory cache starting offsets for next spread
        if (!layoutCache[nextSpreadId]) {
          layoutCache[nextSpreadId] = {};
        }
        layoutCache[nextSpreadId].startOffsets = { ...nextOffsets };
        delete layoutCache[nextSpreadId].nextOffsets; // Force recalculation of its next offsets later

        // Invalidate downstream cache entries
        for (let k = i + 1; k < spreadIds.length; k++) {
          delete layoutCache[spreadIds[k]];
        }

        if (opts.isSave) {
          console.log(`[layoutDocument] Updating ${nextSpreadId} flowAnchors in store:`, newAnchorsStr);
          nextSpreadJson.flowAnchors = nextOffsets;
          await fetch(`/store/${docPath}/spreads/${nextSpreadId}.json`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(nextSpreadJson)
          });
        }
      }
    }

    // Update currentOffsets for next spread
    Object.assign(currentOffsets, nextOffsets);
  }

  return { pages: allPages, fontFamily };
}

/**
 * Compute layout for a single spread, returning per-page layout data.
 * @private
 */
async function _layoutSpread(engine, docPath, spreadId, inheritedOffsets = {}, opts = {}) {
  const startTime = typeof performance !== 'undefined' ? performance.now() : Date.now();
  const fontSize = opts.fontSize ?? DEFAULT_LAYOUT.fontSize;
  const lineHeight = opts.lineHeight ?? DEFAULT_LAYOUT.lineHeight;

  const spreadJson = await loadSpread(docPath, spreadId);
  const styleMap = opts.styleMap || await loadParagraphStyles(docPath);

  // Load flowAnchors from spreadJson if present, fallback to inheritedOffsets
  const startOffsets = { ...inheritedOffsets, ...(spreadJson.flowAnchors || {}) };
  console.log(`[layoutSpread] ${spreadId} loaded start offsets:`, JSON.stringify(startOffsets));

  // Load asset metadata
  let assetMeta = opts.assetMeta;
  if (!assetMeta) {
    assetMeta = {};
    try {
      const aggRes = await fetch(`/store/${docPath}/assets.aggregate.json`);
      if (aggRes.ok) {
        const arr = await aggRes.json();
        for (const m of arr) if (m.id) assetMeta[m.id] = m;
      }
    } catch { /* assets are optional */ }
  }

  // Deduplicate frames by ID (to handle malformed JSON seed files with duplicate frames)
  const seenFrameIds = new Set();
  const uniqueFrames = [];
  for (const frame of (spreadJson.frames || [])) {
    if (frame.id) {
      if (seenFrameIds.has(frame.id)) continue;
      seenFrameIds.add(frame.id);
    }
    uniqueFrames.push(frame);
  }

  // Parse frames
  const textBoxes = [];
  const imageBoxes = [];
  const storyBoxMap = new Map();

  for (const frame of uniqueFrames) {
    if (frame.type === 'image') {
      let imgWidth = null;
      let imgHeight = null;
      let imageUrl;
      if (frame.assetRef) {
        const meta = assetMeta[frame.assetRef];
        if (meta && meta.preview) {
          imageUrl = `/store/${docPath}/assets/${frame.assetRef}/${meta.preview}`;
          imgWidth = meta.width;
          imgHeight = meta.height;
        } else {
          imageUrl = emptyImagePlaceholder();
        }
      } else {
        imageUrl = frame.imageUrl || emptyImagePlaceholder();
      }
      imageBoxes.push({ id: frame.id, x: frame.x, y: frame.y, width: frame.width, height: frame.height, imageUrl, assetRef: frame.assetRef, placement: frame.placement, imgWidth, imgHeight });
    } else {
      textBoxes.push({ id: frame.id, x: frame.x, y: frame.y, width: frame.width, height: frame.height });
      if (frame.storyRef) {
        if (!storyBoxMap.has(frame.storyRef)) storyBoxMap.set(frame.storyRef, []);
        storyBoxMap.get(frame.storyRef).push(frame.id);
      }
    }
  }

  // Shape + flow each story — collect boxResults (no SVG rendered)
  const boxLineMap = new Map(); // boxId -> { box, lines }
  const nextOffsets = {};

  for (const [storyRef, boxIds] of storyBoxMap.entries()) {
    const storyBoxList = boxIds
      .map(id => textBoxes.find(b => b.id === id))
      .filter(Boolean);
    if (storyBoxList.length === 0) continue;

    let storyData = opts.storyCache?.get(storyRef);
    if (!storyData) {
      storyData = await import('../../document-store/lib/document-store.js')
        .then(m => m.loadStoryFromStore(docPath, storyRef, { baseFontSize: fontSize, styleMap }));
      if (opts.storyCache) {
        opts.storyCache.set(storyRef, storyData);
      }
    }
    const { story, paragraphStyles } = storyData;

    // Apply offset slice
    const offset = startOffsets[storyRef] || { paragraphIndex: 0, charOffset: 0 };
    const { slicedStory, slicedStyles, sliceStartOffset } = sliceStory(story, paragraphStyles, offset.paragraphIndex, offset.charOffset);

    const layoutStyles = buildParagraphLayoutStyles(fontSize, slicedStyles);

    await engine.ensureFonts(slicedStory, layoutStyles);
    const shaped = engine.shapeParagraphs(slicedStory, fontSize, layoutStyles);
    const { boxResults, overflow } = engine.flowIntoBoxes(shaped, storyBoxList, fontSize, lineHeight);

    const resolved = engine.resolveLayout(boxResults, fontSize, lineHeight);
    for (const resolvedBox of resolved.textBoxes) {
      boxLineMap.set(resolvedBox.box.id ?? JSON.stringify(resolvedBox.box), resolvedBox);
    }

    // Determine nextOffset if overflow is true
    if (overflow && boxResults.length > 0) {
      let lastBoxWithLines = null;
      for (let bi = boxResults.length - 1; bi >= 0; bi--) {
        if (boxResults[bi].lines.length > 0) {
          lastBoxWithLines = boxResults[bi];
          break;
        }
      }
      
      if (lastBoxWithLines) {
        const lastLine = lastBoxWithLines.lines[lastBoxWithLines.lines.length - 1];
        const slicedPara = slicedStory[lastLine.paraIndex];
        const origParaIndex = slicedPara.origParaIndex;
        
        let origCharOffset = lastLine.endChar;
        if (lastLine.paraIndex === 0) {
          origCharOffset += sliceStartOffset;
        }
        
        if (lastLine.isLastInPara) {
          nextOffsets[storyRef] = {
            paragraphIndex: origParaIndex + 1,
            charOffset: 0
          };
        } else {
          nextOffsets[storyRef] = {
            paragraphIndex: origParaIndex,
            charOffset: origCharOffset
          };
        }
      }
    }
  }

  // Determine pages
  const spreadPages = (spreadJson.pages || [{ index: 0, label: '1' }]);
  const pageWidth = DEFAULT_LAYOUT.pageWidth;
  const pageHeight = DEFAULT_LAYOUT.pageHeight;

  const pages = spreadPages.map((page, i) => {
    const pageIndex = page.index ?? i;
    const pageX = pageIndex * pageWidth;
    const pageRect = { x: pageX, y: 0, width: pageWidth, height: pageHeight };

    // Interleaved frames for this page, preserving uniqueFrames order
    const pageFrames = [];
    const pageTextBoxes = [];
    const pageImageBoxes = [];

    for (const frame of uniqueFrames) {
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
              absX: w.absX - pageX,
              fragments: w.fragments.map(f => ({ ...f, absX: f.absX - pageX })),
              glyphData: (w.glyphData || []).map(g => ({ ...g, absX: g.absX - pageX })),
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

  const endTime = typeof performance !== 'undefined' ? performance.now() : Date.now();
  const duration = endTime - startTime;
  console.log(`[layoutSpread] ${spreadId} calculated next offsets in ${duration.toFixed(2)}ms:`, JSON.stringify(nextOffsets));
  return { spreadPages: pages, nextOffsets };
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


