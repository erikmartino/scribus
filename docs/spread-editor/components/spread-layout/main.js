import { LayoutEngine, extractParagraphs } from '../../lib/story-editor-core.js';
import { computeSpreadLayout } from '../../app/spread-geometry.js';
import { createBoxesFromDefaults, clampBoxesToBounds } from '../../app/box-model.js';
import { drawBoxOverlay } from '../../app/box-overlay.js';
import { BoxInteractionController } from '../../app/box-interactions.js';

const container = document.getElementById('svg-container');
const sampleEl = document.getElementById('sample-text');

const pageWidthInput = document.getElementById('page-width');
const pageHeightInput = document.getElementById('page-height');
const marginInput = document.getElementById('margin');
const gutterInput = document.getElementById('gutter');
const colGapInput = document.getElementById('col-gap');

const story = extractParagraphs(sampleEl);
let boxes = [];
let selectedBoxId = null;
let currentSpread = null;
let currentSvg = null;

function setLabel(id, value) {
  document.getElementById(id).textContent = String(value);
}

function decorateSpread(svg, spread) {
  const ns = 'http://www.w3.org/2000/svg';

  const bg = document.createElementNS(ns, 'rect');
  bg.setAttribute('x', String(spread.pasteboardRect.x));
  bg.setAttribute('y', String(spread.pasteboardRect.y));
  bg.setAttribute('width', String(spread.pasteboardRect.width));
  bg.setAttribute('height', String(spread.pasteboardRect.height));
  bg.setAttribute('fill', '#ccc8bc');
  svg.insertBefore(bg, svg.firstChild);

  const spreadShadow = document.createElementNS(ns, 'rect');
  spreadShadow.setAttribute('x', String(spread.spreadRect.x));
  spreadShadow.setAttribute('y', String(spread.spreadRect.y));
  spreadShadow.setAttribute('width', String(spread.spreadRect.width));
  spreadShadow.setAttribute('height', String(spread.spreadRect.height));
  spreadShadow.setAttribute('fill', '#e9e3d6');
  spreadShadow.setAttribute('stroke', '#b9b09f');
  spreadShadow.setAttribute('stroke-width', '1.2');
  svg.insertBefore(spreadShadow, svg.firstChild.nextSibling);

  for (let i = spread.pageRects.length - 1; i >= 0; i--) {
    const page = spread.pageRects[i];
    const r = document.createElementNS(ns, 'rect');
    r.setAttribute('x', String(page.x));
    r.setAttribute('y', String(page.y));
    r.setAttribute('width', String(page.width));
    r.setAttribute('height', String(page.height));
    r.setAttribute('fill', '#fffef8');
    r.setAttribute('stroke', '#c7c1b5');
    r.setAttribute('stroke-width', '1.2');
    svg.insertBefore(r, svg.firstChild.nextSibling);
  }

  const spine = document.createElementNS(ns, 'line');
  const spineX = spread.spreadRect.x + spread.spreadRect.width / 2;
  spine.setAttribute('x1', String(spineX));
  spine.setAttribute('y1', String(spread.spreadRect.y));
  spine.setAttribute('x2', String(spineX));
  spine.setAttribute('y2', String(spread.spreadRect.y + spread.spreadRect.height));
  spine.setAttribute('stroke', '#aba18d');
  spine.setAttribute('stroke-width', '1');
  spine.setAttribute('stroke-dasharray', '4 4');
  svg.insertBefore(spine, svg.firstChild.nextSibling);
}

async function main() {
  const engine = await LayoutEngine.create({
    hbWasmUrl: 'https://cdn.jsdelivr.net/npm/harfbuzzjs@0.3.6/hb.wasm',
    hbJsUrl: 'https://cdn.jsdelivr.net/npm/harfbuzzjs@0.3.6/hbjs.js',
    hyphenUrl: 'https://cdn.jsdelivr.net/npm/hyphen@1.10.4/en/+esm',
    fontUrl: 'https://cdn.jsdelivr.net/gh/google/fonts@main/ofl/ebgaramond/EBGaramond%5Bwght%5D.ttf',
    fontItalicUrl: 'https://cdn.jsdelivr.net/gh/google/fonts@main/ofl/ebgaramond/EBGaramond-Italic%5Bwght%5D.ttf',
    fontFamily: 'EB Garamond',
    reserveBottom: false,
  });

  const interaction = new BoxInteractionController({
    getSvg: () => currentSvg,
    getBounds: () => currentSpread?.pasteboardRect,
    getBoxes: () => boxes,
    setBoxes: (next) => {
      boxes = typeof next === 'function' ? next(boxes) : next;
      update();
    },
    onSelectBox: (boxId) => {
      selectedBoxId = boxId;
    },
    onBodyClick: () => {},
  });

  function update() {
    const pageWidth = Number(pageWidthInput.value);
    const pageHeight = Number(pageHeightInput.value);
    const margin = Number(marginInput.value);
    const gutter = Number(gutterInput.value);
    const colGap = Number(colGapInput.value);

    setLabel('page-width-val', pageWidth);
    setLabel('page-height-val', pageHeight);
    setLabel('margin-val', margin);
    setLabel('gutter-val', gutter);
    setLabel('col-gap-val', colGap);

    const spread = computeSpreadLayout({
      pageWidth,
      pageHeight,
      margin,
      pasteboardPad: gutter,
      colsPerPage: 2,
      colGap,
    });
    currentSpread = spread;

    if (boxes.length === 0) {
      boxes = createBoxesFromDefaults(spread.boxes);
      selectedBoxId = boxes[0]?.id || null;
    }
    if (boxes.length !== spread.boxes.length) {
      const defaults = createBoxesFromDefaults(spread.boxes);
      boxes = defaults.map((d, i) => {
        const existing = boxes[i];
        if (!existing) return d;
        return {
          ...existing,
          id: d.id,
        };
      });
      selectedBoxId = boxes[0]?.id || null;
    }
    boxes = clampBoxesToBounds(boxes, spread.pasteboardRect);

    const { svg } = engine.renderToContainer(container, story, boxes, 20, 138);
    currentSvg = svg;
    decorateSpread(svg, spread);
    drawBoxOverlay(svg, { boxes, selectedBoxId });
    svg.setAttribute('width', String(spread.pasteboardRect.width));
    svg.setAttribute('height', String(spread.pasteboardRect.height));
    svg.setAttribute(
      'viewBox',
      `${spread.pasteboardRect.x} ${spread.pasteboardRect.y} ${spread.pasteboardRect.width} ${spread.pasteboardRect.height}`,
    );
  }

  pageWidthInput.addEventListener('input', update);
  pageHeightInput.addEventListener('input', update);
  marginInput.addEventListener('input', update);
  gutterInput.addEventListener('input', update);
  colGapInput.addEventListener('input', update);

  container.addEventListener('pointerdown', (e) => {
    const target = e.target;
    const boxId = target?.dataset?.boxId;
    const handle = target?.dataset?.handle;
    if (boxId && handle) {
      interaction.pointerDown(e, boxId, handle);
      update();
      return;
    }
    if (target?.tagName === 'svg') {
      selectedBoxId = null;
      update();
    }
  });

  update();
}

main().catch((err) => {
  console.error(err);
});
