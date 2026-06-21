// svg-renderer.js — laid-out paragraphs -> SVG element with columns/boxes

/**
 * A box defining a rectangular region for text flow.
 * @typedef {object} Box
 * @property {number} x      — left edge
 * @property {number} y      — top edge
 * @property {number} width
 * @property {number} height
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

/** Generate a simple SVG data URL as a placeholder for empty image frames. */
export function emptyImagePlaceholder() {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="150" viewBox="0 0 200 150">
    <rect width="200" height="150" fill="#e0ddd5" stroke="#b0ab9f" stroke-width="1"/>
    <line x1="0" y1="0" x2="200" y2="150" stroke="#b0ab9f" stroke-width="0.5"/>
    <line x1="200" y1="0" x2="0" y2="150" stroke="#b0ab9f" stroke-width="0.5"/>
    <text x="100" y="80" text-anchor="middle" fill="#8a857a" font-size="14" font-family="sans-serif">Image</text>
  </svg>`;
  return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
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
   * Render lines into SVG elements using pre-calculated resolved layout data.
   *
   * @param {{ textBoxes: any[], lineMap: any[] }} resolvedLayout
   * @returns {{ svg: SVGSVGElement, lineMap: any[] }}
   */
  render(resolvedLayout) {
    // Compute SVG bounds from boxes
    let maxX = 0, maxY = 0;
    for (const { box } of resolvedLayout.textBoxes) {
      maxX = Math.max(maxX, box.x + box.width);
      maxY = Math.max(maxY, box.y + box.height);
    }

    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('width', String(maxX));
    svg.setAttribute('height', String(maxY));
    svg.setAttribute('viewBox', `0 0 ${maxX} ${maxY}`);

    // Draw box backgrounds
    for (const { box } of resolvedLayout.textBoxes) {
      const bg = document.createElementNS(SVG_NS, 'rect');
      bg.setAttribute('x', box.x);
      bg.setAttribute('y', box.y);
      bg.setAttribute('width', box.width);
      bg.setAttribute('height', box.height);
      bg.setAttribute('fill', 'none');
      svg.appendChild(bg);
    }

    for (const { box, lines } of resolvedLayout.textBoxes) {
      for (const line of lines) {
        if (this._useOutlines && this._fontRegistry) {
          for (const word of line.words) {
            // Draw inline images in the word (if any)
            for (const frag of word.fragments) {
              if (frag.style && frag.style.inlineImage) {
                const imgSize = line.fontSize * 3;
                const imgX = word.absX;
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
              }
            }

            // Draw glyphs
            for (const g of (word.glyphData || [])) {
              if (g.text && g.text.trim()) {
                const family = g.style.fontFamily || line.fontFamily;
                const variant = this._fontRegistry.variantForStyle(g.style);
                const fontEntry = this._fontRegistry.getFont(family, variant);

                if (fontEntry && fontEntry.hbFont) {
                  const pathData = fontEntry.hbFont.glyphToPath(g.gid);
                  if (pathData) {
                    const scale = line.fontSize / fontEntry.upem;
                    const pathEl = document.createElementNS(SVG_NS, 'path');
                    pathEl.setAttribute('d', pathData);
                    pathEl.setAttribute('fill', '#222');
                    pathEl.setAttribute('transform', `translate(${g.absX.toFixed(2)}, ${g.absY.toFixed(2)}) scale(${scale.toFixed(6)}, ${(-scale).toFixed(6)})`);
                    svg.appendChild(pathEl);
                  }
                }
              }
            }
          }
        } else {
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
                const imgX = word.absX;
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
              if (fi === 0) tspan.setAttribute('x', word.absX.toFixed(2));
              const attrs = svgAttrsForStyle(frag.style, line.fontFamily);
              for (const [k, v] of Object.entries(attrs)) tspan.setAttribute(k, v);
              tspan.textContent = frag.text;
              textEl.appendChild(tspan);
            }
          }

          svg.appendChild(textEl);
        }
      }
    }

    return { svg, lineMap: resolvedLayout.lineMap };
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
              const imgX = word.absX;
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
              tspan.setAttribute('x', word.absX.toFixed(2));
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
