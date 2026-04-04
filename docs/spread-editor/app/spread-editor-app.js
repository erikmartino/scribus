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
import shell, { AppShell } from '../../app-shell/lib/shell-core.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

export class SpreadEditorApp {
  constructor(root) {
    this.root = root;
    this.engine = null;
    this.editor = null;
    this.cursor = null;
    this.hasBeforeInput = 'onbeforeinput' in document;
    this.boxes = [];
    this.selectedBoxId = null;
    this.currentSpread = null;
    this._svg = null;
    this._interaction = null;
    this.mode = 'object';
    this.shell = shell;
    this._ribbonSections = null; // Cache sections
  }

  async init(shell) {
    if (shell) this.shell = shell;

    this.container = this.root.querySelector('#svg-container');
    this.sampleEl = this.root.querySelector('#sample-text');

    this.setStatus('Loading HarfBuzz, fonts, and hyphenation...');
    try {
      this.engine = await LayoutEngine.create({
        hbWasmUrl: '/vendor/harfbuzzjs/hb.wasm',
        hbJsUrl: '/vendor/harfbuzzjs/hbjs.js',
        hyphenUrl: '/vendor/hyphen/en.js',
        fontUrl: '/vendor/fonts/EBGaramond.ttf',
        fontItalicUrl: '/vendor/fonts/EBGaramond-Italic.ttf',
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
        onBodyClick: (event, boxId) => {
          if (this.mode === 'text') {
            this._handleTextClick(event);
          } else if (this.selectedBoxId !== boxId) {
            this.selectedBoxId = boxId;
            this.update({ full: false });
          }
        },
      });

      this._lastBoxClickTime = 0;
      this._lastBoxClickId = null;

      this.bindEvents();
      this.initTypographyUI();
      await this.update();
      this.setMode('object');
      this.setStatus('Ready - spread editor active.', 'ok');
    } catch (err) {
      this.setStatus('Error loading layout engine: ' + err.message, 'error');
      console.error(err);
      return;
    }
  }

  setMode(mode) {
    this.mode = mode;
    const shellEl = this.root.querySelector('scribus-app-shell');
    if (shellEl) {
      shellEl.setAttribute('data-mode', mode);
    }
    
    if (mode === 'text' && this.container) {
      this.container.focus();
    }
    
    // Update cursor visibility
    if (this.cursor) {
      this.cursor.setVisible(mode === 'text' && !this.editor.hasSelection());
    }
    
    this.update({ full: false });
    this.shell?.requestUpdate();
  }

  initTypographyUI() {
    const container = this.root.querySelector('#font-selector-container');
    if (!container) return;

    const selector = this.shell.ui.createFontSelector({
      label: '',
      value: 'EB Garamond',
      layout: 'horizontal',
      onChange: (font) => {
        if (this.mode === 'text') {
          this.editor.applyCharacterStyle({ fontFamily: font });
          this.update();
        }
      },
      id: 'font-family-selector'
    });
    container.appendChild(selector);

    const boldBtn = this.root.querySelector('#toggle-bold');
    const italicBtn = this.root.querySelector('#toggle-italic');

    boldBtn?.addEventListener('click', () => {
      if (this.mode === 'text') {
        const style = this.editor.getTypingStyle();
        this.editor.applyCharacterStyle({ bold: !style.bold });
        this.update();
      }
    });

    italicBtn?.addEventListener('click', () => {
      if (this.mode === 'text') {
        const style = this.editor.getTypingStyle();
        this.editor.applyCharacterStyle({ italic: !style.italic });
        this.update();
      }
    });
  }

  setStatus(msg, cls = '') {
    if (this.statusEl) {
      this.statusEl.textContent = msg;
      this.statusEl.className = cls;
    }
  }

  bindEvents() {
    this.container.addEventListener('pointerdown', async (e) => {
      if (!this._svg) return;

      const target = e.target;
      const boxId = target?.dataset?.boxId;
      const handle = target?.dataset?.handle;

      // If not clicking a box or handle, it's a background click
      if (!boxId && !handle) {
        if (this.mode === 'text' || this.selectedBoxId) {
          this.selectedBoxId = null;
          this.setMode('object');
        }
        return;
      }

      if (boxId) {
        const now = Date.now();
        const doubleClick = (boxId === this._lastBoxClickId && (now - this._lastBoxClickTime) < 350);
        
        this._lastBoxClickTime = now;
        this._lastBoxClickId = boxId;

        if (doubleClick) {
          this.selectedBoxId = boxId;
          this.setMode('text');
          return;
        }

        if (handle && this._interaction.pointerDown(e, boxId, handle)) {
          return;
        }
      }
    });

    this.container.addEventListener('click', async (e) => {
      const target = e.target;
      const boxId = target?.dataset?.boxId;
      
      if (this.mode === 'text') {
        await this._handleTextClick(e);
      } else if (boxId) {
        // Just selecting a box in object mode
        this.selectedBoxId = boxId;
        await this.update();
      }
    });

    this.container.addEventListener('keydown', async (e) => {
      if (this.mode !== 'text' || !this.cursor) return;

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
      if (this.mode !== 'text' || !this.cursor) return;
      if (!this.editor.handleBeforeInput(e)) return;
      e.preventDefault();
      await this.update();
    });

    this.container.addEventListener('copy', (e) => {
      if (this.mode !== 'text') return;
      const text = this.editor.getSelectedText();
      if (!text || !e.clipboardData) return;
      e.preventDefault();
      e.clipboardData.setData('text/plain', text);
    });

    this.container.addEventListener('cut', async (e) => {
      if (this.mode !== 'text') return;
      const text = this.editor.getSelectedText();
      if (!text || !e.clipboardData) return;
      e.preventDefault();
      e.clipboardData.setData('text/plain', text);
      if (this.editor.replaceSelectionWithText('')) await this.update();
    });

    this.container.addEventListener('paste', async (e) => {
      if (this.mode !== 'text') return;
      const text = e.clipboardData?.getData('text/plain');
      if (!text) return;
      e.preventDefault();
      if (this.editor.replaceSelectionWithText(text)) await this.update();
    });

    window.addEventListener('beforeunload', () => {
      if (this.cursor) this.cursor.destroy();
    });
  }

  _bindRibbonEvents() {
    const update = () => this.update();
    this.pageWidthInput?.addEventListener('change', update);
    this.pageHeightInput?.addEventListener('change', update);
    this.marginInput?.addEventListener('change', update);
    this.gutterInput?.addEventListener('change', update);
    this.colGapInput?.addEventListener('change', update);
    this.fontSizeInput?.addEventListener('change', update);
    this.lineHeightInput?.addEventListener('change', update);
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

  async update(options = { full: true }) {
    const isFull = options.full !== false;

    // Hardcoded A4 geometry in points
    const pageWidth = 595.28;  // A4 Width
    const pageHeight = 841.89; // A4 Height
    const margin = 44;
    const gutter = 140;
    const colGap = 18;
    const fontSize = this.fontSizeInput ? Number(this.fontSizeInput.value) : 20;
    const lineHeightPct = this.lineHeightInput ? Number(this.lineHeightInput.value) : 138;

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

    let svg = this._svg;
    let lineMap = this._lineMap;

    if (isFull || !svg) {
      const result = await this.engine.renderToContainer(
        this.container,
        this.editor.story,
        this.boxes,
        fontSize,
        lineHeightPct,
      );
      svg = result.svg;
      lineMap = result.lineMap;
      this._svg = svg;
      this._lineMap = lineMap;
    }

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
      this.cursor.setVisible(this.mode === 'text' && !this.editor.hasSelection());
    } else {
      this.cursor = new TextCursor(svg, this.editor.story, lineMap, fontSize);
      this.cursor.moveTo(this.editor.cursor);
      this.cursor.setVisible(this.mode === 'text' && !this.editor.hasSelection());
    }

    // Update style buttons
    const typingStyle = this.editor.getTypingStyle();
    const boldBtn = this.root.querySelector('#toggle-bold');
    const italicBtn = this.root.querySelector('#toggle-italic');
    boldBtn?.toggleAttribute('active', !!typingStyle.bold);
    italicBtn?.toggleAttribute('active', !!typingStyle.italic);
  }

  getRibbonSections(selected) {
    if (this.mode === 'object') {
      return []; // No geometry/status sections in object mode as requested
    } else {
      return [
        AppShell.createRibbonSection('Typography', (container) => {
          const fontContainer = document.createElement('div');
          fontContainer.id = 'font-selector-container';
          container.appendChild(fontContainer);
          
          const boldBtn = this.shell.ui.createButton({ label: 'B', id: 'toggle-bold' });
          const italicBtn = this.shell.ui.createButton({ label: 'I', id: 'toggle-italic' });
          container.appendChild(boldBtn);
          container.appendChild(italicBtn);
          
          // Re-init typography UI once added to DOM
          setTimeout(() => this.initTypographyUI(), 0);
        }),
        AppShell.createRibbonSection('Formatting', (container) => {
          this.fontSizeInput = this.shell.ui.createInput({ label: 'Size', type: 'range', min: 12, max: 40, value: 20, id: 'font-size' });
          this.lineHeightInput = this.shell.ui.createInput({ label: 'Line %', type: 'range', min: 105, max: 190, value: 138, id: 'line-height' });
          container.appendChild(this.fontSizeInput);
          container.appendChild(this.lineHeightInput);
          this._bindRibbonEvents();
        })
      ];
    }
  }
}
