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
 * @param {SVGSVGElement} svg
 * @param {{
 *   boxes: Box[],
 *   selectedBoxId: string|null,
 *   stories?: { boxIds: string[], overflow: boolean }[]
 * }} opts
 */
export function drawBoxOverlay(svg, { boxes, selectedBoxId, stories }) {
  let layer = svg.querySelector('[data-layer="box-overlay"]');
  if (!layer) {
    layer = document.createElementNS(SVG_NS, 'g');
    layer.setAttribute('data-layer', 'box-overlay');
    svg.appendChild(layer);
  }

  // 1. Maintain box rectangles
  let boxesG = layer.querySelector('[data-sublayer="boxes"]');
  if (!boxesG) {
    boxesG = document.createElementNS(SVG_NS, 'g');
    boxesG.setAttribute('data-sublayer', 'boxes');
    layer.appendChild(boxesG);
  }

  // Update or create box rects
  for (const box of boxes) {
    let frame = boxesG.querySelector(`[data-box-id="${box.id}"]`);
    if (!frame) {
      frame = document.createElementNS(SVG_NS, 'rect');
      frame.classList.add('box-rect');
      frame.dataset.boxId = box.id;
      frame.dataset.handle = 'body';
      frame.setAttribute('fill', 'rgba(255,255,255,0.001)');
      frame.setAttribute('vector-effect', 'non-scaling-stroke');
      boxesG.appendChild(frame);
    }
    frame.setAttribute('x', String(box.x));
    frame.setAttribute('y', String(box.y));
    frame.setAttribute('width', String(box.width));
    frame.setAttribute('height', String(box.height));
    frame.setAttribute('stroke', box.id === selectedBoxId ? '#2f6ea4' : '#7b7568');
    frame.setAttribute('stroke-width', box.id === selectedBoxId ? '1.8' : '1.1');
    frame.setAttribute('stroke-dasharray', box.id === selectedBoxId ? '5 3' : '4 4');
  }

  // Remove any frames for boxes that no longer exist
  const currentIds = new Set(boxes.map(b => b.id));
  boxesG.querySelectorAll('.box-rect').forEach(frame => {
    if (!currentIds.has(frame.dataset.boxId)) frame.remove();
  });

  // 2. Maintain handles (can be destructive as they are only for selection)
  let handlesG = layer.querySelector('[data-sublayer="handles"]');
  if (handlesG) handlesG.remove();

  const selected = boxes.find((box) => box.id === selectedBoxId);
  if (selected) {
    handlesG = document.createElementNS(SVG_NS, 'g');
    handlesG.setAttribute('data-sublayer', 'handles');
    layer.appendChild(handlesG);

    for (const handle of HANDLES) {
      const pos = handlePosition(selected, handle);
      const grip = document.createElementNS(SVG_NS, 'rect');
      grip.setAttribute('x', String(pos.x - HANDLE_SIZE / 2));
      grip.setAttribute('y', String(pos.y - HANDLE_SIZE / 2));
      grip.setAttribute('width', String(HANDLE_SIZE));
      grip.setAttribute('height', String(HANDLE_SIZE));
      grip.setAttribute('rx', '2');
      grip.setAttribute('ry', '2');
      grip.setAttribute('fill', '#fffef8');
      grip.setAttribute('stroke', '#2f6ea4');
      grip.setAttribute('stroke-width', '1.3');
      grip.setAttribute('vector-effect', 'non-scaling-stroke');
      grip.style.cursor = HANDLE_CURSOR[handle];
      grip.dataset.boxId = selected.id;
      grip.dataset.handle = handle;
      handlesG.appendChild(grip);
    }
  }

  // 3. Draw text frame ports and overflow indicators
  _drawPorts(layer, boxes, stories);
}

/**
 * Render input/output ports and overflow markers for text frame chains.
 *
 * Each text box shows:
 *   - Input port (top-left): empty triangle if first in chain, filled if
 *     it receives overflow from a predecessor.
 *   - Output port (bottom-right): filled triangle if text continues to the
 *     next box. If the box is the last in its chain and the story overflows,
 *     a red "+" overflow marker replaces the output port.
 *     If the box is the last and there is no overflow, show an empty triangle.
 *
 * Image boxes and boxes not belonging to any story are skipped.
 */
function _drawPorts(layer, boxes, stories) {
  // Remove previous ports layer
  let portsG = layer.querySelector('[data-sublayer="ports"]');
  if (portsG) portsG.remove();

  if (!stories || stories.length === 0) return;

  portsG = document.createElementNS(SVG_NS, 'g');
  portsG.setAttribute('data-sublayer', 'ports');
  layer.appendChild(portsG);

  // Build a lookup: boxId -> { storyIdx, posInChain, chainLength, overflow }
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
    if (!info) continue; // image box or unassigned

    const isFirst = info.posInChain === 0;
    const isLast = info.posInChain === info.chainLength - 1;
    const hasNext = !isLast;
    const hasPrev = !isFirst;

    // --- Input port (top-left) ---
    _drawInputPort(portsG, box, hasPrev);

    // --- Output port (bottom-right) ---
    if (isLast && info.overflow) {
      _drawOverflowMarker(portsG, box);
    } else {
      _drawOutputPort(portsG, box, hasNext);
    }
  }
}

/**
 * Draw an input port triangle at top-left of the box.
 * Filled if the box receives text from a predecessor, outline-only otherwise.
 */
function _drawInputPort(parent, box, filled) {
  const x = box.x + PORT_INSET;
  const y = box.y + PORT_INSET;
  const s = PORT_SIZE;

  // Triangle pointing right: left edge is the base
  const points = `${x},${y} ${x + s},${y + s / 2} ${x},${y + s}`;
  const tri = document.createElementNS(SVG_NS, 'polygon');
  tri.setAttribute('points', points);
  tri.setAttribute('fill', filled ? '#7b9fc4' : 'none');
  tri.setAttribute('stroke', '#7b9fc4');
  tri.setAttribute('stroke-width', '1');
  tri.setAttribute('vector-effect', 'non-scaling-stroke');
  tri.setAttribute('data-port', 'input');
  tri.setAttribute('data-port-box', box.id);
  tri.style.pointerEvents = 'none';
  parent.appendChild(tri);
}

/**
 * Draw an output port triangle at bottom-right of the box.
 * Filled if text continues to a linked box, outline-only otherwise.
 */
function _drawOutputPort(parent, box, filled) {
  const x = box.x + box.width - PORT_INSET - PORT_SIZE;
  const y = box.y + box.height - PORT_INSET - PORT_SIZE;
  const s = PORT_SIZE;

  // Triangle pointing right: left edge is the base
  const points = `${x},${y} ${x + s},${y + s / 2} ${x},${y + s}`;
  const tri = document.createElementNS(SVG_NS, 'polygon');
  tri.setAttribute('points', points);
  tri.setAttribute('fill', filled ? '#7b9fc4' : 'none');
  tri.setAttribute('stroke', '#7b9fc4');
  tri.setAttribute('stroke-width', '1');
  tri.setAttribute('vector-effect', 'non-scaling-stroke');
  tri.setAttribute('data-port', 'output');
  tri.setAttribute('data-port-box', box.id);
  tri.style.pointerEvents = 'none';
  parent.appendChild(tri);
}

/**
 * Draw a red "+" overflow marker at bottom-right of the box,
 * indicating that text doesn't fit.
 */
function _drawOverflowMarker(parent, box) {
  const s = PORT_SIZE;
  const cx = box.x + box.width - PORT_INSET - s / 2;
  const cy = box.y + box.height - PORT_INSET - s / 2;
  const half = s / 2;

  // Background square
  const bg = document.createElementNS(SVG_NS, 'rect');
  bg.setAttribute('x', String(cx - half));
  bg.setAttribute('y', String(cy - half));
  bg.setAttribute('width', String(s));
  bg.setAttribute('height', String(s));
  bg.setAttribute('rx', '1');
  bg.setAttribute('fill', '#d44');
  bg.setAttribute('data-overflow', 'true');
  bg.setAttribute('data-port-box', box.id);
  bg.style.pointerEvents = 'none';
  parent.appendChild(bg);

  // Plus sign (two lines)
  const arm = half * 0.6;
  const hLine = document.createElementNS(SVG_NS, 'line');
  hLine.setAttribute('x1', String(cx - arm));
  hLine.setAttribute('y1', String(cy));
  hLine.setAttribute('x2', String(cx + arm));
  hLine.setAttribute('y2', String(cy));
  hLine.setAttribute('stroke', '#fff');
  hLine.setAttribute('stroke-width', '1.5');
  hLine.setAttribute('vector-effect', 'non-scaling-stroke');
  hLine.style.pointerEvents = 'none';
  parent.appendChild(hLine);

  const vLine = document.createElementNS(SVG_NS, 'line');
  vLine.setAttribute('x1', String(cx));
  vLine.setAttribute('y1', String(cy - arm));
  vLine.setAttribute('x2', String(cx));
  vLine.setAttribute('y2', String(cy + arm));
  vLine.setAttribute('stroke', '#fff');
  vLine.setAttribute('stroke-width', '1.5');
  vLine.setAttribute('vector-effect', 'non-scaling-stroke');
  vLine.style.pointerEvents = 'none';
  parent.appendChild(vLine);
}
