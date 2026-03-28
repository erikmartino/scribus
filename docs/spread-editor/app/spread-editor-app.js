import {
  LayoutEngine,
  extractParagraphs,
  TextCursor,
  EditorState,
} from '../lib/story-editor-core.js';
import { computeSpreadLayout } from './spread-geometry.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

export class SpreadEditorApp {
  constructor(root) {
    this.root = root;
    this.statusEl = root.querySelector('#status');
    this.container = root.querySelector('#svg-container');
    this.sampleEl = root.querySelector('#sample-text');

    this.pageWidthInput = root.querySelector('#page-width');
    this.pageHeightInput = root.querySelector('#page-height');
    this.marginInput = root.querySelector('#margin');
    this.gutterInput = root.querySelector('#gutter');
    this.colGapInput = root.querySelector('#col-gap');
    this.fontSizeInput = root.querySelector('#font-size');
    this.lineHeightInput = root.querySelector('#line-height');

    this.engine = null;
    this.editor = null;
    this.cursor = null;
    this.hasBeforeInput = 'onbeforeinput' in document;
  }

  async init() {
    this.setStatus('Loading HarfBuzz, fonts, and hyphenation...');
    try {
      this.engine = await LayoutEngine.create({
        hbWasmUrl: 'https://cdn.jsdelivr.net/npm/harfbuzzjs@0.3.6/hb.wasm',
        hbJsUrl: 'https://cdn.jsdelivr.net/npm/harfbuzzjs@0.3.6/hbjs.js',
        hyphenUrl: 'https://cdn.jsdelivr.net/npm/hyphen@1.10.4/en/+esm',
        fontUrl: 'https://cdn.jsdelivr.net/gh/google/fonts@main/ofl/ebgaramond/EBGaramond%5Bwght%5D.ttf',
        fontItalicUrl: 'https://cdn.jsdelivr.net/gh/google/fonts@main/ofl/ebgaramond/EBGaramond-Italic%5Bwght%5D.ttf',
        fontFamily: 'EB Garamond',
      });
      this.editor = new EditorState(extractParagraphs(this.sampleEl));
      this.bindEvents();
      this.update();
      this.setStatus('Ready - spread editor active.', 'ok');
    } catch (err) {
      this.setStatus(`Error: ${err.message}`, 'error');
      throw err;
    }
  }

  setStatus(msg, cls = '') {
    this.statusEl.textContent = msg;
    this.statusEl.className = cls;
  }

  bindEvents() {
    const update = () => this.update();
    this.pageWidthInput.addEventListener('input', update);
    this.pageHeightInput.addEventListener('input', update);
    this.marginInput.addEventListener('input', update);
    this.gutterInput.addEventListener('input', update);
    this.colGapInput.addEventListener('input', update);
    this.fontSizeInput.addEventListener('input', update);
    this.lineHeightInput.addEventListener('input', update);

    this.container.addEventListener('click', (e) => {
      if (!this.cursor) return;
      this.container.focus();
      this.cursor.handleClick(e);
      const pos = this.cursor.getPosition();
      if (!pos) return;
      this.editor.moveCursor(pos, e.shiftKey);
      this.update();
    });

    this.container.addEventListener('keydown', (e) => {
      if (!this.cursor) return;

      const mod = e.metaKey || e.ctrlKey;
      if (mod && (e.key === 'a' || e.key === 'A')) {
        e.preventDefault();
        this.editor.selectAll();
        this.update();
        return;
      }

      if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) {
        this.cursor.handleKeydown(e);
        const pos = this.cursor.getPosition();
        if (pos) this.editor.moveCursor(pos, e.shiftKey);
        this.update();
        return;
      }

      if (this.hasBeforeInput) return;

      if (this.editor.handleKeydown(e)) {
        e.preventDefault();
        this.update();
      }
    });

    this.container.addEventListener('beforeinput', (e) => {
      if (!this.cursor) return;
      if (!this.editor.handleBeforeInput(e)) return;
      e.preventDefault();
      this.update();
    });

    this.container.addEventListener('copy', (e) => {
      const text = this.editor.getSelectedText();
      if (!text || !e.clipboardData) return;
      e.preventDefault();
      e.clipboardData.setData('text/plain', text);
    });

    this.container.addEventListener('cut', (e) => {
      const text = this.editor.getSelectedText();
      if (!text || !e.clipboardData) return;
      e.preventDefault();
      e.clipboardData.setData('text/plain', text);
      if (this.editor.replaceSelectionWithText('')) this.update();
    });

    this.container.addEventListener('paste', (e) => {
      if (!e.clipboardData) return;
      const text = e.clipboardData.getData('text/plain');
      if (typeof text !== 'string') return;
      e.preventDefault();
      if (this.editor.hasSelection()) {
        this.editor.replaceSelectionWithText(text);
      } else {
        this.editor.applyOperation('insertText', { text });
      }
      this.update();
    });

    window.addEventListener('beforeunload', () => {
      if (this.cursor) this.cursor.destroy();
    });
  }

  updateControlLabels() {
    this.root.querySelector('#page-width-val').textContent = this.pageWidthInput.value;
    this.root.querySelector('#page-height-val').textContent = this.pageHeightInput.value;
    this.root.querySelector('#margin-val').textContent = this.marginInput.value;
    this.root.querySelector('#gutter-val').textContent = this.gutterInput.value;
    this.root.querySelector('#col-gap-val').textContent = this.colGapInput.value;
    this.root.querySelector('#font-size-val').textContent = this.fontSizeInput.value;
    this.root.querySelector('#line-height-val').textContent = this.lineHeightInput.value;
  }

  decorateSpread(svg, pageRects, spread) {
    const bg = document.createElementNS(SVG_NS, 'rect');
    bg.setAttribute('x', '0');
    bg.setAttribute('y', '0');
    bg.setAttribute('width', String(spread.spreadWidth));
    bg.setAttribute('height', String(spread.spreadHeight));
    bg.setAttribute('fill', '#d7d7d2');
    svg.insertBefore(bg, svg.firstChild);

    for (let i = pageRects.length - 1; i >= 0; i--) {
      const page = pageRects[i];
      const r = document.createElementNS(SVG_NS, 'rect');
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

  update() {
    this.updateControlLabels();

    const pageWidth = Number(this.pageWidthInput.value);
    const pageHeight = Number(this.pageHeightInput.value);
    const margin = Number(this.marginInput.value);
    const gutter = Number(this.gutterInput.value);
    const colGap = Number(this.colGapInput.value);
    const fontSize = Number(this.fontSizeInput.value);
    const lineHeightPct = Number(this.lineHeightInput.value);

    const spread = computeSpreadLayout({
      pageWidth,
      pageHeight,
      margin,
      gutter,
      colsPerPage: 2,
      colGap,
    });

    const { svg, lineMap } = this.engine.renderToContainer(
      this.container,
      this.editor.story,
      spread.boxes,
      fontSize,
      lineHeightPct,
    );

    this.decorateSpread(svg, spread.pageRects, spread);
    svg.setAttribute('width', String(spread.spreadWidth));
    svg.setAttribute('height', String(spread.spreadHeight));
    svg.setAttribute('viewBox', `0 0 ${spread.spreadWidth} ${spread.spreadHeight}`);

    if (this.cursor) {
      this.cursor.setStory(this.editor.story);
      this.cursor.updateLayout(svg, lineMap, fontSize);
      this.cursor.moveTo(this.editor.cursor);
      this.cursor.setVisible(!this.editor.hasSelection());
    } else {
      this.cursor = new TextCursor(svg, this.editor.story, lineMap, fontSize);
      this.cursor.moveTo(this.editor.cursor);
      this.cursor.setVisible(!this.editor.hasSelection());
    }
  }
}
