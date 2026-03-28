const SVG_NS = 'http://www.w3.org/2000/svg';
const HANDLE_SIZE = 10;

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

export function drawBoxOverlay(svg, { boxes, selectedBoxId }) {
  const layer = document.createElementNS(SVG_NS, 'g');
  layer.setAttribute('data-layer', 'box-overlay');

  for (const box of boxes) {
    const frame = document.createElementNS(SVG_NS, 'rect');
    frame.setAttribute('x', String(box.x));
    frame.setAttribute('y', String(box.y));
    frame.setAttribute('width', String(box.width));
    frame.setAttribute('height', String(box.height));
    frame.setAttribute('fill', 'rgba(255,255,255,0.001)');
    frame.setAttribute('stroke', box.id === selectedBoxId ? '#2f6ea4' : '#7b7568');
    frame.setAttribute('stroke-width', box.id === selectedBoxId ? '1.8' : '1.1');
    frame.setAttribute('stroke-dasharray', box.id === selectedBoxId ? '5 3' : '4 4');
    frame.setAttribute('vector-effect', 'non-scaling-stroke');
    frame.style.cursor = 'move';
    frame.dataset.boxId = box.id;
    frame.dataset.handle = 'body';
    layer.appendChild(frame);
  }

  const selected = boxes.find((box) => box.id === selectedBoxId);
  if (!selected) {
    svg.appendChild(layer);
    return;
  }

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
    layer.appendChild(grip);
  }

  svg.appendChild(layer);
}
