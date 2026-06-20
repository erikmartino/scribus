// svg-renderer.js — laid-out paragraphs -> SVG element with columns/boxes

import { buildPositions, mergeLigatureClusters, splitGlyphsIntoWords } from '../../story-editor/lib/positions.js';

/**
 * @typedef {import('../../story-editor/lib/positions.js').CursorPosition} CursorPosition
 * @typedef {import('../../story-editor/lib/positions.js').LineEntry} LineEntry
 */

/**
 * A box defining a rectangular region for text flow.
 * @typedef {object} Box
 * @property {number} x      — left edge
 * @property {number} y      — top edge
 * @property {number} width
 * @property {number} height
 */

/**
 * A line-map entry produced by the renderer, linking a rendered line
 * back to its paragraph position and providing cursor-position data.
 * @typedef {object} LineMapEntry
 * @property {number}           lineIndex  — global index in the flat lineMap array
 * @property {number}           paraIndex  — which paragraph this line belongs to
 * @property {CursorPosition[]} positions  — per-character cursor positions
 * @property {number}           colX       — x of the containing box
 * @property {number}           boxY       — y of the containing box
 * @property {number}           boxWidth   — width of the containing box
 * @property {number}           boxHeight  — height of the containing box
 * @property {number}           y          — baseline y of this line in SVG coordinates
 */

const SVG_NS = 'http://www.w3.org/2000/svg';

/**
 * Apply SVG attributes for a character style.
 * @param {import('./style.js').Style} style
 * @param {string} [defaultFamily]
 * @returns {Record<string, string>}
 */
function svgAttrsForStyle(style, defaultFamily = '') {
  const attrs = {};
  if (style.bold) attrs['font-weight'] = 'bold';
  if (style.italic) attrs['font-style'] = 'italic';
  if (style.fontFamily) {
    attrs['font-family'] = `'${style.fontFamily}', serif`;
  } else if (defaultFamily) {
    attrs['font-family'] = `'${defaultFamily}', serif`;
  }
  if (Number.isFinite(style.fontSize)) {
    attrs['font-size'] = style.fontSize;
  }
  return attrs;
}

export function getImagePlacement(box) {
  const imgW = box.imgWidth || box.width;
  const imgH = box.imgHeight || box.height;
  const frameW = box.width;
  const frameH = box.height;

  const placement = box.placement || {};
  const fitMode = placement.fitMode || 'stretch';
  const alignH = placement.alignH || 'center';
  const alignV = placement.alignV || 'center';
  
  let w, h, x, y;

  if (fitMode === 'stretch') {
    w = frameW;
    h = frameH;
    const scaleX = placement.scaleX ?? placement.scale ?? 1.0;
    const scaleY = placement.scaleY ?? placement.scale ?? 1.0;
    const finalW = w * scaleX;
    const finalH = h * scaleY;
    const finalX = (placement.offsetX ?? 0) - (finalW - w) / 2;
    const finalY = (placement.offsetY ?? 0) - (finalH - h) / 2;
    return { w: finalW, h: finalH, x: finalX, y: finalY };
  } else if (fitMode === 'fit') {
    const s = Math.min(frameW / imgW, frameH / imgH);
    w = imgW * s;
    h = imgH * s;
    const baseTranslateX = (alignH === 'left') ? 0 : (alignH === 'right' ? (frameW - w) : (frameW - w) / 2);
    const baseTranslateY = (alignV === 'top') ? 0 : (alignV === 'bottom' ? (frameH - h) : (frameH - h) / 2);
    
    const scaleX = placement.scaleX ?? placement.scale ?? 1.0;
    const scaleY = placement.scaleY ?? placement.scale ?? 1.0;
    const finalW = w * scaleX;
    const finalH = h * scaleY;
    const finalX = baseTranslateX + (placement.offsetX ?? 0) - (finalW - w) / 2;
    const finalY = baseTranslateY + (placement.offsetY ?? 0) - (finalH - h) / 2;
    return { w: finalW, h: finalH, x: finalX, y: finalY };
  } else {
    // cover / fill
    const s = Math.max(frameW / imgW, frameH / imgH);
    w = imgW * s;
    h = imgH * s;
    const baseTranslateX = (alignH === 'left') ? 0 : (alignH === 'right' ? (frameW - w) : (frameW - w) / 2);
    const baseTranslateY = (alignV === 'top') ? 0 : (alignV === 'bottom' ? (frameH - h) : (frameH - h) / 2);

    const scaleX = placement.scaleX ?? placement.scale ?? 1.0;
    const scaleY = placement.scaleY ?? placement.scale ?? 1.0;
    const finalW = w * scaleX;
    const finalH = h * scaleY;
    const finalX = baseTranslateX + (placement.offsetX ?? 0) - (finalW - w) / 2;
    const finalY = baseTranslateY + (placement.offsetY ?? 0) - (finalH - h) / 2;
    return { w: finalW, h: finalH, x: finalX, y: finalY };
  }

  return { w, h, x, y };
}

export class SvgRenderer {
  /**
   * @param {{ fontFamily: string, padding?: number }} options
   */
  constructor({ fontFamily, padding = 0, useOutlines = false, fontRegistry = null }) {
    this._fontFamily = fontFamily;
    this._padding = padding;
    this._useOutlines = useOutlines;
    this._fontRegistry = fontRegistry;
  }

  get padding() {
    return this._padding;
  }

  /** Create a fresh SVG <text> element with standard attributes. */
  _createTextEl(y, fontSize) {
    const textEl = document.createElementNS(SVG_NS, 'text');
    textEl.setAttribute('y', y.toFixed(1));
    textEl.setAttribute('font-size', fontSize);
    textEl.setAttribute('fill', '#222');
    textEl.setAttribute('text-rendering', 'optimizeLegibility');
    textEl.setAttribute('style', 'user-select:none;pointer-events:none;font-variant-ligatures:common-ligatures;');
    return textEl;
  }

  /**
   * Render lines into arbitrarily placed boxes.
   *
   * @param {{ box: Box, lines: LineEntry[] }[]} boxResults
   *   Each entry has a `box` and `lines` (justified line entries).
   * @param {number} fontSize
   * @param {number} lineHeightPct
   * @returns {{ svg: SVGSVGElement, lineMap: LineMapEntry[] }}
   */
  render(boxResults, fontSize, lineHeightPct) {
    const defaultLineHeight = fontSize * (lineHeightPct / 100);
    const defaultParaSpacing = defaultLineHeight * 0.5;

    // Compute SVG bounds from boxes
    let maxX = 0, maxY = 0;
    for (const { box } of boxResults) {
      maxX = Math.max(maxX, box.x + box.width);
      maxY = Math.max(maxY, box.y + box.height);
    }

    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('width', String(maxX));
    svg.setAttribute('height', String(maxY));
    svg.setAttribute('viewBox', `0 0 ${maxX} ${maxY}`);

    // Draw box backgrounds
    for (const { box } of boxResults) {
      const bg = document.createElementNS(SVG_NS, 'rect');
      bg.setAttribute('x', box.x);
      bg.setAttribute('y', box.y);
      bg.setAttribute('width', box.width);
      bg.setAttribute('height', box.height);
      bg.setAttribute('fill', 'none');
      svg.appendChild(bg);
    }

    // Render lines in each box, building lineMap
    const lineMap = [];
    let globalLineIdx = 0;

    for (const { box, lines } of boxResults) {
      let y = box.y + this._padding + (lines[0]?.fontSize ? lines[0].fontSize * 0.8 : fontSize * 0.8);

      for (let i = 0; i < lines.length; i++) {
        const entry = lines[i];
        const entryFontSize = entry.fontSize ?? fontSize;
        const entryFontFamily = entry.fontFamily || this._fontFamily;
        const lineHeight = entry.lineHeight || defaultLineHeight;
        const paraSpacing = entry.paraSpacing || defaultParaSpacing;
        const { words, isLastInPara } = entry;
        if (i > 0 && lines[i - 1].isLastInPara) y += paraSpacing;

        if (this._useOutlines && this._fontRegistry) {
          const { glyphs: rawGlyphs, words, text, hyphenated } = entry;
          const glyphs = mergeLigatureClusters(rawGlyphs);
          const wordGroups = splitGlyphsIntoWords(glyphs, text, entry.endChar);

          let wx = box.x + this._padding;
          let wordIndex = 0;

          for (let wi = 0; wi < wordGroups.length; wi++) {
            const group = wordGroups[wi];

            if (group.glyphs.length > 0) {
              const word = words[wordIndex++];
              if (word) {
                wx = box.x + this._padding + word.x;
              }
            }

            // Draw inline images in the word (if any)
            if (group.glyphs.length > 0 && words[wordIndex - 1]) {
              const wordObj = words[wordIndex - 1];
              for (const frag of wordObj.fragments) {
                if (frag.style && frag.style.inlineImage) {
                  const imgSize = entryFontSize * 3;
                  const imgX = box.x + this._padding + wordObj.x;
                  const imgY = y - entryFontSize;
                  const imgEl = document.createElementNS(SVG_NS, 'image');
                  imgEl.setAttribute('href', frag.style.inlineImage);
                  imgEl.setAttribute('x', imgX.toFixed(2));
                  imgEl.setAttribute('y', imgY.toFixed(2));
                  imgEl.setAttribute('width', String(imgSize));
                  imgEl.setAttribute('height', String(imgSize));
                  imgEl.setAttribute('preserveAspectRatio', 'xMidYMid meet');
                  imgEl.setAttribute('style', 'pointer-events:none');
                  svg.appendChild(imgEl);
                }
              }
            }

            // Render each glyph in the word
            for (let gi = 0; gi < group.glyphs.length; gi++) {
              const g = group.glyphs[gi];
              const family = g.style.fontFamily || entryFontFamily;
              const variant = this._fontRegistry.variantForStyle(g.style);
              const fontEntry = this._fontRegistry.getFont(family, variant);

              if (fontEntry && fontEntry.hbFont) {
                const pathData = fontEntry.hbFont.glyphToPath(g.gid);
                if (pathData) {
                  const scale = entryFontSize / fontEntry.upem;
                  const gx = wx + g.dx;
                  const gy = y - g.dy;

                  const pathEl = document.createElementNS(SVG_NS, 'path');
                  pathEl.setAttribute('d', pathData);
                  pathEl.setAttribute('fill', '#222');
                  pathEl.setAttribute('transform', `translate(${gx.toFixed(2)}, ${gy.toFixed(2)}) scale(${scale.toFixed(6)}, ${(-scale).toFixed(6)})`);
                  svg.appendChild(pathEl);
                }
              }

              wx += g.ax;
            }

            // Spaces following this word
            if (group.spaceGlyphs.length > 0) {
              const nextWord = words[wordIndex];
              let spaceAdvance = 0;
              if (nextWord) {
                const totalGap = (box.x + this._padding + nextWord.x) - wx;
                spaceAdvance = totalGap / group.spaceGlyphs.length;
              }

              for (const sg of group.spaceGlyphs) {
                if (nextWord) {
                  wx += spaceAdvance;
                } else {
                  wx += sg.ax;
                }
              }
            }
          }

          // Render hyphen if line is hyphenated
          if (hyphenated && words.length > 0) {
            const lastGlyph = glyphs[glyphs.length - 1];
            const lastStyle = lastGlyph ? lastGlyph.style : {};
            const family = lastStyle.fontFamily || entryFontFamily;
            const variant = this._fontRegistry.variantForStyle(lastStyle);
            const fontEntry = this._fontRegistry.getFont(family, variant);

            if (fontEntry && fontEntry.hbFont) {
              const buf = this._fontRegistry._hb.createBuffer();
              buf.addText('-');
              buf.guessSegmentProperties();
              this._fontRegistry._hb.shape(fontEntry.hbFont, buf);
              const shapedHyphen = buf.json(fontEntry.hbFont);
              buf.destroy();

              if (shapedHyphen && shapedHyphen.length > 0) {
                const hGid = shapedHyphen[0].g;
                const pathData = fontEntry.hbFont.glyphToPath(hGid);
                if (pathData) {
                  const scale = entryFontSize / fontEntry.upem;
                  const gx = wx;
                  const gy = y;

                  const pathEl = document.createElementNS(SVG_NS, 'path');
                  pathEl.setAttribute('d', pathData);
                  pathEl.setAttribute('fill', '#222');
                  pathEl.setAttribute('transform', `translate(${gx.toFixed(2)}, ${gy.toFixed(2)}) scale(${scale.toFixed(6)}, ${(-scale).toFixed(6)})`);
                  svg.appendChild(pathEl);
                }
              }
            }
          }
        } else {
          let textEl = this._createTextEl(y, entryFontSize);

          for (const word of words) {
            for (let fi = 0; fi < word.fragments.length; fi++) {
              const frag = word.fragments[fi];

              // Inline image: render <image> instead of <tspan>
              if (frag.style && frag.style.inlineImage) {
                // Flush any pending text element
                if (textEl.childNodes.length > 0) {
                  svg.appendChild(textEl);
                  textEl = this._createTextEl(y, entryFontSize);
                }
                const imgSize = entryFontSize * 3;
                const imgX = box.x + this._padding + word.x;
                const imgY = y - entryFontSize;
                const imgEl = document.createElementNS(SVG_NS, 'image');
                imgEl.setAttribute('href', frag.style.inlineImage);
                imgEl.setAttribute('x', imgX.toFixed(2));
                imgEl.setAttribute('y', imgY.toFixed(2));
                imgEl.setAttribute('width', String(imgSize));
                imgEl.setAttribute('height', String(imgSize));
                imgEl.setAttribute('preserveAspectRatio', 'xMidYMid meet');
                imgEl.setAttribute('style', 'pointer-events:none');
                svg.appendChild(imgEl);
                continue;
              }

              const tspan = document.createElementNS(SVG_NS, 'tspan');
              if (fi === 0) tspan.setAttribute('x', (box.x + this._padding + word.x).toFixed(2));
              const attrs = svgAttrsForStyle(frag.style, entryFontFamily);
              for (const [k, v] of Object.entries(attrs)) tspan.setAttribute(k, v);
              tspan.textContent = frag.text;
              textEl.appendChild(tspan);
            }
          }

          svg.appendChild(textEl);
        }

        const baseX = box.x + this._padding;
        const positions = buildPositions(entry, baseX);

        lineMap.push({
          lineIndex: globalLineIdx++,
          paraIndex: entry.paraIndex,
          positions,
          colX: box.x,
          boxY: box.y,
          boxWidth: box.width,
          boxHeight: box.height,
          y,
          fontSize: entryFontSize,
        });

        y += lineHeight;
      }
    }

    return { svg, lineMap };
  }

  /**
   * Render a complete page from intermediate layout data.
   *
   * @param {import('./layout-document.js').PageLayoutData} pageData
   * @returns {SVGSVGElement}
   */
  renderPage(pageData) {
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('width', String(pageData.width));
    svg.setAttribute('height', String(pageData.height));
    svg.setAttribute('viewBox', `0 0 ${pageData.width} ${pageData.height}`);
    svg.setAttribute('xmlns', SVG_NS);

    // 1. Draw page background
    const bg = document.createElementNS(SVG_NS, 'rect');
    bg.setAttribute('x', '0');
    bg.setAttribute('y', '0');
    bg.setAttribute('width', String(pageData.width));
    bg.setAttribute('height', String(pageData.height));
    bg.setAttribute('fill', '#ffffff');
    svg.appendChild(bg);

    // 2. Draw image boxes
    if (pageData.imageBoxes && pageData.imageBoxes.length > 0) {
      const g = document.createElementNS(SVG_NS, 'g');
      g.setAttribute('data-layer', 'image-boxes');
      svg.appendChild(g);

      for (const box of pageData.imageBoxes) {
        const placement = getImagePlacement(box);
        const nested = document.createElementNS(SVG_NS, 'svg');
        nested.setAttribute('x', String(box.x));
        nested.setAttribute('y', String(box.y));
        nested.setAttribute('width', String(box.width));
        nested.setAttribute('height', String(box.height));
        nested.setAttribute('overflow', 'hidden');
        nested.setAttribute('style', 'pointer-events: none;');

        const imgEl = document.createElementNS(SVG_NS, 'image');
        imgEl.setAttribute('href', box.imageUrl);
        imgEl.setAttribute('x', String(placement.x));
        imgEl.setAttribute('y', String(placement.y));
        imgEl.setAttribute('width', String(placement.w));
        imgEl.setAttribute('height', String(placement.h));
        imgEl.setAttribute('preserveAspectRatio', 'none');
        imgEl.setAttribute('pointer-events', 'none');
        
        nested.appendChild(imgEl);
        g.appendChild(nested);
      }
    }

    // 3. Draw text boxes
    for (const { box, lines } of pageData.textBoxes) {
      for (const line of lines) {
        let textEl = this._createTextEl(line.y, line.fontSize);
        
        for (const word of line.words) {
          for (let fi = 0; fi < word.fragments.length; fi++) {
            const frag = word.fragments[fi];
            
            if (frag.style && frag.style.inlineImage) {
              if (textEl.childNodes.length > 0) {
                svg.appendChild(textEl);
                textEl = this._createTextEl(line.y, line.fontSize);
              }
              const imgSize = line.fontSize * 3;
              const imgX = box.x + this._padding + word.x;
              const imgY = line.y - line.fontSize;
              const imgEl = document.createElementNS(SVG_NS, 'image');
              imgEl.setAttribute('href', frag.style.inlineImage);
              imgEl.setAttribute('x', imgX.toFixed(2));
              imgEl.setAttribute('y', imgY.toFixed(2));
              imgEl.setAttribute('width', String(imgSize));
              imgEl.setAttribute('height', String(imgSize));
              imgEl.setAttribute('preserveAspectRatio', 'xMidYMid meet');
              imgEl.setAttribute('style', 'pointer-events:none');
              svg.appendChild(imgEl);
              continue;
            }

            const tspan = document.createElementNS(SVG_NS, 'tspan');
            if (fi === 0) {
              const absX = box.x + this._padding + word.x;
              tspan.setAttribute('x', absX.toFixed(2));
            }
            const attrs = svgAttrsForStyle(frag.style, line.fontFamily);
            for (const [k, v] of Object.entries(attrs)) tspan.setAttribute(k, v);
            tspan.textContent = frag.text;
            textEl.appendChild(tspan);
          }
        }
        svg.appendChild(textEl);
      }
    }

    return svg;
  }
}

/**
 * Decorate a page SVG with a white background and a thin border.
 * Elements are prepended so they appear behind text content.
 *
 * @param {SVGSVGElement} svg
 * @param {object} spread
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
