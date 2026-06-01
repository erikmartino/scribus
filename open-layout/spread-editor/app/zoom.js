import { drawBoxOverlay } from './box-overlay.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

/**
 * Multiply the current zoom level by the given factor.
 * @param {SpreadEditorApp} app
 * @param {number} factor - e.g. 1.1 to zoom in, 1/1.1 to zoom out
 * @param {{ x: number, y: number }} [origin] - pointer position in container-relative
 *   pixels; when provided the content under that point stays fixed after zoom.
 */
export function zoomBy(app, factor, origin) {
  const oldZoom = app._zoom;
  app._zoom = Math.max(app._zoomMin, Math.min(app._zoomMax, oldZoom * factor));
  const actualFactor = app._zoom / oldZoom;

  if (origin && actualFactor !== 1) {
    // Content pixel under origin before zoom: scrollOffset + originInViewport
    const contentX = app.container.scrollLeft + origin.x;
    const contentY = app.container.scrollTop + origin.y;
    applyZoom(app);
    // Shift scroll so the same content pixel is back under origin
    app.container.scrollLeft = contentX * actualFactor - origin.x;
    app.container.scrollTop = contentY * actualFactor - origin.y;
  } else {
    applyZoom(app);
  }
}

/**
 * Set the zoom level to fit the full spread in the container.
 */
export function zoomToFit(app) {
  const spread = app.currentSpread;
  if (!spread) return;

  const pb = spread.pasteboardRect;
  const cw = app.container.clientWidth;
  const ch = app.container.clientHeight;

  // Zoom to fit the pasteboard inside the viewport, with a 5% margin
  const zoomX = cw / pb.width;
  const zoomY = ch / pb.height;
  app._zoom = Math.max(app._zoomMin, Math.min(app._zoomMax, Math.min(zoomX, zoomY) * 0.95));

  applyZoom(app);

  // Center scroll
  const pbWidthZoom = pb.width * app._zoom;
  const pbHeightZoom = pb.height * app._zoom;
  app.container.scrollLeft = (pbWidthZoom - cw) / 2;
  app.container.scrollTop = (pbHeightZoom - ch) / 2;
}

export function applyZoom(app) {
  const svg = app._svg;
  const spread = app.currentSpread;
  if (!svg || !spread) return;

  const pb = spread.pasteboardRect;
  svg.setAttribute('width', String(pb.width * app._zoom));
  svg.setAttribute('height', String(pb.height * app._zoom));
  svg.setAttribute(
    'viewBox',
    `${pb.x} ${pb.y} ${pb.width} ${pb.height}`,
  );

  updateOverlay(app);

  const pct = Math.round(app._zoom * 100);
  app.setStatus(`${pct}%`, 'ok');
}

/**
 * Project a content-SVG coordinate to overlay-SVG coordinate.
 * The overlay is position:sticky so it stays at the container's
 * visible viewport corner. Coordinates are relative to the viewport.
 */
export function projectPoint(app, x, y) {
  const svg = app._svg;
  if (!svg) return { x: 0, y: 0 };

  const ctm = svg.getScreenCTM();
  if (!ctm) return { x: 0, y: 0 };

  const pt = new DOMPoint(x, y).matrixTransform(ctm);
  const cr = app.container.getBoundingClientRect();
  return {
    x: pt.x - cr.left,
    y: pt.y - cr.top,
  };
}

/**
 * Project a content-SVG distance (width/height) to overlay pixels.
 */
export function projectSize(app, size) {
  const svg = app._svg;
  if (!svg) return size;
  const ctm = svg.getScreenCTM();
  if (!ctm) return size;
  return size * ctm.a;
}

/**
 * Redraw the overlay SVG with current box/decoration state.
 * Called on zoom, scroll, resize, and after full update().
 */
export function updateOverlay(app) {
  const overlay = app._overlaySvg;
  const spread = app.currentSpread;
  if (!overlay || !spread) return;

  // Size the overlay to match the container's visible viewport,
  // positioned at the current scroll offset so it tracks the viewport.
  const vw = app.container.clientWidth;
  const vh = app.container.clientHeight;
  overlay.setAttribute('width', String(vw));
  overlay.setAttribute('height', String(vh));
  overlay.setAttribute('viewBox', `0 0 ${vw} ${vh}`);
  overlay.style.top = `${app.container.scrollTop}px`;
  overlay.style.left = `${app.container.scrollLeft}px`;

  // Clear previous content
  overlay.innerHTML = '';

  const project = (x, y) => projectPoint(app, x, y);
  const projectSizeFn = (s) => projectSize(app, s);

  // 1. Spread decoration (pasteboard, pages, spine, margin guides)
  decorateSpreadOverlay(app, overlay, spread, project, projectSizeFn);

  // 2. Box overlay (frames, handles, ports, link highlights)
  drawBoxOverlay(overlay, {
    boxes: [...app.boxes, ...app.imageBoxes],
    selectedBoxId: app.selectedBoxId,
    stories: app._stories.map(s => ({
      boxIds: s.boxIds,
      overflow: s.overflow || false,
    })),
    linkMode: app._linkSource,
    project,
    projectSize: projectSizeFn,
    activeCroppingMode: app.activeCroppingMode,
  });
}

/**
 * Draw margin guides into the overlay SVG using projected coordinates.
 * Only UI chrome goes here — page backgrounds stay in the content SVG.
 */
export function decorateSpreadOverlay(app, overlay, spread, project, projectSize) {
  const mg = spread.margin || 0;
  if (mg <= 0) return;

  for (const page of spread.pageRects) {
    const gTL = project(page.x + mg, page.y + mg);
    const gW = projectSize(page.width - mg * 2);
    const gH = projectSize(page.height - mg * 2);
    const guide = document.createElementNS(SVG_NS, 'rect');
    guide.setAttribute('x', String(gTL.x));
    guide.setAttribute('y', String(gTL.y));
    guide.setAttribute('width', String(gW));
    guide.setAttribute('height', String(gH));
    guide.setAttribute('fill', 'none');
    guide.setAttribute('stroke', '#b0d0f0');
    guide.setAttribute('stroke-width', '0.5');
    guide.classList.add('margin-guide');
    overlay.appendChild(guide);
  }
}
