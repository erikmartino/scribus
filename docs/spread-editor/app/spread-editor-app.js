import {
  LayoutEngine,
  extractParagraphs,
  TextCursor,
  EditorState,
} from '../lib/story-editor-core.js';
import { computeSpreadLayout } from './spread-geometry.js';
import { createBoxesFromDefaults, clampBoxesToBounds } from './box-model.js';
import { drawBoxOverlay } from './box-overlay.js';
import { BoxInteractionController } from './box-interactions.js';

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
    this.boxes = [];
    this.selectedBoxId = null;
    this.currentSpread = null;
    this._svg = null;
    this._interaction = null;
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
        reserveBottom: false,
      });
      this.editor = new EditorState(extractParagraphs(this.sampleEl));
      this._interaction = new BoxInteractionController({
        getSvg: () => this._svg,
        getBounds: () => this.currentSpread?.pasteboardRect,
        getBoxes: () => this.boxes,
        setBoxes: (next) => {
          this.boxes = typeof next === 'function' ? next(this.boxes) : next;
          this.update(); // fire-and-forget from interaction handler
        },
        onSelectBox: (boxId) => {
          this.selectedBoxId = boxId;
        },
        onBodyClick: (event) => {
          this._handleTextClick(event);
        },
      });
      this.bindEvents();
      await this.update();
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
    this.pageWidthInput.addEventListener('change', update);
    this.pageHeightInput.addEventListener('change', update);
    this.marginInput.addEventListener('change', update);
    this.gutterInput.addEventListener('change', update);
    this.colGapInput.addEventListener('change', update);
    this.fontSizeInput.addEventListener('change', update);
    this.lineHeightInput.addEventListener('change', update);

    this.container.addEventListener('pointerdown', async (e) => {
      if (!this._svg) return;

      const target = e.target;
      const boxId = target?.dataset?.boxId;
      const handle = target?.dataset?.handle;
      if (boxId && handle && this._interaction.pointerDown(e, boxId, handle)) {
        return;
      }

      if (target?.tagName === 'svg') {
        this.selectedBoxId = null;
        await this.update();
      }
    });

    this.container.addEventListener('click', async (e) => {
      const target = e.target;
      if (target?.dataset?.boxId) return;
      await this._handleTextClick(e);
    });

    this.container.addEventListener('keydown', async (e) => {
      if (!this.cursor) return;

      const mod = e.metaKey || e.ctrlKey;
      if (mod && (e.key === 'a' || e.key === 'A')) {
        e.preventDefault();
        this.editor.selectAll();
        await this.update();
        return;
      }

      if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) {
        this.cursor.handleKeydown(e);
        const pos = this.cursor.getPosition();
        if (pos) this.editor.moveCursor(pos, e.shiftKey);
        await this.update();
        return;
      }

      if (this.hasBeforeInput) return;

      if (this.editor.handleKeydown(e)) {
        e.preventDefault();
        await this.update();
      }
    });

    this.container.addEventListener('beforeinput', async (e) => {
      if (!this.cursor) return;
      if (!this.editor.handleBeforeInput(e)) return;
      e.preventDefault();
      await this.update();
    });

    this.container.addEventListener('copy', (e) => {
      const text = this.editor.getSelectedText();
      if (!text || !e.clipboardData) return;
      e.preventDefault();
      e.clipboardData.setData('text/plain', text);
    });

    this.container.addEventListener('cut', async (e) => {
      const text = this.editor.getSelectedText();
      if (!text || !e.clipboardData) return;
      e.preventDefault();
      e.clipboardData.setData('text/plain', text);
      if (this.editor.replaceSelectionWithText('')) await this.update();
    });

    this.container.addEventListener('paste', async (e) => {
      if (!e.clipboardData) return;
      const text = e.clipboardData.getData('text/plain');
      if (typeof text !== 'string') return;
      e.preventDefault();
      if (this.editor.hasSelection()) {
        this.editor.replaceSelectionWithText(text);
      } else {
        this.editor.applyOperation('insertText', { text });
      }
      await this.update();
    });

    window.addEventListener('beforeunload', () => {
      if (this.cursor) this.cursor.destroy();
    });
  }

  async _handleTextClick(e) {
    if (!this.cursor) return;
    this.container.focus();
    this.cursor.handleClick(e);
    const pos = this.cursor.getPosition();
    if (!pos) return;
    this.editor.moveCursor(pos, e.shiftKey);
    await this.update();
  }

  decorateSpread(svg, pageRects, spread) {
    const bg = document.createElementNS(SVG_NS, 'rect');
    bg.setAttribute('x', String(spread.pasteboardRect.x));
    bg.setAttribute('y', String(spread.pasteboardRect.y));
    bg.setAttribute('width', String(spread.pasteboardRect.width));
    bg.setAttribute('height', String(spread.pasteboardRect.height));
    bg.setAttribute('fill', '#ccc8bc');
    svg.insertBefore(bg, svg.firstChild);

    const spreadShadow = document.createElementNS(SVG_NS, 'rect');
    spreadShadow.setAttribute('x', String(spread.spreadRect.x));
    spreadShadow.setAttribute('y', String(spread.spreadRect.y));
    spreadShadow.setAttribute('width', String(spread.spreadRect.width));
    spreadShadow.setAttribute('height', String(spread.spreadRect.height));
    spreadShadow.setAttribute('fill', '#e9e3d6');
    spreadShadow.setAttribute('stroke', '#b9b09f');
    spreadShadow.setAttribute('stroke-width', '1.2');
    svg.insertBefore(spreadShadow, svg.firstChild.nextSibling);

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

    const spine = document.createElementNS(SVG_NS, 'line');
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

  async update() {

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
      pasteboardPad: gutter,
      colsPerPage: 2,
      colGap,
    });
    this.currentSpread = spread;

    if (this.boxes.length === 0) {
      this.boxes = createBoxesFromDefaults(spread.boxes);
      this.selectedBoxId = this.boxes[0]?.id || null;
    }
    if (this.boxes.length !== spread.boxes.length) {
      const defaults = createBoxesFromDefaults(spread.boxes);
      this.boxes = defaults.map((d, i) => {
        const existing = this.boxes[i];
        if (!existing) return d;
        return {
          ...existing,
          id: d.id,
        };
      });
      this.selectedBoxId = this.boxes[0]?.id || null;
    }
    this.boxes = clampBoxesToBounds(this.boxes, spread.pasteboardRect);

    const { svg, lineMap } = await this.engine.renderToContainer(
      this.container,
      this.editor.story,
      this.boxes,
      fontSize,
      lineHeightPct,
    );
    this._svg = svg;

    this.decorateSpread(svg, spread.pageRects, spread);
    drawBoxOverlay(svg, {
      boxes: this.boxes,
      selectedBoxId: this.selectedBoxId,
    });
    svg.setAttribute('width', String(spread.pasteboardRect.width));
    svg.setAttribute('height', String(spread.pasteboardRect.height));
    svg.setAttribute(
      'viewBox',
      `${spread.pasteboardRect.x} ${spread.pasteboardRect.y} ${spread.pasteboardRect.width} ${spread.pasteboardRect.height}`,
    );

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
