const SVG_NS = 'http://www.w3.org/2000/svg';
const HANDLE_SIZE = 10;
const PORT_SIZE = 10;
const PORT_INSET = 4;

const HANDLES = [
  'nw', 'n', 'ne',
  'w',        'e',
  'sw', 's', 'se',
];

const HANDLE_CURSOR = {
  nw: 'nwse-resize',
  se: 'nwse-resize',
  ne: 'nesw-resize',
  sw: 'nesw-resize',
  n: 'ns-resize',
  s: 'ns-resize',
  e: 'ew-resize',
  w: 'ew-resize',
};

function handlePosition(box, handle) {
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  if (handle === 'nw') return { x: box.x, y: box.y };
  if (handle === 'n') return { x: cx, y: box.y };
  if (handle === 'ne') return { x: box.x + box.width, y: box.y };
  if (handle === 'w') return { x: box.x, y: cy };
  if (handle === 'e') return { x: box.x + box.width, y: cy };
  if (handle === 'sw') return { x: box.x, y: box.y + box.height };
  if (handle === 's') return { x: cx, y: box.y + box.height };
  return { x: box.x + box.width, y: box.y + box.height };
}

/**
 * Draw the box overlay into an overlay SVG using projected screen coordinates.
 *
 * All geometry is drawn in overlay (screen-pixel) space. The `project` and
 * `projectSize` callbacks convert content-SVG coordinates to overlay-SVG
 * coordinates so handles, ports, and box frames stay at constant screen size
 * regardless of zoom.
 *
 * @param {SVGSVGElement} overlaySvg
 * @param {{
 *   boxes: Box[],
 *   selectedBoxId: string|null,
 *   stories?: { boxIds: string[], overflow: boolean }[],
 *   linkMode?: { sourceBoxId: string } | null,
 *   project: (x: number, y: number) => { x: number, y: number },
 *   projectSize: (size: number) => number,
 * }} opts
 */
export function drawBoxOverlay(overlaySvg, { boxes, selectedBoxId, stories, linkMode, project, projectSize }) {
  // Full redraw every time (overlay is cheap, no incremental diffing needed)
  let layer = overlaySvg.querySelector('[data-layer="box-overlay"]');
  if (layer) layer.remove();

  layer = document.createElementNS(SVG_NS, 'g');
  layer.setAttribute('data-layer', 'box-overlay');
  overlaySvg.appendChild(layer);

  // 1. Box frame rectangles
  const boxesG = document.createElementNS(SVG_NS, 'g');
  boxesG.setAttribute('data-sublayer', 'boxes');
  layer.appendChild(boxesG);

  for (const box of boxes) {
    const tl = project(box.x, box.y);
    const w = projectSize(box.width);
    const h = projectSize(box.height);

    const frame = document.createElementNS(SVG_NS, 'rect');
    frame.classList.add('box-rect');
    frame.dataset.boxId = box.id;
    frame.dataset.handle = 'body';
    frame.setAttribute('x', String(tl.x));
    frame.setAttribute('y', String(tl.y));
    frame.setAttribute('width', String(w));
    frame.setAttribute('height', String(h));
    frame.setAttribute('fill', 'rgba(255,255,255,0.001)');
    frame.setAttribute('stroke', box.id === selectedBoxId ? '#2f6ea4' : '#7b7568');
    frame.setAttribute('stroke-width', box.id === selectedBoxId ? '1.8' : '1.1');
    frame.setAttribute('stroke-dasharray', box.id === selectedBoxId ? '5 3' : '4 4');
    boxesG.appendChild(frame);
  }

  // 2. Resize handles for selected box
  const selected = boxes.find((box) => box.id === selectedBoxId);
  if (selected) {
    const handlesG = document.createElementNS(SVG_NS, 'g');
    handlesG.setAttribute('data-sublayer', 'handles');
    layer.appendChild(handlesG);

    for (const handle of HANDLES) {
      const pos = handlePosition(selected, handle);
      const sp = project(pos.x, pos.y);
      const grip = document.createElementNS(SVG_NS, 'rect');
      grip.setAttribute('x', String(sp.x - HANDLE_SIZE / 2));
      grip.setAttribute('y', String(sp.y - HANDLE_SIZE / 2));
      grip.setAttribute('width', String(HANDLE_SIZE));
      grip.setAttribute('height', String(HANDLE_SIZE));
      grip.setAttribute('rx', '2');
      grip.setAttribute('ry', '2');
      grip.setAttribute('fill', '#fffef8');
      grip.setAttribute('stroke', '#2f6ea4');
      grip.setAttribute('stroke-width', '1.3');
      grip.style.cursor = HANDLE_CURSOR[handle];
      grip.dataset.boxId = selected.id;
      grip.dataset.handle = handle;
      handlesG.appendChild(grip);
    }
  }

  // 3. Text frame ports and overflow indicators
  _drawPorts(layer, boxes, stories, project);

  // 4. Link mode visual feedback
  _drawLinkModeOverlay(layer, boxes, stories, linkMode, project, projectSize);
}

// ---------------------------------------------------------------------------
// Ports
// ---------------------------------------------------------------------------

function _drawPorts(layer, boxes, stories, project) {
  if (!stories || stories.length === 0) return;

  const portsG = document.createElementNS(SVG_NS, 'g');
  portsG.setAttribute('data-sublayer', 'ports');
  layer.appendChild(portsG);

  const boxInfo = new Map();
  for (let si = 0; si < stories.length; si++) {
    const story = stories[si];
    for (let pi = 0; pi < story.boxIds.length; pi++) {
      boxInfo.set(story.boxIds[pi], {
        posInChain: pi,
        chainLength: story.boxIds.length,
        overflow: story.overflow,
      });
    }
  }

  for (const box of boxes) {
    const info = boxInfo.get(box.id);
    if (!info) continue;

    const isFirst = info.posInChain === 0;
    const isLast = info.posInChain === info.chainLength - 1;

    _drawInputPort(portsG, box, !isFirst, project);
    if (isLast && info.overflow) {
      _drawOverflowMarker(portsG, box, project);
    } else {
      _drawOutputPort(portsG, box, !isLast, project);
    }
  }
}

function _drawInputPort(parent, box, filled, project) {
  const p = project(box.x + PORT_INSET, box.y + PORT_INSET);
  const s = PORT_SIZE;

  const points = `${p.x},${p.y} ${p.x + s},${p.y + s / 2} ${p.x},${p.y + s}`;
  const tri = document.createElementNS(SVG_NS, 'polygon');
  tri.setAttribute('points', points);
  tri.setAttribute('fill', filled ? '#7b9fc4' : 'none');
  tri.setAttribute('stroke', '#7b9fc4');
  tri.setAttribute('stroke-width', '1');
  tri.setAttribute('data-port', 'input');
  tri.setAttribute('data-port-box', box.id);
  tri.style.pointerEvents = 'none';
  parent.appendChild(tri);
}

function _drawOutputPort(parent, box, filled, project) {
  const p = project(
    box.x + box.width - PORT_INSET - PORT_SIZE,
    box.y + box.height - PORT_INSET - PORT_SIZE,
  );
  const s = PORT_SIZE;

  const points = `${p.x},${p.y} ${p.x + s},${p.y + s / 2} ${p.x},${p.y + s}`;
  const tri = document.createElementNS(SVG_NS, 'polygon');
  tri.setAttribute('points', points);
  tri.setAttribute('fill', filled ? '#7b9fc4' : 'none');
  tri.setAttribute('stroke', '#7b9fc4');
  tri.setAttribute('stroke-width', '1');
  tri.setAttribute('data-port', 'output');
  tri.setAttribute('data-port-box', box.id);
  tri.style.pointerEvents = 'auto';
  tri.style.cursor = 'pointer';
  parent.appendChild(tri);
}

function _drawOverflowMarker(parent, box, project) {
  const s = PORT_SIZE;
  const c = project(
    box.x + box.width - PORT_INSET - s / 2,
    box.y + box.height - PORT_INSET - s / 2,
  );
  const half = s / 2;

  const bg = document.createElementNS(SVG_NS, 'rect');
  bg.setAttribute('x', String(c.x - half));
  bg.setAttribute('y', String(c.y - half));
  bg.setAttribute('width', String(s));
  bg.setAttribute('height', String(s));
  bg.setAttribute('rx', '1');
  bg.setAttribute('fill', '#d44');
  bg.setAttribute('data-overflow', 'true');
  bg.setAttribute('data-port-box', box.id);
  bg.style.pointerEvents = 'auto';
  bg.style.cursor = 'pointer';
  parent.appendChild(bg);

  const arm = half * 0.6;
  const hLine = document.createElementNS(SVG_NS, 'line');
  hLine.setAttribute('x1', String(c.x - arm));
  hLine.setAttribute('y1', String(c.y));
  hLine.setAttribute('x2', String(c.x + arm));
  hLine.setAttribute('y2', String(c.y));
  hLine.setAttribute('stroke', '#fff');
  hLine.setAttribute('stroke-width', '1.5');
  hLine.style.pointerEvents = 'none';
  parent.appendChild(hLine);

  const vLine = document.createElementNS(SVG_NS, 'line');
  vLine.setAttribute('x1', String(c.x));
  vLine.setAttribute('y1', String(c.y - arm));
  vLine.setAttribute('x2', String(c.x));
  vLine.setAttribute('y2', String(c.y + arm));
  vLine.setAttribute('stroke', '#fff');
  vLine.setAttribute('stroke-width', '1.5');
  vLine.style.pointerEvents = 'none';
  parent.appendChild(vLine);
}

// ---------------------------------------------------------------------------
// Link mode
// ---------------------------------------------------------------------------

function _drawLinkModeOverlay(layer, boxes, stories, linkMode, project, projectSize) {
  if (!linkMode || !stories) return;

  const sourceStory = stories.find(s => s.boxIds.includes(linkMode.sourceBoxId));
  if (!sourceStory) return;

  const sourceBoxIds = new Set(sourceStory.boxIds);
  const targetBoxIds = new Set();
  for (const story of stories) {
    if (story.boxIds.includes(linkMode.sourceBoxId)) continue;
    for (const id of story.boxIds) targetBoxIds.add(id);
  }

  const linkG = document.createElementNS(SVG_NS, 'g');
  linkG.setAttribute('data-sublayer', 'link-mode');
  layer.appendChild(linkG);

  for (const box of boxes) {
    if (box.imageUrl) continue;
    if (sourceBoxIds.has(box.id)) continue;
    if (!targetBoxIds.has(box.id)) continue;

    const tl = project(box.x, box.y);
    const w = projectSize(box.width);
    const h = projectSize(box.height);

    const highlight = document.createElementNS(SVG_NS, 'rect');
    highlight.setAttribute('x', String(tl.x));
    highlight.setAttribute('y', String(tl.y));
    highlight.setAttribute('width', String(w));
    highlight.setAttribute('height', String(h));
    highlight.setAttribute('fill', 'rgba(43, 110, 164, 0.08)');
    highlight.setAttribute('stroke', '#2b6ea4');
    highlight.setAttribute('stroke-width', '2');
    highlight.setAttribute('stroke-dasharray', '6 3');
    highlight.setAttribute('data-link-target', 'true');
    highlight.setAttribute('data-box-id', box.id);
    highlight.setAttribute('data-handle', 'body');
    highlight.style.cursor = 'cell';
    highlight.style.pointerEvents = 'auto';
    linkG.appendChild(highlight);
  }
}
