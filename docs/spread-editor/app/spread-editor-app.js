import {
  LayoutEngine,
  extractParagraphs,
  TextCursor,
  EditorState,
  TextInteractionController,
  extractParagraphStyles,
  buildParagraphLayoutStyles,
} from '../lib/story-editor-core.js';
import { computeSpreadLayout } from './spread-geometry.js';
import { createBoxesFromDefaults, clampBoxesToBounds } from './box-model.js';
import { drawBoxOverlay } from './box-overlay.js';
import { BoxInteractionController } from './box-interactions.js';
import shell, { AppShell } from '../../app-shell/lib/shell-core.js';
import { AbstractItem } from '../../app-shell/lib/document-model.js';
import { TextTools } from '../../app-shell/lib/text-tools.js';

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
    this.mode = 'object';
    this._isDragging = false;
    this._lastClickTime = 0;
    this.shell = shell;
    this._ribbonSections = null; // Cache sections
    
    this._fontSize = 20;
    this._lineHeight = 138;
  }

  async init(shell) {
    if (shell) this.shell = shell;

    this.container = this.root.querySelector('#svg-container');
    this.statusEl = this.root.querySelector('#status');
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
      const paragraphs = extractParagraphs(this.sampleEl);
      const paragraphStyles = extractParagraphStyles(this.sampleEl, this._fontSize);
      this.editor = new EditorState(paragraphs, paragraphStyles);
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
        onBodyClick: async (event, boxId, wasAlreadySelected) => {
          if (this.mode === 'object' && wasAlreadySelected) {
            this.setMode('text');
            if (this._textInteraction) {
              await this._textInteraction._handlePointerDown(event);
              this._textInteraction._handlePointerUp(event);
            }
          } else if (this.mode !== 'text' && this.selectedBoxId !== boxId) {
            this.selectedBoxId = boxId;
            this.update({ full: false });
          }
        },
      });

      this._lastBoxClickTime = 0;
      this._lastBoxClickId = null;

      this.bindEvents();
      
      // Register Text Commands & Clipboard Integration
      this._registerCommands(shell);
      this._initClipboard(shell);

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
      if (this.storyItem) this.shell?.selection?.select(this.storyItem);
    } else if (mode === 'object') {
      if (this.storyItem) this.shell?.selection?.remove(this.storyItem);
    }
    
    // Update cursor visibility
    if (this.cursor) {
      this.cursor.setVisible(mode === 'text' && !this.editor.hasSelection());
    }
    
    this.update({ full: false });
    this.shell?.requestUpdate();
  }

  _registerCommands(shell) {
    shell.commands.register({
      id: 'text.bold',
      label: 'Bold',
      execute: () => {
        if (this.mode !== 'text') return;
        const style = this.editor.getTypingStyle();
        this.submitAction('Toggle Bold', () => {
          this.editor.applyCharacterStyle({ bold: !style.bold });
        });
      }
    });

    shell.commands.register({
      id: 'text.italic',
      label: 'Italic',
      execute: () => {
        if (this.mode !== 'text') return;
        const style = this.editor.getTypingStyle();
        this.submitAction('Toggle Italic', () => {
          this.editor.applyCharacterStyle({ italic: !style.italic });
        });
      }
    });

    shell.commands.register({
      id: 'text.font-family',
      label: 'Font Family',
      execute: (args) => {
        if (this.mode !== 'text' || !args?.fontFamily) return;
        this.submitAction('Change Font', () => {
          if (!this.editor.hasSelection()) {
            this.editor.applyCharacterStyleToCurrentParagraph({ fontFamily: args.fontFamily });
          } else {
            this.editor.applyCharacterStyle({ fontFamily: args.fontFamily });
          }
        });
      }
    });

    shell.commands.register({
      id: 'text.font-size',
      label: 'Font Size',
      execute: (args) => {
        if (this.mode !== 'text' || !args?.fontSize) return;
        this.submitAction('Change Font Size', () => {
           const currentParaIndex = Math.max(0, Math.min(this.editor.story.length - 1, this.editor.cursor.paraIndex));
           this.editor.paragraphStyles[currentParaIndex].fontSize = args.fontSize;
        });
      }
    });

    shell.commands.register({
      id: 'text.line-height',
      label: 'Line Height',
      execute: (args) => {
        if (this.mode !== 'text' || !args?.lineHeight) return;
        this.submitAction('Change Line Height', () => {
           this._lineHeight = args.lineHeight;
        });
      }
    });
  }

  /**
   * Register as an AbstractItem for clipboard serialization
   * and wire up paste-received / cut-executed event handlers.
   */
  _initClipboard(shell) {
    const storyItem = new AbstractItem('spread-story', 'story');
    storyItem.serialize = () => {
      if (this.mode !== 'text' && !this.selectedBoxId) return null;
      const selectedText = this.editor.getSelectedText();
      const range = this.editor.getSelectionRange();
      if (selectedText && range) {
        return {
          type: 'story',
          data: selectedText,
          story: this.editor.getRichSelection(),
          paragraphStyles: this.editor.paragraphStyles.slice(range.start.paraIndex, range.end.paraIndex + 1).map(s => ({...s}))
        };
      }
      return null;
    };
    shell.doc.registerItem(storyItem);
    this.storyItem = storyItem;

    shell.addEventListener('paste-received', (e) => this.handlePaste(e.detail));

    shell.addEventListener('cut-executed', () => {
      if (this.mode !== 'text' || !this.editor.hasSelection()) return;
      this.submitAction('Cut', () => {
        this.editor.replaceSelectionWithText('');
      });
    });
  }

  submitAction(label, fn) {
    const prevState = {
      editorState: this.editor.getState(),
      fontSize: this._fontSize,
      lineHeight: this._lineHeight
    };

    const action = {
      label,
      execute: async () => {
        fn();
        await this.update();
      },
      undo: async () => {
        this.editor.setState(prevState.editorState);
        this._fontSize = prevState.fontSize;
        this._lineHeight = prevState.lineHeight;
        await this.update();
      }
    };

    this.shell.history.submit(action);
  }

  handlePaste(payload) {
    if (this.mode !== 'text') return;
    if (!payload || !payload.items) return;
    
    // 1. Native Story Data (preferred)
    const storyItem = payload.items.find(it => it && it.type === 'story');
    if (storyItem && storyItem.story) {
      this.submitAction('Paste Story', () => {
        this.editor.insertStory(storyItem.story, storyItem.paragraphStyles);
      });
      return;
    }

    // 2. Plain Text / Rich Text Fallbacks
    const textItem = payload.items.find(it => it && (it.type === 'plain-text' || it.type === 'rich-text-fragment'));
    if (textItem) {
      this.submitAction('Paste Text', () => {
        const raw = textItem.data;
        const text = textItem.type === 'rich-text-fragment' 
          ? raw.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ') 
          : raw;
        
        if (this.editor.hasSelection()) {
          this.editor.replaceSelectionWithText(text);
        } else {
          this.editor.applyOperation('insertText', { text });
        }
      });
    }
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
          await this.update();
        }
        return;
      }

      if (boxId) {
        e.wasAlreadySelected = (this.selectedBoxId === boxId);

        // Prevent dragging the box body when in text mode
        // (TextInteractionController handles internal text dragging instead)
        if (this.mode === 'text' && handle === 'body') {
          return;
        }

        if (handle && this._interaction.pointerDown(e, boxId, handle)) {
          return;
        }
      }
    });

    this.container.addEventListener('pointermove', async (e) => {
      // Box dragging is handled by _interaction
    });

    this.container.addEventListener('pointerup', () => {
        this._isDragging = false;
    });

    this.container.addEventListener('click', async (e) => {
      const target = e.target;
      const boxId = target?.dataset?.boxId;
      
      if (this.mode !== 'text' && boxId) {
        // Just selecting a box in object mode
        this.selectedBoxId = boxId;
        await this.update();
      }
    });

    window.addEventListener('beforeunload', () => {
      if (this.cursor) this.cursor.destroy();
      if (this._textInteraction) this._textInteraction.destroy();
    });
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
    const fontSize = this._fontSize || 20;
    const lineHeightPct = this._lineHeight || 138;

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
      const paragraphLayoutStyles = buildParagraphLayoutStyles(this._fontSize, this.editor.paragraphStyles);
      const result = await this.engine.renderToContainer(
        this.container,
        this.editor.story,
        this.boxes,
        this._fontSize,
        this._lineHeight,
        paragraphLayoutStyles,
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
      this.cursor.updateSelection(this.editor.getSelectionRange());
      this.cursor.moveTo(this.editor.cursor);
      this.cursor.setVisible(this.mode === 'text' && !this.editor.hasSelection());
      
      if (!this._textInteraction) {
        this._textInteraction = new TextInteractionController({
          container: this.container,
          editor: this.editor,
          cursor: this.cursor,
          update: () => this.update(),
          enabled: () => this.mode === 'text',
          submitAction: (label, fn) => {
            this.submitAction(label, fn);
          }
        });
      } else {
        this._textInteraction.setCursor(this.cursor);
      }
    } else {
      this.cursor = new TextCursor(svg, this.editor.story, lineMap, this._fontSize);
      this.cursor.updateSelection(this.editor.getSelectionRange());
      this.cursor.moveTo(this.editor.cursor);
      this.cursor.setVisible(this.mode === 'text' && !this.editor.hasSelection());

      this._textInteraction = new TextInteractionController({
        container: this.container,
        editor: this.editor,
        cursor: this.cursor,
        update: () => this.update(),
        enabled: () => this.mode === 'text',
        submitAction: (label, fn) => {
          this.submitAction(label, fn);
        }
      });
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
      return [];
    } else {
      const typingStyle = this.editor.getTypingStyle();
      const paraIndex = Math.max(0, Math.min(this.editor.story.length - 1, this.editor.cursor.paraIndex));
      const paraStyle = this.editor.paragraphStyles[paraIndex] || {};
      return [
        TextTools.createTypographySection(this.shell, {
          fontFamily: typingStyle.fontFamily || 'EB Garamond'
        }),
        TextTools.createFormattingSection(this.shell, {
          fontSize: paraStyle.fontSize || this._fontSize || 20,
          lineHeight: this._lineHeight || 138
        })
      ];
    }
  }
}
