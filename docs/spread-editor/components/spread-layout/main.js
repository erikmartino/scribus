import { LayoutEngine, extractParagraphs } from '../../lib/story-editor-core.js';
import { computeSpreadLayout } from '../../app/spread-geometry.js';

const container = document.getElementById('svg-container');
const sampleEl = document.getElementById('sample-text');

const pageWidthInput = document.getElementById('page-width');
const pageHeightInput = document.getElementById('page-height');
const marginInput = document.getElementById('margin');
const gutterInput = document.getElementById('gutter');
const colGapInput = document.getElementById('col-gap');

const story = extractParagraphs(sampleEl);

function setLabel(id, value) {
  document.getElementById(id).textContent = String(value);
}

function decorateSpread(svg, spread) {
  const ns = 'http://www.w3.org/2000/svg';

  const bg = document.createElementNS(ns, 'rect');
  bg.setAttribute('x', '0');
  bg.setAttribute('y', '0');
  bg.setAttribute('width', String(spread.spreadWidth));
  bg.setAttribute('height', String(spread.spreadHeight));
  bg.setAttribute('fill', '#d7d7d2');
  svg.insertBefore(bg, svg.firstChild);

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
}

async function main() {
  const engine = await LayoutEngine.create({
    hbWasmUrl: 'https://cdn.jsdelivr.net/npm/harfbuzzjs@0.3.6/hb.wasm',
    hbJsUrl: 'https://cdn.jsdelivr.net/npm/harfbuzzjs@0.3.6/hbjs.js',
    hyphenUrl: 'https://cdn.jsdelivr.net/npm/hyphen@1.10.4/en/+esm',
    fontUrl: 'https://cdn.jsdelivr.net/gh/google/fonts@main/ofl/ebgaramond/EBGaramond%5Bwght%5D.ttf',
    fontItalicUrl: 'https://cdn.jsdelivr.net/gh/google/fonts@main/ofl/ebgaramond/EBGaramond-Italic%5Bwght%5D.ttf',
    fontFamily: 'EB Garamond',
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
      gutter,
      colsPerPage: 2,
      colGap,
    });

    const { svg } = engine.renderToContainer(container, story, spread.boxes, 20, 138);
    decorateSpread(svg, spread);
    svg.setAttribute('width', String(spread.spreadWidth));
    svg.setAttribute('height', String(spread.spreadHeight));
    svg.setAttribute('viewBox', `0 0 ${spread.spreadWidth} ${spread.spreadHeight}`);
  }

  pageWidthInput.addEventListener('input', update);
  pageHeightInput.addEventListener('input', update);
  marginInput.addEventListener('input', update);
  gutterInput.addEventListener('input', update);
  colGapInput.addEventListener('input', update);

  update();
}

main().catch((err) => {
  console.error(err);
});
