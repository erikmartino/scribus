import {
  extractParagraphs,
  TextCursor,
  EditorState,
  TextInteractionController,
  extractParagraphStyles,
  buildParagraphLayoutStyles,
  parseHtmlToStory,
  cloneStyle,
  cloneParagraphStyle,
} from '../lib/story-editor-core.js';
import {
  loadSpread,
  loadAssets,
  extFromMime,
  assetNameFromFilename,
  uploadImageAsset,
  putJson,
  updateDocTimestamp,
  loadStoryFromStore,
  loadParagraphStyles,
  serializeStory,
} from '../../document-store/lib/document-store.js';
import { computeSpreadLayout } from './spread-geometry.js';
import { createBoxesFromDefaults, clampBoxesToBounds } from './box-model.js';
import { BoxInteractionController } from './box-interactions.js';
import shell, { AppShell } from '../../app-shell/lib/shell-core.js';
import { AbstractItem } from '../../app-shell/lib/document-model.js';
import { TextTools } from '../../app-shell/lib/text-tools.js';
import { getTextPropertyDescriptors } from '../../app-shell/lib/text-property-descriptors.js';
import { registerTextCommands } from '../../app-shell/lib/text-commands.js';
import { createLayoutEngine, sliceStory } from '../../doc-renderer/lib/layout-document.js';
import { decorateSpreadForEditor, getImagePlacement, emptyImagePlaceholder } from '../../doc-renderer/lib/svg-renderer.js';

import {
  loadAllSpreadsMetadata,
  loadFromStore,
  saveSpread,
  serializeSpread,
  refreshPlaceholderBoxes,
} from './persistence.js';
import {
  initClipboard,
  initSelectionSync,
  handlePaste,
  blobToDataUrl,
  loadImageBlob,
  prepareImageAsset,
  placeImageBox,
} from './clipboard.js';
import {
  initDragDrop,
  showDropHighlight,
  hideDropHighlight,
  placeImageBoxAt,
  placeAssetBoxAt,
} from './drag-drop.js';
import {
  registerCreatables,
  createTextFrame,
  createImageFrame,
  deleteSelectedBox,
} from './frames.js';
import {
  zoomBy,
  zoomToFit,
  applyZoom,
  projectPoint,
  projectSize,
  updateOverlay,
  decorateSpreadOverlay,
} from './zoom.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

export class SpreadEditorApp {
  constructor(root) {
    this.root = root;
    this.engine = null;
    this.cursor = null;
    this.hasBeforeInput = 'onbeforeinput' in document;
    this.boxes = [];
    this.imageBoxes = [];
    this._imageBoxCounter = 0;
    this._storyCounter = 0;
    this.selectedBoxId = null;
    this.currentSpread = null;
    this._svg = null;
    this.mode = 'object';
    this.activeCroppingMode = 1; // 1: Combined, 2: Box-Only, 3: Content-Only
    this._isDragging = false;
    this._lastClickTime = 0;
    this.shell = shell;
    this.storyItem = new AbstractItem('Story', 'text');

    // Multi-story: each text frame (or chain) has its own EditorState.
    // _stories is an array of { id, editor, boxIds, lineMap }.
    this._stories = [];
    this._activeStory = null;

    // Link mode: when set, the user is linking a box's output to another frame.
    // { sourceBoxId: string } or null.
    this._linkSource = null;
    
    this._fontSize = 20;
    this._lineHeight = 138;

    // Zoom: 1.0 = 100%, >1 = zoomed in, <1 = zoomed out
    this._zoom = 1.0;
    // Preview worker iframe (16×16 px, runs in background)
    this._previewWorkerFrame = null;
    this._zoomMin = 0.25;
    this._zoomMax = 40.0;
    this._zoomStep = 1.1; // multiplicative step per wheel tick

    // Document store path (e.g. "alice/brochure-q2").
    // When set, the Save button writes back to /store/{docPath}/...
    this._docPath = null;
    this._saving = false;
    this._assets = {};

    this._activeSpreadId = null;
    this._spreadsList = null;
    this._spreadsMetadata = {};
    this._pagesPanelTimestamp = Date.now();
    this._pagesPanelContainer = null;
    this._activeSpreadPages = [
      { index: 0, label: '1' },
      { index: 1, label: '2' }
    ];
  }

  /** Active editor — returns the EditorState of the currently active story. */
  get editor() {
    return this._activeStory?.editor ?? null;
  }

  async init(shell) {
    if (shell) {
      this.shell = shell;
      shell.registerPanel({ id: 'assets', label: 'Assets' });
      shell.registerPanel({ id: 'pages', label: 'Pages' });
    }

    this.container = this.root.querySelector('#svg-container');
    this.statusEl = this.root.querySelector('#status');
    this.sampleEl = this.root.querySelector('#sample-text');

    this.setStatus('Loading HarfBuzz, fonts, and hyphenation...');
    try {
      this.engine = await createLayoutEngine();
      // Detect document store path from URL (?doc=user/docname)
      const params = new URLSearchParams(location.search);
      this._docPath = params.get('doc') || null;

      if (this._docPath) {
        await this._loadFromStore();
      } else {
        // Fallback: use hardcoded sample text from #sample-text element
        const paragraphs = extractParagraphs(this.sampleEl);
        const paragraphStyles = extractParagraphStyles(this.sampleEl, this._fontSize);
        const initialStory = {
          id: `story-${this._storyCounter++}`,
          editor: new EditorState(paragraphs, paragraphStyles),
          boxIds: [], // populated in update() from default boxes
          lineMap: [],
        };
        this._stories = [initialStory];
        this._activeStory = initialStory;
      }
      this._interaction = new BoxInteractionController({
        getSvg: () => this._svg,
        getBounds: () => this.currentSpread?.pasteboardRect,
        getBoxes: () => [...this.boxes, ...this.imageBoxes],
        getActiveCroppingMode: () => this.activeCroppingMode,
        setBoxes: (next, options = {}) => {
          const all = [...this.boxes, ...this.imageBoxes];
          const updated = typeof next === 'function' ? next(all) : next;
          // Partition back into text boxes and image boxes
          this.boxes = updated.filter(b => !b.imageUrl);
          this.imageBoxes = updated.filter(b => !!b.imageUrl);
          this.update(options); // fire-and-forget from interaction handler
        },
        onSelectBox: (boxId) => {
          this.selectedBoxId = boxId;
          const item = this.shell?.doc?.get(boxId);
          if (item) {
            this.shell.selection.select(item);
          } else {
            this.shell?.updatePanels();
          }
        },
        onBodyClick: async (event, boxId, wasAlreadySelected) => {
          // Image boxes don't support text editing — skip enter-text-mode
          const isImageBox = this.imageBoxes.some(b => b.id === boxId);
          if (this.mode === 'object' && wasAlreadySelected && !isImageBox) {
            // Activate the story that owns this box
            this._activateStoryForBox(boxId);

            // Check if the clicked box has any text lines. If empty,
            // place the cursor at the end of the story so the user can
            // start typing and text will flow into the frame.
            const clickedBox = this.boxes.find(b => b.id === boxId);
            const storyEntry = this._findStoryForBox(boxId);
            const storyLineMap = storyEntry?.lineMap || [];
            const boxHasLines = clickedBox && storyLineMap.some(line =>
              Math.abs(line.colX - clickedBox.x) < 1 &&
              Math.abs(line.boxY - clickedBox.y) < 1
            );

            if (!boxHasLines && this.editor) {
              // Place cursor at end of the last paragraph before entering
              // text mode, so a single update cycle handles everything.
              const lastPara = this.editor.story.length - 1;
              const lastParaText = this.editor.story[lastPara]
                ?.map(r => r.text).join('') || '';
              this.editor.moveCursor({
                paraIndex: lastPara,
                charOffset: lastParaText.length,
              });
              this.setMode('text');
            } else {
              this.setMode('text');
              if (this._textInteraction) {
                await this._textInteraction._handlePointerDown(event);
                this._textInteraction._handlePointerUp(event);
              }
            }
          } else if (this.mode !== 'text' && this.selectedBoxId !== boxId) {
            this.selectedBoxId = boxId;
            this.update({ full: false });
          }
        },
      });

      this._lastBoxClickTime = 0;
      this._lastBoxClickId = null;

      // Create the overlay SVG — sits on top of the content SVG, not zoomed.
      this._overlaySvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      this._overlaySvg.classList.add('overlay-svg');
      this.container.appendChild(this._overlaySvg);

      // Refresh overlay when the container scrolls or the window resizes
      this.container.addEventListener('scroll', () => this._updateOverlay());
      new ResizeObserver(() => this._updateOverlay()).observe(this.container);

      this.bindEvents();
      this._initDragDrop();

      // Register Text Commands & Clipboard Integration
      this._registerCommands(shell);
      this._initClipboard(shell);
      this._registerCreatables(shell);
      this._registerSaveCommand(shell);

      shell.addEventListener('delete-requested', () => this._deleteSelectedBox());

      await this.update();
      this.setMode('object');
      this.setStatus('Ready - spread editor active.', 'ok');

      // Check query parameter and jump to the initial page
      const pageParam = params.get('page');
      if (pageParam) {
        let targetPage = null;
        if (this._spreadsList) {
          for (const spreadId of this._spreadsList) {
            const pages = this._spreadsMetadata[spreadId]?.pages || [];
            const page = pages.find(p => p.label === pageParam || String(p.index + 1) === pageParam);
            if (page) {
              targetPage = page;
              break;
            }
          }
        }
        if (targetPage) {
          setTimeout(() => {
            this.jumpToPage(targetPage.label);
          }, 50);
        }
      }
    } catch (err) {
      this.setStatus('Error loading layout engine: ' + err.message, 'error');
      console.error(err);
      return;
    }
  }

  setMode(mode) {
    this.mode = mode;
    this.shell?.setMode(mode);
    
    if (mode === 'text' && this.container) {
      this.container.focus();
      if (this.storyItem) this.shell?.selection?.select(this.storyItem);
    } else if (mode === 'object') {
      if (this.storyItem) this.shell?.selection?.remove(this.storyItem);
    }
    
    // Update cursor visibility
    if (this.cursor && this.editor) {
      this.cursor.setVisible(mode === 'text' && !this.editor.hasSelection());
    }
    
    this.update({ full: false });
    this.shell?.updatePanels();
  }

  /** Find the story entry that owns the given box ID. */
  _findStoryForBox(boxId) {
    return this._stories.find(s => s.boxIds.includes(boxId)) || null;
  }

  /** Activate the story that owns the given box, updating cursor/interaction. */
  _activateStoryForBox(boxId) {
    const story = this._findStoryForBox(boxId);
    if (story && story !== this._activeStory) {
      this._activeStory = story;
      // Swap the editor and lineMap on the interaction controller and cursor
      if (this._textInteraction) {
        this._textInteraction.setEditor(story.editor);
      }
      if (this.cursor) {
        this.cursor.setStory(story.editor.story);
        if (story.lineMap.length > 0) {
          this.cursor.updateLayout(this._svg, story.lineMap, this._fontSize);
        }
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Store loading — read spread + stories from the document store
  // ---------------------------------------------------------------------------

  async _loadAllSpreadsMetadata() {
    return loadAllSpreadsMetadata(this);
  }

  async _loadFromStore() {
    this._clearPagesPanel();
    this._assetsPanelContainer = null;
    return loadFromStore(this);
  }

  /**
   * Embed a tiny (16×16 px) preview-worker iframe that scans the store and
   * generates JPEG previews for any assets that are missing them.
   *
   * The iframe posts messages back as it progresses:
   *   { type: 'progress', assetRef, docPath, previewUrl }  — one preview done
   *   { type: 'done', generated }                           — all done
   *   { type: 'error', message }                            — fatal error
   *   { type: 'assetError', assetRef, message }             — single asset failed
   */
  _startPreviewWorker() {
    // Don't start a second worker if one is already running
    if (this._previewWorkerFrame) return;

    const spinner = document.getElementById('preview-spinner');
    const spinnerLabel = document.getElementById('preview-spinner-label');
    if (spinner) spinner.classList.add('visible');

    const iframe = document.createElement('iframe');
    iframe.id = 'preview-worker-frame';
    iframe.src = '/image-converter/preview-worker.html?docPath=' + encodeURIComponent(this._docPath);
    iframe.title = 'Preview generator';
    document.body.appendChild(iframe);
    this._previewWorkerFrame = iframe;

    const onMessage = async (event) => {
      const msg = event.data;
      if (!msg || !msg.type) return;

      switch (msg.type) {
        case 'progress': {
          // Live-swap the imageUrl for the matching image box without a full reload
          const box = this.imageBoxes.find(
            b => b.assetRef === msg.assetRef
          );
          if (box && msg.docPath === this._docPath) {
            box.imageUrl = msg.previewUrl + '?t=' + Date.now();
            await this.update();
          }
          // Live-swap the asset panel card thumbnail
          const card = document.getElementById('asset-card-' + msg.assetRef);
          if (card && msg.docPath === this._docPath) {
            const wrapper = card.querySelector('.asset-thumbnail-wrapper');
            const img = card.querySelector('.asset-thumbnail');
            if (wrapper && img) {
              img.src = msg.previewUrl + '?t=' + Date.now();
              wrapper.classList.remove('asset-thumbnail-wrapper--pending');
            }
          }
          if (spinnerLabel) {
            spinnerLabel.textContent =
              `Generating previews\u2026 (${msg.done}/${msg.total})`;
          }
          break;
        }

        case 'done':
        case 'error': {
          window.removeEventListener('message', onMessage);
          if (this._previewWorkerFrame) {
            document.body.removeChild(this._previewWorkerFrame);
            this._previewWorkerFrame = null;
          }
          if (spinner) spinner.classList.remove('visible');
          if (msg.type === 'error') {
            console.error('[spread-editor] Preview worker error:', msg.message);
          }
          // Reload assets and update panels so newly generated previews are visible
          this._assets = await loadAssets(this._docPath);
          this._assetsPanelContainer = null;
          this.shell?.updatePanels();
          // Refresh any boxes that are still showing the placeholder —
          // their previews may have been on disk already (generated previously)
          // and the worker correctly skipped them (generated: 0).
          await this._refreshPlaceholderBoxes();
          break;
        }

        // Single asset failures are non-fatal — log and continue
        case 'assetError':
          console.warn(`[spread-editor] Preview failed for ${msg.assetRef}:`, msg.message);
          break;
      }
    };

    window.addEventListener('message', onMessage);
  }

  /**
   * Re-fetch meta.json for any image box still showing the empty placeholder
   * and swap in the preview URL if one is now available.
   * Called after the preview worker finishes (including the no-op case where
   * all previews were already on disk).
   */
  async _refreshPlaceholderBoxes() {
    return refreshPlaceholderBoxes(this);
  }

  /**
   * Enter link mode: the user clicked an output port on `sourceBoxId`.
   * If the port is filled (has a successor), unlink instead.
   */
  _handleOutputPortClick(sourceBoxId) {
    const story = this._findStoryForBox(sourceBoxId);
    if (!story) return;

    const posInChain = story.boxIds.indexOf(sourceBoxId);
    const isLast = posInChain === story.boxIds.length - 1;

    if (!isLast) {
      // Filled output port: unlink the chain at this point
      this._unlinkAt(sourceBoxId);
    } else {
      // Empty output port or overflow marker: enter link mode
      this._enterLinkMode(sourceBoxId);
    }
  }

  _enterLinkMode(sourceBoxId) {
    const story = this._findStoryForBox(sourceBoxId);
    this._linkSource = {
      sourceBoxId,
      sourceStoryId: story ? story.id : null,
      sourceSpreadId: this._activeSpreadId
    };
    this.mode = 'link';
    this.shell?.setMode('link');
    this.update({ full: false });
  }

  /** Exit link mode without linking. */
  _exitLinkMode() {
    this._linkSource = null;
    if (this.mode === 'link') {
      this.setMode('object');
    }
  }

  /**
   * Link: append the target story's boxes to the source story's chain.
   * The target story's text content is merged into the source story
   * (appended as additional paragraphs).
   */
  _linkBoxes(targetBoxId) {
    const sourceBoxId = this._linkSource.sourceBoxId;
    const sourceStoryId = this._linkSource.sourceStoryId;
    const sourceSpreadId = this._linkSource.sourceSpreadId;

    const targetStory = this._findStoryForBox(targetBoxId);
    if (!targetStory) {
      this._exitLinkMode();
      return;
    }

    const targetText = targetStory.editor.story
      .map(p => p.map(r => r.text).join('')).join('');

    if (sourceSpreadId === this._activeSpreadId) {
      const sourceStory = this._findStoryForBox(sourceBoxId);
      if (!sourceStory || sourceStory === targetStory) {
        this._exitLinkMode();
        return;
      }

      this.submitAction('Link Text Frames', () => {
        // Append target story's box IDs to source story's chain
        sourceStory.boxIds = [...sourceStory.boxIds, ...targetStory.boxIds];

        // Merge the target story's text into the source story.
        // If the target story is empty (single paragraph with empty text),
        // don't add extra content.
        if (targetText.length > 0) {
          sourceStory.editor.insertStory(
            targetStory.editor.story,
            targetStory.editor.paragraphStyles,
          );
        }

        // Remove the target story
        this._stories = this._stories.filter(s => s !== targetStory);

        this._linkSource = null;
        this.setMode('object');
      });
      return;
    }

    // CROSS-SPREAD LINKING!
    this.submitAction('Link Text Frames Across Spreads', async () => {
      let sourceStoryEntry = this._stories.find(s => s.id === sourceStoryId);

      if (sourceStoryEntry) {
        // Source story is already loaded on this active spread
        sourceStoryEntry.boxIds = [...sourceStoryEntry.boxIds, targetBoxId];
        if (targetText.length > 0) {
          sourceStoryEntry.editor.insertStory(
            targetStory.editor.story,
            targetStory.editor.paragraphStyles
          );
        }
      } else {
        // Source story is NOT loaded on this spread. Load it from store, update it, and add to _stories.
        const styleMap = await loadParagraphStyles(this._docPath);
        const { story: sourceStoryText, paragraphStyles: sourceParagraphStyles } = await loadStoryFromStore(
          this._docPath,
          sourceStoryId,
          { baseFontSize: this._fontSize, styleMap }
        );

        // Ensure at least one paragraph
        if (sourceStoryText.length === 0) {
          sourceStoryText.push([{ text: '', style: cloneStyle() }]);
          sourceParagraphStyles.push(cloneParagraphStyle({ fontSize: this._fontSize }));
        }

        const sourceEditor = new EditorState(sourceStoryText, sourceParagraphStyles);
        if (targetText.length > 0) {
          sourceEditor.insertStory(
            targetStory.editor.story,
            targetStory.editor.paragraphStyles
          );
        }

        sourceStoryEntry = {
          id: sourceStoryId,
          editor: sourceEditor,
          boxIds: [targetBoxId],
          lineMap: []
        };
        this._stories.push(sourceStoryEntry);
      }

      // Remove the old target story from active stories
      this._stories = this._stories.filter(s => s !== targetStory);

      // Save the updated source story file immediately to store
      const storyJson = serializeStory(sourceStoryId, sourceStoryEntry.editor);
      await putJson(`/store/${this._docPath}/stories/${sourceStoryId}.json`, storyJson);

      // Force a save of the active spread and active stories to commit the changes
      await this._save();

      this._linkSource = null;
      this.setMode('object');
      await this.update();
    });
  }

  /**
   * Unlink: split the chain at `boxId`, creating a new independent story
   * from all boxes after `boxId` in the chain.
   */
  _unlinkAt(boxId) {
    const story = this._findStoryForBox(boxId);
    if (!story) return;

    const posInChain = story.boxIds.indexOf(boxId);
    if (posInChain < 0 || posInChain >= story.boxIds.length - 1) return;

    const keepBoxIds = story.boxIds.slice(0, posInChain + 1);
    const splitBoxIds = story.boxIds.slice(posInChain + 1);

    this.submitAction('Unlink Text Frames', () => {
      // Create a new story for the split-off boxes with empty content
      const emptyStory = [[{ text: '', style: { bold: false, italic: false } }]];
      const emptyStyles = [{ fontSize: this._fontSize }];
      const newStoryEntry = {
        id: `story-${this._storyCounter++}`,
        editor: new EditorState(emptyStory, emptyStyles),
        boxIds: splitBoxIds,
        lineMap: [],
        overflow: false,
      };

      story.boxIds = keepBoxIds;
      this._stories = [...this._stories, newStoryEntry];
    });
  }

  /**
   * Delete the currently selected box (text or image).
   * For text boxes: removes the box from its story chain. If the box is the
   * only member of the story, the entire story is removed. If the box is
   * part of a multi-box chain, it is spliced out and the remaining boxes
   * stay linked.
   */
  _deleteSelectedBox() {
    return deleteSelectedBox(this);
  }

  _registerCommands(shell) {
    // Register Standard Text Commands
    registerTextCommands(shell, {
      getEditor: () => this.editor,
      submitAction: (label, fn) => {
        this.submitAction(label, fn);
        this.container.focus();
      },
      applyFontSize: (size) => {
        if (this.editor) {
          if (this.editor.paragraphStyles) {
            const range = this.editor.getSelectionRange();
            if (range) {
              for (let pi = range.start.paraIndex; pi <= range.end.paraIndex; pi++) {
                if (this.editor.paragraphStyles[pi]) {
                  this.editor.paragraphStyles[pi].fontSize = size;
                }
              }
            } else {
              const pi = this.editor.cursor.paraIndex;
              if (this.editor.paragraphStyles[pi]) {
                this.editor.paragraphStyles[pi].fontSize = size;
              }
            }
          }
          if (!this.editor.hasSelection()) {
            this.editor.applyCharacterStyleToCurrentParagraph({ fontSize: size });
          } else {
            this.editor.applyCharacterStyle({ fontSize: size });
          }
        }
        this._scheduleStyleUpdate();
      },
      applyLineHeight: (lh) => {
        this._lineHeight = lh;
        if (this.editor && this.editor.paragraphStyles) {
          const range = this.editor.getSelectionRange();
          if (range) {
            for (let pi = range.start.paraIndex; pi <= range.end.paraIndex; pi++) {
              if (this.editor.paragraphStyles[pi]) {
                this.editor.paragraphStyles[pi].lineHeight = lh;
              }
            }
          } else {
            const pi = this.editor.cursor.paraIndex;
            if (this.editor.paragraphStyles[pi]) {
              this.editor.paragraphStyles[pi].lineHeight = lh;
            }
          }
        }
        this._scheduleStyleUpdate();
      }
    });
  }

  /**
   * Coalesce rapid style-change updates (e.g. from a 60fps slider drag) into
   * a single layout pass per animation frame. Without this, concurrent
   * renderToContainer calls each clear container.innerHTML, which can trigger
   * a pointercancel event on the active range input in Chrome, aborting the
   * native drag.
   */
  _scheduleStyleUpdate() {
    if (this._styleUpdateRaf) return;
    this._styleUpdateRaf = requestAnimationFrame(() => {
      this._styleUpdateRaf = null;
      this.update();
    });
  }

  _registerSaveCommand(shell) {
    shell.commands.register({
      id: 'doc.save',
      label: 'Save',
      icon: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"></path>
        <polyline points="17 21 17 13 7 13 7 21"></polyline>
        <polyline points="7 3 7 8 15 8"></polyline>
      </svg>`,
      execute: () => this._save(),
      isEnabled: () => !!this._docPath && !this._saving,
      shortcut: 'Ctrl+S',
    });

    // Intercept Ctrl+S globally to prevent the browser's Save dialog
    window.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        if (this._docPath && !this._saving) {
          shell.commands.execute('doc.save');
        }
      }
    });

    // Open PDF exporter for this document
    shell.commands.register({
      id: 'doc.print',
      label: 'Export PDF',
      icon: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <polyline points="6 9 6 2 18 2 18 9"></polyline>
        <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"></path>
        <rect x="6" y="14" width="12" height="8"></rect>
      </svg>`,
      execute: async () => {
        if (this._docPath) {
          // Auto-save any unsaved modifications first before exporting/printing
          const hasSave = shell.commands.get('doc.save');
          if (hasSave && hasSave.isEnabled()) {
            try {
              await shell.commands.execute('doc.save');
            } catch (err) {
              console.error('Auto-save failed before print:', err);
            }
          }
          window.open(`/pdf-exporter/index.html?doc=${encodeURIComponent(this._docPath)}`, '_blank');
        }
      },
      isEnabled: () => !!this._docPath,
    });

    // Open selected text box in the story editor
    shell.commands.register({
      id: 'story.edit',
      label: 'Edit Story',
      icon: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
        <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
      </svg>`,
      execute: () => {
        const story = this._findStoryForBox(this.selectedBoxId);
        if (story && this._docPath) {
          window.open(`/store/${this._docPath}/stories/${story.id}/edit`, '_blank');
        }
      },
      isEnabled: () => !!this._docPath && !!this.selectedBoxId &&
        !!this._findStoryForBox(this.selectedBoxId),
    });

    // Zoom commands
    shell.commands.register({
      id: 'view.zoom-in',
      label: 'Zoom In',
      execute: () => this.zoomBy(this._zoomStep),
      shortcut: 'Ctrl+=',
    });
    shell.commands.register({
      id: 'view.zoom-out',
      label: 'Zoom Out',
      execute: () => this.zoomBy(1 / this._zoomStep),
      shortcut: 'Ctrl+-',
    });
    shell.commands.register({
      id: 'view.zoom-fit',
      label: 'Zoom to Fit',
      execute: () => this.zoomToFit(),
      shortcut: 'Ctrl+0',
    });

    // Ctrl+scroll wheel zoom (pinch on trackpad sends ctrlKey=true)
    this.container.addEventListener('wheel', (e) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      e.preventDefault();
      const factor = e.deltaY < 0 ? this._zoomStep : 1 / this._zoomStep;
      const rect = this.container.getBoundingClientRect();
      this.zoomBy(factor, { x: e.clientX - rect.left, y: e.clientY - rect.top });
    }, { passive: false });

    // Keyboard zoom shortcuts (intercept globally to prevent browser zoom)
    window.addEventListener('keydown', (e) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      if (e.key === '=' || e.key === '+') {
        e.preventDefault();
        shell.commands.execute('view.zoom-in');
      } else if (e.key === '-') {
        e.preventDefault();
        shell.commands.execute('view.zoom-out');
      } else if (e.key === '0') {
        e.preventDefault();
        shell.commands.execute('view.zoom-fit');
      }
    });
  }

  // ---------------------------------------------------------------------------
  // Zoom
  // ---------------------------------------------------------------------------

  /**
   * Multiply the current zoom level by the given factor.
   * @param {number} factor - e.g. 1.1 to zoom in, 1/1.1 to zoom out
   * @param {{ x: number, y: number }} [origin] - pointer position in container-relative
   *   pixels; when provided the content under that point stays fixed after zoom.
   */
  zoomBy(factor, origin) {
    return zoomBy(this, factor, origin);
  }

  zoomToFit() {
    return zoomToFit(this);
  }

  _applyZoom() {
    return applyZoom(this);
  }

  _projectPoint(x, y) {
    return projectPoint(this, x, y);
  }

  _projectSize(size) {
    return projectSize(this, size);
  }

  _updateOverlay() {
    return updateOverlay(this);
  }

  _decorateSpreadOverlay(overlay, spread, project, projectSize) {
    return decorateSpreadOverlay(this, overlay, spread, project, projectSize);
  }

  // ---------------------------------------------------------------------------
  // Save — serialize in-memory state to the document store
  // ---------------------------------------------------------------------------

  async _save() {
    const res = await saveSpread(this);
    this._pagesPanelTimestamp = Date.now();
    this._clearPagesPanel();
    return res;
  }

  _serializeSpread() {
    return serializeSpread(this);
  }

  /**
   * Register as an AbstractItem for clipboard serialization
   * and wire up paste-received / cut-executed event handlers.
   */
  _initClipboard(shell) {
    return initClipboard(this, shell);
  }

  _registerCreatables(shell) {
    return registerCreatables(this, shell);
  }

  _createTextFrame() {
    return createTextFrame(this);
  }

  _createImageFrame() {
    return createImageFrame(this);
  }

  _emptyImagePlaceholder() {
    return emptyImagePlaceholder();
  }

  submitAction(label, fn) {
    // Snapshot all stories' states for undo
    const prevStories = this._stories.map(s => ({
      id: s.id,
      editorState: s.editor.getState(),
      boxIds: [...s.boxIds],
    }));
    const prevActiveStoryId = this._activeStory?.id;
    const prevState = {
      stories: prevStories,
      activeStoryId: prevActiveStoryId,
      storyCounter: this._storyCounter,
      fontSize: this._fontSize,
      lineHeight: this._lineHeight,
      boxes: this.boxes.map(b => ({ ...b })),
      imageBoxes: this.imageBoxes.map(b => ({ ...b })),
    };

    const action = {
      label,
      execute: async () => {
        await fn();
        await this.update();
      },
      undo: async () => {
        // Restore all stories from snapshot
        this._storyCounter = prevState.storyCounter;
        this._stories = prevState.stories.map(snap => ({
          id: snap.id,
          editor: new EditorState([], []),
          boxIds: [...snap.boxIds],
          lineMap: [],
        }));
        for (let i = 0; i < this._stories.length; i++) {
          this._stories[i].editor.setState(prevState.stories[i].editorState);
        }
        this._activeStory = this._stories.find(s => s.id === prevState.activeStoryId) || this._stories[0] || null;
        // Re-wire interaction controller to restored active editor
        if (this._textInteraction && this._activeStory) {
          this._textInteraction.setEditor(this._activeStory.editor);
        }
        this._fontSize = prevState.fontSize;
        this._lineHeight = prevState.lineHeight;
        this.boxes = prevState.boxes;
        this.imageBoxes = prevState.imageBoxes;
        await this.update();
      }
    };

    this.shell.history.submit(action);
  }

  async handlePaste(payload) {
    return handlePaste(this, payload);
  }

  _blobToDataUrl(blob) {
    return blobToDataUrl(blob);
  }

  _loadImageBlob(blob) {
    return loadImageBlob(blob);
  }

  _prepareImageAsset(blob, filename) {
    return prepareImageAsset(this, blob, filename);
  }

  _placeImageBox(blob, filename) {
    return placeImageBox(this, blob, filename);
  }

  _placeImageBoxAt(blob, filename, cx, cy) {
    return placeImageBoxAt(this, blob, filename, cx, cy);
  }

  _placeAssetBoxAt(assetRef, ext, cx, cy) {
    return placeAssetBoxAt(this, assetRef, ext, cx, cy);
  }

  _initDragDrop() {
    return initDragDrop(this);
  }

  _showDropHighlight() {
    return showDropHighlight(this);
  }

  _hideDropHighlight() {
    return hideDropHighlight(this);
  }

  /** Render all image boxes as SVG <image> elements inside the given SVG. */
  _renderImageBoxes(svg) {
    if (this.imageBoxes.length === 0) {
      const existing = svg.querySelector('[data-layer="image-boxes"]');
      if (existing) existing.remove();
      return;
    }

    let g = svg.querySelector('[data-layer="image-boxes"]');
    if (!g) {
      g = document.createElementNS(SVG_NS, 'g');
      g.setAttribute('data-layer', 'image-boxes');
      svg.appendChild(g);
    }

    // Keep track of active box IDs to clean up orphaned elements
    const activeIds = new Set(this.imageBoxes.map(b => b.id));

    // Remove any elements in g that don't belong to active image boxes
    for (const child of Array.from(g.children)) {
      const nestedId = child.getAttribute('data-box-nested-id');
      const bgId = child.getAttribute('data-box-bg-id');
      const boxId = nestedId || bgId;
      if (boxId && !activeIds.has(boxId)) {
        child.remove();
      }
    }

    for (const box of this.imageBoxes) {
      const placement = getImagePlacement(box);
      const isSelected = box.id === this.selectedBoxId;
      const isMode3 = isSelected && this.activeCroppingMode === 3;

      // Handle Mode 3 background image
      let bgImg = g.querySelector(`[data-box-bg-id="${box.id}"]`);
      if (isMode3) {
        if (!bgImg) {
          bgImg = document.createElementNS(SVG_NS, 'image');
          bgImg.setAttribute('data-box-bg-id', box.id);
          bgImg.setAttribute('preserveAspectRatio', 'none');
          bgImg.setAttribute('style', 'opacity: 0.5; pointer-events: none;');
          bgImg.setAttribute('data-image-box-bg', 'true');
          // Insert before the nested SVG to draw behind it
          const nested = g.querySelector(`[data-box-nested-id="${box.id}"]`);
          if (nested) {
            g.insertBefore(bgImg, nested);
          } else {
            g.appendChild(bgImg);
          }
        }
        if (bgImg.getAttribute('href') !== box.imageUrl) {
          bgImg.setAttribute('href', box.imageUrl);
        }
        bgImg.setAttribute('x', String(box.x + placement.x));
        bgImg.setAttribute('y', String(box.y + placement.y));
        bgImg.setAttribute('width', String(placement.w));
        bgImg.setAttribute('height', String(placement.h));
      } else {
        if (bgImg) {
          bgImg.remove();
        }
      }

      // Handle nested SVG
      let nested = g.querySelector(`[data-box-nested-id="${box.id}"]`);
      let imgEl;
      if (!nested) {
        nested = document.createElementNS(SVG_NS, 'svg');
        nested.setAttribute('data-box-nested-id', box.id);
        nested.setAttribute('overflow', 'hidden');
        nested.setAttribute('style', 'pointer-events: none;');

        imgEl = document.createElementNS(SVG_NS, 'image');
        imgEl.setAttribute('preserveAspectRatio', 'none');
        imgEl.setAttribute('data-image-box', 'true');
        imgEl.setAttribute('data-box-id', box.id);
        nested.appendChild(imgEl);
        g.appendChild(nested);
      } else {
        imgEl = nested.querySelector('image');
      }

      nested.setAttribute('x', String(box.x));
      nested.setAttribute('y', String(box.y));
      nested.setAttribute('width', String(box.width));
      nested.setAttribute('height', String(box.height));

      if (imgEl) {
        if (imgEl.getAttribute('href') !== box.imageUrl) {
          imgEl.setAttribute('href', box.imageUrl);
        }
        imgEl.setAttribute('x', String(placement.x));
        imgEl.setAttribute('y', String(placement.y));
        imgEl.setAttribute('width', String(placement.w));
        imgEl.setAttribute('height', String(placement.h));
      }
    }
  }

  setStatus(msg, type = '') {
    if (this.statusEl) {
      this.statusEl.setText(msg, type);
    }
  }

  bindEvents() {
    this.container.addEventListener('dblclick', async (e) => {
      if (!this._svg) return;
      const target = e.target;
      const boxId = target?.dataset?.boxId;
      if (boxId) {
        const isImage = this.imageBoxes.some(b => b.id === boxId);
        if (isImage) {
          e.stopPropagation();
          e.preventDefault();
          this.selectedBoxId = boxId;
          this.activeCroppingMode = 3;
          await this.update();
        }
      } else {
        if (this.activeCroppingMode === 3) {
          this.activeCroppingMode = 1;
          await this.update();
        }
      }
    });

    this.container.addEventListener('pointerdown', async (e) => {
      if (!this._svg) return;

      const target = e.target;
      const boxId = target?.dataset?.boxId;
      const handle = target?.dataset?.handle;

      this._wasSelectedBeforeDown = (this.selectedBoxId === boxId);

      // --- Port clicks (output port or overflow marker) ---
      const portType = target?.dataset?.port;
      const portBox = target?.dataset?.portBox;
      const isOverflow = target?.dataset?.overflow === 'true';

      if ((portType === 'output' || isOverflow) && portBox) {
        e.stopPropagation();
        this._handleOutputPortClick(portBox);
        return;
      }

      // --- Link mode: target click ---
      if (this.mode === 'link' && target?.dataset?.linkTarget === 'true' && boxId) {
        e.stopPropagation();
        this._linkBoxes(boxId);
        return;
      }

      // --- Link mode: background/cancel click ---
      if (this.mode === 'link') {
        // Any click that isn't on a valid target cancels link mode
        this._exitLinkMode();
        return;
      }

      // If not clicking a box or handle, it might be a background click
      // or a click on text/selection/cursor elements inside the text frame.
      if (!boxId && !handle) {
        // In text mode, check if the click is inside a text box before
        // treating it as a background click. Text content (<text>, <tspan>),
        // selection highlights (#text-selection), and the cursor line
        // (#text-cursor) don't carry data-box-id, but clicks on them
        // should stay in text mode and be handled by TextInteractionController.
        if (this.mode === 'text') {
          const isTextContent = target?.closest &&
            (target.closest('#text-selection') || target.closest('#text-cursor') ||
             target.closest('text'));

          // For text content clicks and geometric hits alike, check whether
          // the click lands inside a different story's box and switch story
          // before letting TextInteractionController place the cursor.
          const pt = this._interaction._toSvgPoint(e);
          if (pt) {
            const hitBox = this.boxes.find(b =>
              pt.x >= b.x && pt.x <= b.x + b.width &&
              pt.y >= b.y && pt.y <= b.y + b.height
            );
            if (hitBox) {
              const storyEntry = this._findStoryForBox(hitBox.id);
              const storyLineMap = storyEntry?.lineMap || [];
              const boxHasLines = storyLineMap.some(line =>
                Math.abs(line.colX - hitBox.x) < 1 &&
                Math.abs(line.boxY - hitBox.y) < 1
              );
              if (!boxHasLines && storyEntry) {
                // Empty box: place cursor at end of story.
                e.stopImmediatePropagation();
                this._activateStoryForBox(hitBox.id);
                this.selectedBoxId = hitBox.id;
                const ed = storyEntry.editor;
                const lastPara = ed.story.length - 1;
                const lastParaText = ed.story[lastPara]
                  ?.map(r => r.text).join('') || '';
                ed.moveCursor({
                  paraIndex: lastPara,
                  charOffset: lastParaText.length,
                });
                await this.update();
                return;
              }
              if (storyEntry && storyEntry !== this._activeStory) {
                // Box with lines belonging to a different story: activate it
                // first so TextInteractionController uses the correct line map.
                e.stopImmediatePropagation();
                this._activateStoryForBox(hitBox.id);
                this.selectedBoxId = hitBox.id;
                if (this._textInteraction) {
                  await this._textInteraction._handlePointerDown(e);
                }
                return;
              }
              // Same story — let TextInteractionController handle it.
              if (isTextContent) return;
              return;
            }
          }

          if (isTextContent) return;
        }
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
          const clickedBox = this.boxes.find(b => b.id === boxId);
          if (clickedBox) {
            const storyEntry = this._findStoryForBox(boxId);
            const storyLineMap = storyEntry?.lineMap || [];
            const boxHasLines = storyLineMap.some(line =>
              Math.abs(line.colX - clickedBox.x) < 1 &&
              Math.abs(line.boxY - clickedBox.y) < 1
            );
            if (!boxHasLines && storyEntry) {
              // Empty box: intercept and place cursor at end of story.
              e.stopImmediatePropagation();
              this._activateStoryForBox(boxId);
              this.selectedBoxId = boxId;
              const ed = storyEntry.editor;
              const lastPara = ed.story.length - 1;
              const lastParaText = ed.story[lastPara]
                ?.map(r => r.text).join('') || '';
              ed.moveCursor({
                paraIndex: lastPara,
                charOffset: lastParaText.length,
              });
              await this.update();
              return;
            }
            if (storyEntry && storyEntry !== this._activeStory) {
              // Box with lines belonging to a different story: activate it
              // first so TextInteractionController uses the correct line map.
              e.stopImmediatePropagation();
              this._activateStoryForBox(boxId);
              this.selectedBoxId = boxId;
              if (this._textInteraction) {
                await this._textInteraction._handlePointerDown(e);
              }
              return;
            }
          }
          return;
        }

        if (handle && this._interaction.pointerDown(e, boxId, handle)) {
          return;
        }
      }
    });

    this.container.addEventListener('pointerup', () => {
        this._isDragging = false;
    });

    this.container.addEventListener('click', async (e) => {
      const target = e.target;
      const boxId = target?.dataset?.boxId;
      
      if (this.mode !== 'text' && boxId) {
        // Just selecting a box in object mode
        if (!this._wasSelectedBeforeDown) {
          this.selectedBoxId = boxId;
          await this.update();
        }
      }
    });

    // Escape key: cancel link mode, or exit text mode back to object mode
    this.container.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.mode === 'link') {
        e.preventDefault();
        this._exitLinkMode();
      } else if (e.key === 'Escape' && this.mode === 'text') {
        e.preventDefault();
        this.setMode('object');
      }
    });

    window.addEventListener('beforeunload', () => {
      if (this.cursor) this.cursor.destroy();
      if (this._textInteraction) this._textInteraction.destroy();
    });

    window.addEventListener('popstate', async () => {
      const params = new URLSearchParams(window.location.search);
      const pageParam = params.get('page');
      if (pageParam) {
        await this.navigateToPage(pageParam);
      }
    });
  }
  /**
   * Draw spread decoration (pasteboard, pages, spine) into the content SVG.
   * These zoom with the content — they represent the physical page surfaces.
   */
  _decorateSpreadContent(svg, spread) {
    decorateSpreadForEditor(svg, spread);
  }

  async update(options = { full: true }) {
    const startTime = performance.now();
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
      pagesConfig: this._activeSpreadPages,
    });
    this.currentSpread = spread;

    // When loaded from the store, skip default box creation — boxes
    // were already populated by _loadFromStore().
    if (!this._loadedFromStore) {
      if (this.boxes.length === 0) {
        this.boxes = createBoxesFromDefaults(spread.boxes);
        this._defaultBoxCount = spread.boxes.length;
        this.selectedBoxId = this.boxes[0]?.id || null;
        // Assign default boxes to the initial story
        if (this._stories.length > 0 && this._stories[0].boxIds.length === 0) {
          this._stories[0].boxIds = this.boxes.map(b => b.id);
        }
      }
      // Only reset boxes to match layout defaults if no user-created frames
      // have been added (i.e. count still matches the initial default count).
      if (this._defaultBoxCount !== undefined &&
          this.boxes.length === this._defaultBoxCount &&
          this.boxes.length !== spread.boxes.length) {
        const defaults = createBoxesFromDefaults(spread.boxes);
        this.boxes = defaults.map((d, i) => {
          const existing = this.boxes[i];
          if (!existing) return d;
          return {
            ...existing,
            id: d.id,
          };
        });
        this._defaultBoxCount = spread.boxes.length;
        this.selectedBoxId = this.boxes[0]?.id || null;
        // Update initial story's boxIds to match new defaults
        if (this._stories.length > 0) {
          this._stories[0].boxIds = this.boxes
            .filter(b => !b.id.startsWith('text-'))
            .map(b => b.id);
        }
      }
    }
    this.boxes = clampBoxesToBounds(this.boxes, spread.pasteboardRect);

    let svg = this._svg;

    if (isFull || !svg) {
      // Build the list of stories in the format renderSpread expects:
      // each story provides its own EditorState rather than loading from store.
      // We drive renderSpread with an in-memory spread definition derived
      // from the current boxes and story entries.
      let baseSvg = null;

      for (const storyEntry of this._stories) {
        const storyBoxes = storyEntry.boxIds
          .map(id => this.boxes.find(b => b.id === id))
          .filter(Boolean);

        if (storyBoxes.length === 0) {
          storyEntry.lineMap = [];
          storyEntry.overflow = false;
          continue;
        }

        const offset = (this.flowAnchors && this.flowAnchors[storyEntry.id]) || { paragraphIndex: 0, charOffset: 0 };
        const { slicedStory, slicedStyles, sliceStartOffset } = sliceStory(
          storyEntry.editor.story,
          storyEntry.editor.paragraphStyles,
          offset.paragraphIndex,
          offset.charOffset
        );

        const paragraphLayoutStyles = buildParagraphLayoutStyles(
          this._fontSize, slicedStyles);

        let result;
        if (!baseSvg) {
          // First story: render and attach to container
          result = await this.engine.renderToContainer(
            this.container,
            slicedStory,
            storyBoxes,
            this._fontSize,
            this._lineHeight,
            paragraphLayoutStyles,
          );
          baseSvg = result.svg;
        } else {
          // Additional stories: render off-screen, transplant content
          result = await this.engine.renderStory(
            slicedStory,
            storyBoxes,
            this._fontSize,
            this._lineHeight,
            paragraphLayoutStyles,
          );

          // Transplant all child elements from the secondary SVG into
          // the base SVG. Skip box background <rect>s (the overlay draws those).
          for (const child of Array.from(result.svg.childNodes)) {
            if (child.tagName === 'rect') continue;
            baseSvg.appendChild(child);
          }
        }

        storyEntry.lineMap = result.lineMap.map(entry => {
          const isFirstSlicedPara = entry.paraIndex === offset.paragraphIndex;
          return {
            ...entry,
            positions: entry.positions.map(pos => ({
              ...pos,
              charPos: isFirstSlicedPara ? pos.charPos + sliceStartOffset : pos.charPos
            }))
          };
        });
        storyEntry.overflow = result.overflow || false;
      }

      svg = baseSvg || this._svg;
      this._svg = svg;

      // renderToContainer clears the container (innerHTML = ''), which
      // removes the overlay SVG. Re-append it so it stays on top.
      if (this._overlaySvg && !this.container.contains(this._overlaySvg)) {
        this.container.appendChild(this._overlaySvg);
      }
    }

    if (!svg) return;

    // Determine the active story's lineMap for cursor operations
    const activeLineMap = this._activeStory?.lineMap || [];

    // Render image boxes into the SVG (they are not part of text layout)
    this._renderImageBoxes(svg);

    const pb = spread.pasteboardRect;
    svg.classList.add('content-svg');
    svg.setAttribute('width', String(pb.width * this._zoom));
    svg.setAttribute('height', String(pb.height * this._zoom));
    svg.setAttribute(
      'viewBox',
      `${pb.x} ${pb.y} ${pb.width} ${pb.height}`,
    );

    // Draw spread decoration (pasteboard, pages, spine) in the content SVG
    // so it zooms with the content. These are the physical page backgrounds.
    this._decorateSpreadContent(svg, spread);

    // Redraw the non-zoomed overlay (handles, ports, margin guides, box frames)
    this._updateOverlay();

    if (this.cursor) {
      this.cursor.setStory(this.editor.story);
      this.cursor.updateLayout(svg, activeLineMap, fontSize);
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
        this._textInteraction.setEditor(this.editor);
      }
    } else {
      this.cursor = new TextCursor(svg, this.editor.story, activeLineMap, this._fontSize);
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

    // Sync Document Model so Layers panel shows text/image boxes
    this._syncDocumentModel();

    // Rebuild ribbon so controls (font size, line height, bold/italic)
    // reflect the current paragraph's style after cursor movement.
    this.shell?.requestUpdate();

    const duration = performance.now() - startTime;
    console.log(`[spread-editor] Active spread "${this._activeSpreadId}" layout and render took ${duration.toFixed(2)}ms. Flow anchors: ${JSON.stringify(this.flowAnchors)}`);
  }

  _initSelectionSync(shell) {
    return initSelectionSync(this, shell);
  }

  _syncDocumentModel() {
    if (!this.shell?.doc) return;

    // We reconcile the doc items to avoid flickering or clearing selection
    const currentIds = new Set();
    
    // Always include the story item (legacy/global)
    if (this.storyItem) {
      currentIds.add(this.storyItem.id);
      if (!this.shell.doc.get(this.storyItem.id)) {
        this.shell.doc.registerItem(this.storyItem);
      }
    }

    // Register all text boxes
    this.boxes.forEach(box => {
      currentIds.add(box.id);
      let item = this.shell.doc.get(box.id);
      if (!item) {
        item = new AbstractItem(box.id, 'text-frame', `Text Frame ${box.id.replace('box-', '')}`);
        item.data = box;
        this.shell.doc.registerItem(item);
      } else {
        item.data = box; // Update data
      }
    });

    // Register all image boxes
    this.imageBoxes.forEach(box => {
      currentIds.add(box.id);
      let item = this.shell.doc.get(box.id);
      if (!item) {
        item = new AbstractItem(box.id, 'image-frame', `Image Frame ${box.id.replace('image-', '')}`);
        item.data = box;
        this.shell.doc.registerItem(item);
      } else {
        item.data = box; // Update data
      }
    });

    // Remove orphaned items (except story item if still needed)
    this.shell.doc.getAll().forEach(item => {
      if (!currentIds.has(item.id)) {
        this.shell.doc.removeItem(item.id);
      }
    });
  }

  getRibbonSections(selected) {
    const sections = [];

    // Document section — always visible (Save + Export PDF buttons)
    if (this._docPath) {
      sections.push(AppShell.createRibbonSection('Document', (container) => {
        container.appendChild(this.shell.ui.createButton({
          commandId: 'doc.save',
        }));
        container.appendChild(this.shell.ui.createButton({
          commandId: 'doc.print',
        }));
      }));
    }

    // Cropping & Placement section — visible when an image box is selected
    if (this.mode === 'object' && this.selectedBoxId) {
      const isImage = this.imageBoxes.some(b => b.id === this.selectedBoxId);
      if (isImage) {
        sections.push(AppShell.createRibbonSection('Cropping', (container) => {
          container.appendChild(this.shell.ui.createButton({
            label: 'Combined',
            active: this.activeCroppingMode === 1,
            onClick: () => {
              this.activeCroppingMode = 1;
              this.update();
            }
          }));
          container.appendChild(this.shell.ui.createButton({
            label: 'Edit Frame',
            active: this.activeCroppingMode === 2,
            onClick: () => {
              this.activeCroppingMode = 2;
              this.update();
            }
          }));
          container.appendChild(this.shell.ui.createButton({
            label: 'Edit Content',
            active: this.activeCroppingMode === 3,
            onClick: () => {
              this.activeCroppingMode = 3;
              this.update();
            }
          }));
        }));
      }
    }

    // Story section — "Edit Story" button when a text box is selected
    if (this.mode === 'object' && this.selectedBoxId && this._docPath &&
        this._findStoryForBox(this.selectedBoxId)) {
      sections.push(AppShell.createRibbonSection('Story', (container) => {
        container.appendChild(this.shell.ui.createButton({
          commandId: 'story.edit',
        }));
      }));
    }

    // Text-mode sections
    if (this.mode !== 'object' && this.editor) {
      const typingStyle = this.editor.getTypingStyle();
      sections.push(
        TextTools.createTypographySection(this.shell, {
          fontFamily: typingStyle.fontFamily || 'EB Garamond',
          bold: !!typingStyle.bold,
          italic: !!typingStyle.italic
        })
      );
    }

    return sections;
  }

  getSelection() {
    if (this.selectedBoxId) {
      const box = this.boxes.find(b => b.id === this.selectedBoxId) || 
                  this.imageBoxes.find(b => b.id === this.selectedBoxId);
      if (box) return [box];
    }
    return [];
  }

  getPanelDescriptors(selected) {
    const descriptors = [];
    const item = Array.isArray(selected) ? selected[0] : (selected || null);
    const activeBox = item?.data || item;

    if (this.mode === 'text' && this.editor) {
      // Text Editing Mode
      descriptors.push({
        label: 'Text Mode',
        properties: [
          {
            key: 'active-story',
            label: 'Story ID',
            type: 'readonly',
            value: this._activeStory?.id || '?'
          }
        ]
      });

      const textGroups = getTextPropertyDescriptors(this.shell, this.editor, {
        lineHeight: this._lineHeight 
      });
      descriptors.push(...textGroups);
    }
    
    if (activeBox) {
      // Object Selection Mode
      const isImage = this.imageBoxes.some(b => b.id === activeBox.id);

      descriptors.push({
        label: isImage ? 'Image Frame' : 'Text Frame',
        properties: [
          {
            key: 'id',
            label: 'ID',
            type: 'readonly',
            value: activeBox.id
          },
          {
            key: 'x',
            label: 'X',
            type: 'number',
            value: Math.round(activeBox.x),
            onChange: (val) => {
              this.submitAction('Move Box', () => {
                activeBox.x = Number(val);
              });
            }
          },
          {
            key: 'y',
            label: 'Y',
            type: 'number',
            value: Math.round(activeBox.y),
            onChange: (val) => {
              this.submitAction('Move Box', () => {
                activeBox.y = Number(val);
              });
            }
          },
          {
            key: 'w',
            label: 'Width',
            type: 'number',
            value: Math.round(activeBox.w),
            onChange: (val) => {
              this.submitAction('Resize Box', () => {
                activeBox.w = Number(val);
              });
            }
          },
          {
            key: 'h',
            label: 'Height',
            type: 'number',
            value: Math.round(activeBox.h),
            onChange: (val) => {
              this.submitAction('Resize Box', () => {
                activeBox.h = Number(val);
              });
            }
          }
        ]
      });

      if (isImage) {
        descriptors.push({
          label: 'Properties',
          properties: [
            {
              key: 'asset',
              label: 'Asset',
              type: 'readonly',
              value: activeBox.assetRef || 'None'
            }
          ]
        });
      }
    } else {
      // Default / Document Info
      descriptors.push({
        label: 'Spread Info',
        properties: [
          {
            key: 'zoom',
            label: 'Zoom',
            type: 'readonly',
            value: Math.round(this._zoom * 100) + '%'
          },
          {
            key: 'stories',
            label: 'Stories',
            type: 'readonly',
            value: this._stories.length
          }
        ]
      });
    }

    return descriptors;
  }

  async selectSpread(spreadId) {
    if (spreadId === this._activeSpreadId) return;

    // Auto-save current spread first
    if (this._docPath && !this._saving) {
      try {
        await this._save();
      } catch (err) {
        console.error('Auto-save failed before switching spreads:', err);
      }
    }

    const prevLinkMode = this.mode === 'link' ? { ...this._linkSource } : null;

    this._activeSpreadId = spreadId;
    this.selectedBoxId = null;
    this.cursor = null;
    if (this._textInteraction) {
      this._textInteraction.destroy();
      this._textInteraction = null;
    }

    this.setMode('object');

    await this._loadFromStore();

    if (prevLinkMode) {
      this._linkSource = prevLinkMode;
      this.mode = 'link';
      this.shell?.setMode('link');
      this.selectedBoxId = null; // Do not auto-select box in link mode
    }

    this._pagesPanelTimestamp = Date.now();
    await this.update();
    this.setStatus('Ready - spread editor active.', 'ok');
    this.shell?.updatePanels();
  }

  async recalculatePageNumbers() {
    let currentGlobalPageIndex = 0;
    const puts = [];
    for (const spreadId of this._spreadsList) {
      try {
        const spreadJson = await loadSpread(this._docPath, spreadId);
        const updatedPages = (spreadJson.pages || []).map((page, idx) => {
          const nextIndex = currentGlobalPageIndex + idx;
          return {
            index: page.index !== undefined ? page.index : idx,
            label: String(nextIndex + 1)
          };
        });
        spreadJson.pages = updatedPages;
        this._spreadsMetadata[spreadId] = { pages: updatedPages };
        
        if (spreadId === this._activeSpreadId) {
          this._activeSpreadPages = updatedPages;
        }
        
        puts.push(putJson(`/store/${this._docPath}/spreads/${spreadId}.json`, spreadJson));
        currentGlobalPageIndex += updatedPages.length;
      } catch (err) {
        console.error(`Failed to load/update pages for spread ${spreadId}:`, err);
      }
    }
    await Promise.all(puts);
  }

  promptSpreadConfiguration() {
    return new Promise((resolve) => {
      const dialog = document.createElement('scribus-dialog');
      dialog.setAttribute('heading', 'New Spread Configuration');
      
      const body = document.createElement('div');
      body.style.display = 'flex';
      body.style.flexDirection = 'column';
      body.style.gap = '12px';
      body.style.padding = '8px 0';
      body.style.color = '#e1e1e6';
      body.style.fontSize = '0.85rem';
      
      const label = document.createElement('label');
      label.textContent = 'Choose the spread layout:';
      
      const select = document.createElement('select');
      select.style.background = '#1e1e20';
      select.style.border = '1px solid #2e2e32';
      select.style.color = '#e1e1e6';
      select.style.padding = '8px';
      select.style.borderRadius = '6px';
      select.style.fontSize = '0.85rem';
      select.style.outline = 'none';
      select.style.cursor = 'pointer';
      
      const opt1 = document.createElement('option');
      opt1.value = 'facing';
      opt1.textContent = '2 Pages (Facing)';
      select.appendChild(opt1);
      
      const opt2 = document.createElement('option');
      opt2.value = 'left';
      opt2.textContent = '1 Page (Left Page Only)';
      select.appendChild(opt2);
      
      const opt3 = document.createElement('option');
      opt3.value = 'right';
      opt3.textContent = '1 Page (Right Page Only)';
      select.appendChild(opt3);
      
      body.appendChild(label);
      body.appendChild(select);
      dialog.appendChild(body);
      
      const actions = document.createElement('div');
      actions.setAttribute('slot', 'actions');
      actions.style.display = 'flex';
      actions.style.gap = '8px';
      
      const cancelBtn = document.createElement('button');
      cancelBtn.textContent = 'Cancel';
      cancelBtn.style.background = 'transparent';
      cancelBtn.style.color = '#a1a1aa';
      cancelBtn.style.border = '1px solid #2e2e32';
      cancelBtn.style.padding = '6px 14px';
      cancelBtn.style.borderRadius = '6px';
      cancelBtn.style.cursor = 'pointer';
      cancelBtn.style.fontSize = '0.85rem';
      
      const okBtn = document.createElement('button');
      okBtn.textContent = 'Create';
      okBtn.style.background = 'var(--accent, #bb86fc)';
      okBtn.style.color = '#121214';
      okBtn.style.border = 'none';
      okBtn.style.padding = '6px 14px';
      okBtn.style.borderRadius = '6px';
      okBtn.style.fontWeight = '600';
      okBtn.style.cursor = 'pointer';
      okBtn.style.fontSize = '0.85rem';
      
      actions.appendChild(cancelBtn);
      actions.appendChild(okBtn);
      dialog.appendChild(actions);
      
      document.body.appendChild(dialog);
      dialog.show();
      
      let resolved = false;
      const cleanUp = () => {
        if (dialog.parentNode) {
          document.body.removeChild(dialog);
        }
      };

      cancelBtn.addEventListener('click', () => {
        resolved = true;
        dialog.close();
        cleanUp();
        resolve(null);
      });
      
      okBtn.addEventListener('click', () => {
        resolved = true;
        const val = select.value;
        dialog.close();
        cleanUp();
        resolve(val);
      });
      
      dialog.addEventListener('close', () => {
        cleanUp();
        if (!resolved) {
          resolve(null);
        }
      });
    });
  }

  async addSpread() {
    if (!this._docPath) return;

    // Prompt user for spread configuration
    const configType = await this.promptSpreadConfiguration();
    if (!configType) return; // User cancelled
    
    // Determine the next spread ID
    let maxNum = 0;
    if (this._spreadsList) {
      this._spreadsList.forEach(id => {
        const m = id.match(/spread-(\d+)/);
        if (m) {
          const val = parseInt(m[1], 10);
          if (val > maxNum) maxNum = val;
        }
      });
    }
    const newSpreadId = `spread-${maxNum + 1}`;
    
    // Auto-save the current spread first
    if (!this._saving) {
      try {
        await this._save();
      } catch (err) {
        console.error('Auto-save failed before adding spread:', err);
      }
    }

    // Build pages list based on configuration type
    let pages = [];
    if (configType === 'facing') {
      pages = [
        { index: 0, label: '?' },
        { index: 1, label: '?' }
      ];
    } else if (configType === 'left') {
      pages = [
        { index: 0, label: '?' }
      ];
    } else if (configType === 'right') {
      pages = [
        { index: 1, label: '?' }
      ];
    }

    const newSpreadJson = {
      pages,
      frames: []
    };

    // Save the new spread JSON to the store
    await putJson(`/store/${this._docPath}/spreads/${newSpreadId}.json`, newSpreadJson);
    await updateDocTimestamp(this._docPath);

    // Update local cached state
    this._layoutCache = null;
    if (!this._spreadsList) {
      this._spreadsList = [];
    }
    this._spreadsList.push(newSpreadId);
    this._spreadsMetadata[newSpreadId] = { pages: newSpreadJson.pages };

    // Recalculate page numbers for all spreads sequentially
    await this.recalculatePageNumbers();

    // Find the global page index of the first page of the new spread
    let firstPageIndex = 1;
    if (this._spreadsList) {
      for (const spreadId of this._spreadsList) {
        if (spreadId === newSpreadId) break;
        const pgs = this._spreadsMetadata[spreadId]?.pages || [];
        firstPageIndex += pgs.length;
      }
    }

    // Update the URL parameter first so selectSpread/loadFromStore picks it up
    const params = new URLSearchParams(window.location.search);
    params.set('page', String(firstPageIndex));
    const newUrl = `${window.location.pathname}?${params.toString()}`;
    window.history.replaceState(null, '', newUrl);

    // Load and select the new spread
    this._activeSpreadId = null; // force reload
    await this.selectSpread(newSpreadId);
    this.jumpToPage(firstPageIndex);
  }

  async deleteSpread(spreadId) {
    if (!this._docPath) return;
    if (!this._spreadsList || this._spreadsList.length <= 1) {
      this.setStatus('Cannot delete the last remaining spread.', 'error');
      return;
    }

    const idx = this._spreadsList.indexOf(spreadId);
    if (idx === -1) return;

    // Find the next spread to switch to
    let nextActiveSpreadId = null;
    if (idx > 0) {
      nextActiveSpreadId = this._spreadsList[idx - 1];
    } else {
      nextActiveSpreadId = this._spreadsList[1];
    }

    // Hit the store DELETE endpoint for both the JSON and the preview JPG
    await Promise.all([
      fetch(`/store/${this._docPath}/spreads/${spreadId}.json`, { method: 'DELETE' }),
      fetch(`/store/${this._docPath}/spreads/${spreadId}.jpg`, { method: 'DELETE' }).catch(() => {}),
    ]);

    // Remove from local list and cache
    this._spreadsList.splice(idx, 1);
    delete this._spreadsMetadata[spreadId];

    // Recalculate page numbers for the remaining spreads
    await this.recalculatePageNumbers();
    await updateDocTimestamp(this._docPath);

    // Force pages panel rebuild on next update
    this._clearPagesPanel();
    this._layoutCache = null;

    // Switch spread if we deleted the active one
    if (spreadId === this._activeSpreadId) {
      let firstPageIndex = 1;
      if (this._spreadsList) {
        for (const id of this._spreadsList) {
          if (id === nextActiveSpreadId) break;
          const pgs = this._spreadsMetadata[id]?.pages || [];
          firstPageIndex += pgs.length;
        }
      }
      const params = new URLSearchParams(window.location.search);
      params.set('page', String(firstPageIndex));
      const newUrl = `${window.location.pathname}?${params.toString()}`;
      window.history.replaceState(null, '', newUrl);

      this._activeSpreadId = null; // force reload
      await this.selectSpread(nextActiveSpreadId);
      this.jumpToPage(firstPageIndex);
    } else {
      this._pagesPanelTimestamp = Date.now();
      this.shell?.updatePanels();
    }
  }

  jumpToPage(pageParam) {
    const spread = this.currentSpread;
    if (!spread) return;

    // Find the target page globally to get its label and index
    let targetPage = null;
    let totalIndex = 0;
    let targetGlobalIndex = 0;

    if (this._spreadsList) {
      for (const spreadId of this._spreadsList) {
        const pgs = this._spreadsMetadata[spreadId]?.pages || [];
        for (const page of pgs) {
          totalIndex++;
          if (String(totalIndex) === String(pageParam) || page.label === String(pageParam)) {
            targetPage = page;
            targetGlobalIndex = totalIndex;
            break;
          }
        }
        if (targetPage) break;
      }
    }

    if (!targetPage) return;

    const pages = this._activeSpreadPages || [];
    // Match page within active spread using index
    const pageIndexInSpread = pages.findIndex(p => p.index === targetPage.index);
    if (pageIndexInSpread === -1) return;

    const pageRect = spread.pageRects[pageIndexInSpread];
    if (!pageRect) return;

    const pb = spread.pasteboardRect;
    const cw = this.container.clientWidth;
    const ch = this.container.clientHeight;

    // Calculate zoomed position of page in content SVG coordinates
    const pageLeftPx = (pageRect.x - pb.x) * this._zoom;
    const pageWidthPx = pageRect.width * this._zoom;
    const pageTopPx = (pageRect.y - pb.y) * this._zoom;
    const pageHeightPx = pageRect.height * this._zoom;

    // Scroll so the page is centered in the container viewport
    this.container.scrollLeft = pageLeftPx - (cw - pageWidthPx) / 2;
    this.container.scrollTop = pageTopPx - (ch - pageHeightPx) / 2;

    // Redraw overlay
    this._updateOverlay();

    // Update the 'page' query parameter in the URL with the unique global index
    const params = new URLSearchParams(window.location.search);
    params.set('page', String(targetGlobalIndex));
    const newUrl = `${window.location.pathname}?${params.toString()}`;
    window.history.replaceState(null, '', newUrl);

    // Re-render panels to update active page state
    this.shell?.updatePanels();
  }

  async navigateToPage(pageParam) {
    let targetSpreadId = null;
    let targetPage = null;
    let totalIndex = 0;

    if (this._spreadsList) {
      for (const spreadId of this._spreadsList) {
        const pgs = this._spreadsMetadata[spreadId]?.pages || [];
        for (const page of pgs) {
          totalIndex++;
          if (String(totalIndex) === String(pageParam) || page.label === String(pageParam)) {
            targetPage = page;
            targetSpreadId = spreadId;
            break;
          }
        }
        if (targetPage) break;
      }
    }

    if (!targetPage) return;

    // Update query parameter FIRST so selectSpread/loadFromStore loads the correct spread
    const params = new URLSearchParams(window.location.search);
    params.set('page', String(totalIndex));
    const newUrl = `${window.location.pathname}?${params.toString()}`;
    window.history.replaceState(null, '', newUrl);

    if (targetSpreadId !== this._activeSpreadId) {
      this.setStatus(`Loading ${targetSpreadId}...`);
      await this.selectSpread(targetSpreadId);
    }

    // Centering scroll and update query parameter
    this.jumpToPage(totalIndex);
  }

  getPanelContent(panelId, selected) {
    // Reset panel-body to its default styles (overridden by the assets panel to
    // enable internal scrolling; must be restored when switching to other panels).
    const panelBody = this.shell?.element?.panelBody;
    if (panelBody && panelId !== 'assets' && panelId !== 'pages') {
      panelBody.style.overflow = '';
      panelBody.style.padding = '';
    }

    if (panelId === 'pages') {
      if (panelBody) {
        panelBody.style.overflow = 'hidden';
        panelBody.style.padding = '0';
      }

      if (!this._pagesPanelContainer) {
        this._pagesPanelContainer = this._buildPagesPanel();
      }

      this._updateActiveSpreadCard();
      return this._pagesPanelContainer;
    }

    if (panelId === 'assets') {
      // .panel-body is in shadow DOM so CSS injection can't reach it.
      // Set overflow/padding directly so the flex height chain works and
      // .assets-grid (overflow-y: auto; flex: 1; min-height: 0) can scroll.
      if (panelBody) {
        panelBody.style.overflow = 'hidden';
        panelBody.style.padding = '0';
      }

      if (!this._assetsPanelContainer) {
        this._assetsPanelContainer = this._buildAssetsPanel();
      }

      return this._assetsPanelContainer;
    }

    return null;
  }

  _updateActiveSpreadCard() {
    if (!this._pagesPanelContainer) return;
    const cards = this._pagesPanelContainer.querySelectorAll('.page-card');
    cards.forEach(card => {
      const spreadId = card.dataset.spreadId;
      const isActive = spreadId === this._activeSpreadId;
      card.classList.toggle('active', isActive);
    });
  }

  _clearPagesPanel() {
    if (this._pagesPanelContainer) {
      const grid = this._pagesPanelContainer.querySelector('.pages-grid');
      if (grid) {
        this._pagesPanelScrollTop = grid.scrollTop;
      }
    }
    this._pagesPanelContainer = null;
  }

  _buildPagesPanel() {
    const container = document.createElement('div');
    container.className = 'pages-panel';

    const style = document.createElement('style');
    style.textContent = `
      .pages-panel {
        display: flex;
        flex-direction: column;
        gap: 16px;
        padding: 1rem;
        flex: 1;
        min-height: 0;
        overflow: hidden;
        box-sizing: border-box;
        background: #18181c;
      }
      .pages-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        border-bottom: 1px solid var(--border, #2e2e32);
        padding-bottom: 12px;
        margin-bottom: 8px;
        flex-shrink: 0;
      }
      .pages-title {
        font-size: 0.8rem;
        font-weight: 600;
        color: var(--text-main, #e1e1e6);
        margin: 0;
        text-transform: uppercase;
        letter-spacing: 0.05em;
      }
      .pages-count {
        font-size: 0.72rem;
        color: var(--accent, #bb86fc);
        background: rgba(187, 134, 252, 0.08);
        border: 1px solid rgba(187, 134, 252, 0.2);
        padding: 1px 6px;
        border-radius: 20px;
      }
      .pages-grid {
        display: flex;
        flex-direction: column;
        gap: 16px;
        overflow-y: auto;
        flex: 1;
        min-height: 0;
        padding: 4px;
      }
      .page-card {
        display: flex;
        flex-direction: column;
        background: rgba(255, 255, 255, 0.02);
        border: 1px solid var(--border, #2e2e32);
        border-radius: 8px;
        padding: 8px;
        cursor: pointer;
        position: relative;
        transition: transform 0.2s cubic-bezier(0.4, 0, 0.2, 1),
                    border-color 0.2s cubic-bezier(0.4, 0, 0.2, 1),
                    box-shadow 0.2s cubic-bezier(0.4, 0, 0.2, 1),
                    background 0.2s cubic-bezier(0.4, 0, 0.2, 1);
        user-select: none;
      }
      .page-card:hover {
        transform: translateY(-2px);
        border-color: var(--accent, #bb86fc);
        box-shadow: 0 6px 16px rgba(0, 0, 0, 0.25);
        background: rgba(255, 255, 255, 0.05);
      }
      .page-card.active {
        border-color: var(--accent, #bb86fc);
        background: rgba(187, 134, 252, 0.08);
        box-shadow: 0 0 12px rgba(187, 134, 252, 0.25);
      }
      .spread-thumbnail-container {
        position: relative;
        width: 100%;
        aspect-ratio: 1.5;
        background: #1e1e20;
        border: 1px solid rgba(255, 255, 255, 0.08);
        border-radius: 6px;
        overflow: hidden;
        margin-bottom: 8px;
        display: flex;
        align-items: center;
        justify-content: center;
      }
      .page-card.active .spread-thumbnail-container {
        border-color: rgba(187, 134, 252, 0.4);
      }
      .spread-thumbnail-img {
        position: absolute;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        object-fit: contain;
        opacity: 0;
        transition: opacity 0.3s ease;
        z-index: 2;
      }
      .spread-thumbnail-img.loaded {
        opacity: 1;
      }
      .spread-fallback {
        position: absolute;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 6px;
        background: linear-gradient(135deg, rgba(255,255,255,0.03) 0%, rgba(255,255,255,0.01) 100%);
        z-index: 1;
        padding: 8px;
        box-sizing: border-box;
      }
      .mini-page {
        background: #ffffff;
        border: 1px solid #c7c1b5;
        border-radius: 2px;
        box-shadow: 0 1px 4px rgba(0,0,0,0.15);
        display: flex;
        align-items: center;
        justify-content: center;
        aspect-ratio: 0.707;
        height: 70%;
        position: relative;
        overflow: hidden;
      }
      .mini-page-label {
        font-size: 0.65rem;
        font-weight: 700;
        color: #1e1e20;
        user-select: none;
      }
      .page-label {
        font-size: 0.75rem;
        font-weight: 600;
        color: var(--text-main, #e1e1e6);
        margin-bottom: 2px;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        max-width: 100%;
      }
      .page-spread-info {
        font-size: 0.65rem;
        color: var(--text-dim, #a1a1aa);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        max-width: 100%;
      }
      .spread-delete-btn {
        position: absolute;
        top: 8px;
        right: 8px;
        background: rgba(0, 0, 0, 0.6);
        border: 1px solid rgba(255, 255, 255, 0.1);
        color: #ef4444;
        border-radius: 4px;
        width: 24px;
        height: 24px;
        display: none;
        align-items: center;
        justify-content: center;
        cursor: pointer;
        transition: background 0.2s, color 0.2s;
        z-index: 10;
      }
      .page-card:hover .spread-delete-btn {
        display: flex;
      }
      .spread-delete-btn:hover {
        background: #ef4444;
        color: #ffffff;
      }
      .pages-footer {
        display: flex;
        justify-content: center;
        padding-top: 12px;
        border-top: 1px solid var(--border, #2e2e32);
        margin-top: auto;
        flex-shrink: 0;
      }
      .add-spread-btn {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 8px;
        background: var(--accent, #bb86fc);
        color: #121214;
        border: none;
        border-radius: 6px;
        padding: 8px 16px;
        font-size: 0.75rem;
        font-weight: 600;
        cursor: pointer;
        transition: background 0.2s, transform 0.1s;
        width: 100%;
      }
      .add-spread-btn:hover {
        background: #d6b4fc;
      }
      .add-spread-btn:active {
        transform: scale(0.98);
      }
    `;
    container.appendChild(style);

    // Header
    const header = document.createElement('div');
    header.className = 'pages-header';

    const title = document.createElement('h3');
    title.className = 'pages-title';
    title.textContent = 'Document Spreads';
    header.appendChild(title);

    const countBadge = document.createElement('span');
    countBadge.className = 'pages-count';
    countBadge.textContent = '0 Spreads';
    header.appendChild(countBadge);

    container.appendChild(header);

    // Parse active page from query parameter or default to active spread's first page
    const urlParams = new URLSearchParams(window.location.search);
    const activePageParam = urlParams.get('page') || (this._activeSpreadPages?.[0]?.label || '1');
    console.log('[PAGES PANEL] activePageParam is:', activePageParam, 'search:', window.location.search);

    // Grid of pages (now spreads)
    const grid = document.createElement('div');
    grid.className = 'pages-grid';

    let totalPagesCount = 0;
    let spreadsCount = 0;

    if (this._spreadsList) {
      this._spreadsList.forEach((spreadId) => {
        const metadata = this._spreadsMetadata?.[spreadId];
        const pages = metadata?.pages || [];
        if (pages.length === 0) return;

        spreadsCount++;
        const firstPageIndex = totalPagesCount + 1;
        const spreadName = spreadId.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());

        const startIdx = totalPagesCount + 1;
        const endIdx = totalPagesCount + pages.length;
        const numParam = parseInt(activePageParam, 10);
        const isActive = !isNaN(numParam)
          ? (numParam >= startIdx && numParam <= endIdx)
          : pages.some(p => p.label === String(activePageParam));

        const card = document.createElement('div');
        card.className = `page-card${isActive ? ' active' : ''}`;
        card.dataset.pageIndex = firstPageIndex;
        card.dataset.spreadId = spreadId;

        // Delete button
        if (this._spreadsList.length > 1) {
          const deleteBtn = document.createElement('button');
          deleteBtn.className = 'spread-delete-btn';
          deleteBtn.title = `Delete ${spreadName}`;
          deleteBtn.innerHTML = `
            <svg style="width: 14px; height: 14px; fill: currentColor;" viewBox="0 0 24 24">
              <path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/>
            </svg>
          `;
          deleteBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            if (confirm(`Are you sure you want to delete ${spreadName}?`)) {
              this.deleteSpread(spreadId);
            }
          });
          card.appendChild(deleteBtn);
        }

        // Thumbnail Container
        const thumbContainer = document.createElement('div');
        thumbContainer.className = 'spread-thumbnail-container';

        // Fallback structure with mini pages
        const fallback = document.createElement('div');
        fallback.className = 'spread-fallback';
        pages.forEach((page) => {
          const miniPage = document.createElement('div');
          miniPage.className = 'mini-page';
          const miniLabel = document.createElement('span');
          miniLabel.className = 'mini-page-label';
          miniLabel.textContent = page.label;
          miniPage.appendChild(miniLabel);
          fallback.appendChild(miniPage);
        });
        thumbContainer.appendChild(fallback);

        // Real JPEG Image Preview
        const img = document.createElement('img');
        img.className = 'spread-thumbnail-img';
        img.alt = spreadName;
        img.src = `/store/${this._docPath}/spreads/${spreadId}.jpg?t=${this._pagesPanelTimestamp}`;
        img.onload = () => {
          img.classList.add('loaded');
        };
        img.onerror = () => {
          img.style.display = 'none';
        };
        thumbContainer.appendChild(img);

        card.appendChild(thumbContainer);

        // Title (Spread Name)
        const label = document.createElement('span');
        label.className = 'page-label';
        label.textContent = spreadName;
        card.appendChild(label);

        // Page Range Info (e.g. "Pages 1-2")
        const spreadInfo = document.createElement('span');
        spreadInfo.className = 'page-spread-info';
        if (pages.length === 1) {
          spreadInfo.textContent = `Page ${pages[0].label}`;
        } else {
          spreadInfo.textContent = `Pages ${pages[0].label}–${pages[pages.length - 1].label}`;
        }
        card.appendChild(spreadInfo);

        card.addEventListener('click', async () => {
          grid.querySelectorAll('.page-card').forEach(c => c.classList.remove('active'));
          card.classList.add('active');
          await this.navigateToPage(firstPageIndex);
        });

        grid.appendChild(card);
        totalPagesCount += pages.length;
      });
    }

    countBadge.textContent = `${spreadsCount} Spreads`;
    container.appendChild(grid);

    if (this._pagesPanelScrollTop !== undefined) {
      setTimeout(() => {
        grid.scrollTop = this._pagesPanelScrollTop;
      }, 0);
    }

    // Footer with Add Spread button
    const footer = document.createElement('div');
    footer.className = 'pages-footer';

    const addBtn = document.createElement('button');
    addBtn.className = 'add-spread-btn';
    addBtn.innerHTML = `
      <svg style="width: 14px; height: 14px; fill: currentColor;" viewBox="0 0 24 24">
        <path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/>
      </svg>
      Add Spread
    `;
    addBtn.addEventListener('click', () => {
      this.addSpread();
    });
    footer.appendChild(addBtn);
    container.appendChild(footer);

    return container;
  }

  _buildAssetsPanel() {
    const container = document.createElement('div');
    container.className = 'assets-panel';

    // Inject styles directly for shadow DOM encapsulation bypass
    const style = document.createElement('style');
    style.textContent = `
      .assets-panel {
        display: flex;
        flex-direction: column;
        gap: 16px;
        padding: 1rem;
        flex: 1;
        min-height: 0;
        overflow: hidden;
        box-sizing: border-box;
      }
      .assets-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        border-bottom: 1px solid var(--border, #2e2e32);
        padding-bottom: 12px;
        margin-bottom: 8px;
      }
      .assets-title {
        font-size: 0.8rem;
        font-weight: 600;
        color: var(--text-main, #e1e1e6);
        margin: 0;
        text-transform: uppercase;
        letter-spacing: 0.05em;
      }
      .assets-count {
        font-size: 0.72rem;
        color: var(--accent, #bb86fc);
        background: rgba(187, 134, 252, 0.08);
        border: 1px solid rgba(187, 134, 252, 0.2);
        padding: 1px 6px;
        border-radius: 20px;
      }
      .assets-upload-zone {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        border: 1px dashed var(--border, #2e2e32);
        border-radius: 8px;
        padding: 12px;
        background: rgba(255, 255, 255, 0.01);
        transition: border-color var(--transition-fast, 0.2s), background var(--transition-fast, 0.2s);
        cursor: pointer;
      }
      .assets-upload-zone:hover {
        border-color: var(--accent, #bb86fc);
        background: rgba(187, 134, 252, 0.02);
      }
      .assets-grid {
        display: flex;
        flex-direction: column;
        gap: 10px;
        overflow-y: auto;
        flex: 1;
        min-height: 0;
        padding-right: 4px;
      }
      .asset-card {
        display: flex;
        gap: 12px;
        background: rgba(255, 255, 255, 0.02);
        border: 1px solid var(--border, #2e2e32);
        border-radius: 8px;
        padding: 8px;
        cursor: grab;
        position: relative;
        transition: transform var(--transition-fast, 0.2s), border-color var(--transition-fast, 0.2s), box-shadow var(--transition-fast, 0.2s), background var(--transition-fast, 0.2s);
        user-select: none;
      }
      .asset-card:hover {
        transform: translateY(-2px);
        border-color: var(--accent, #bb86fc);
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
        background: rgba(255, 255, 255, 0.04);
      }
      .asset-card:active {
        cursor: grabbing;
      }
      .asset-card.dragging {
        opacity: 0.4;
        border: 1px dashed var(--accent, #bb86fc);
      }
      .asset-thumbnail-wrapper {
        width: 56px;
        height: 56px;
        border-radius: 6px;
        overflow: hidden;
        background: #1a1a1c;
        border: 1px solid rgba(255, 255, 255, 0.05);
        display: flex;
        align-items: center;
        justify-content: center;
        flex-shrink: 0;
      }
      .asset-thumbnail {
        width: 100%;
        height: 100%;
        object-fit: cover;
        transition: transform var(--transition-slow, 0.4s);
      }
      .asset-card:hover .asset-thumbnail {
        transform: scale(1.08);
      }
      .asset-thumbnail-wrapper--pending .asset-thumbnail {
        display: none;
      }
      .asset-thumbnail-wrapper--pending::after {
        content: '';
        display: block;
        width: 24px;
        height: 24px;
        background: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%23666' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'%3E%3Crect x='3' y='3' width='18' height='18' rx='2'/%3E%3Ccircle cx='8.5' cy='8.5' r='1.5'/%3E%3Cpath d='m21 15-5-5L5 21'/%3E%3C/svg%3E") center / contain no-repeat;
      }
      .asset-info {
        display: flex;
        flex-direction: column;
        justify-content: center;
        min-width: 0;
        flex: 1;
      }
      .asset-name {
        font-size: 0.8rem;
        font-weight: 500;
        color: var(--text-main, #e1e1e6);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        margin-bottom: 2px;
      }
      .asset-meta {
        font-size: 0.7rem;
        color: var(--text-dim, #a1a1aa);
        display: flex;
        flex-direction: column;
        gap: 1px;
      }
      .asset-actions {
        display: flex;
        flex-direction: column;
        justify-content: space-around;
        opacity: 0;
        transition: opacity var(--transition-fast, 0.2s);
        position: absolute;
        right: 8px;
        top: 8px;
        bottom: 8px;
        background: rgba(30, 30, 32, 0.95);
        padding: 0 6px;
        border-radius: 4px;
        backdrop-filter: blur(4px);
        border: 1px solid var(--border, #2e2e32);
      }
      .asset-card:hover .asset-actions {
        opacity: 1;
      }
      .asset-action-btn {
        background: none;
        border: none;
        color: var(--text-dim, #a1a1aa);
        cursor: pointer;
        padding: 4px;
        border-radius: 4px;
        transition: color var(--transition-fast, 0.2s), background var(--transition-fast, 0.2s);
        display: flex;
        align-items: center;
        justify-content: center;
      }
      .asset-action-btn:hover {
        color: var(--accent, #bb86fc);
        background: rgba(255, 255, 255, 0.05);
      }
      .asset-action-btn.delete:hover {
        color: #ff6b6b;
        background: rgba(255, 107, 107, 0.08);
      }
      .asset-empty-state {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        padding: 30px 15px;
        text-align: center;
        border: 1px dashed var(--border, #2e2e32);
        border-radius: 8px;
        background: rgba(255, 255, 255, 0.01);
        color: var(--text-dim, #a1a1aa);
        font-size: 0.78rem;
      }
      .asset-empty-icon {
        font-size: 1.8rem;
        margin-bottom: 10px;
        color: var(--text-dim, #a1a1aa);
        opacity: 0.4;
        display: flex;
        align-items: center;
        justify-content: center;
      }
    `;
    container.appendChild(style);

    // 1. Header
    const header = document.createElement('div');
    header.className = 'assets-header';

    const title = document.createElement('h3');
    title.className = 'assets-title';
    title.textContent = 'Document Assets';
    header.appendChild(title);

    const assetKeys = Object.keys(this._assets || {});
    const countBadge = document.createElement('span');
    countBadge.className = 'assets-count';
    countBadge.textContent = assetKeys.length;
    header.appendChild(countBadge);

    container.appendChild(header);

    // 2. Upload Section
    const uploadInput = document.createElement('input');
    uploadInput.type = 'file';
    uploadInput.accept = 'image/*';
    uploadInput.style.display = 'none';
    container.appendChild(uploadInput);

    const uploadZone = document.createElement('div');
    uploadZone.className = 'assets-upload-zone';
    
    const uploadBtn = document.createElement('scribus-button');
    uploadBtn.setAttribute('label', 'Upload Asset');
    uploadBtn.setAttribute('primary', '');
    uploadBtn.setAttribute('icon', `
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
        <polyline points="17 8 12 3 7 8"></polyline>
        <line x1="12" y1="3" x2="12" y2="15"></line>
      </svg>
    `);
    
    uploadZone.appendChild(uploadBtn);
    container.appendChild(uploadZone);

    const handleUpload = async (file) => {
      if (!file) return;
      this.setStatus(`Uploading ${file.name}...`);
      try {
        const mime = file.type || 'image/png';
        const { width, height } = await this._loadImageBlob(file);
        const name = assetNameFromFilename(file.name);
        await uploadImageAsset(this._docPath, name, file, { mime, width, height });
        this._assets = await loadAssets(this._docPath);
        this.setStatus('Asset uploaded successfully.', 'ok');
        this.shell?.updatePanels();
        this._startPreviewWorker();
      } catch (err) {
        console.error('Failed to upload asset:', err);
        this.setStatus('Upload failed.', 'error');
      }
    };

    uploadZone.addEventListener('click', () => uploadInput.click());
    uploadInput.addEventListener('change', (e) => {
      const file = e.target.files?.[0];
      if (file) handleUpload(file);
    });

    // Support drag and drop files onto the upload zone itself!
    uploadZone.addEventListener('dragover', (e) => {
      e.preventDefault();
      uploadZone.style.borderColor = 'var(--accent)';
      uploadZone.style.background = 'rgba(187, 134, 252, 0.04)';
    });
    uploadZone.addEventListener('dragleave', () => {
      uploadZone.style.borderColor = '';
      uploadZone.style.background = '';
    });
    uploadZone.addEventListener('drop', (e) => {
      e.preventDefault();
      uploadZone.style.borderColor = '';
      uploadZone.style.background = '';
      const file = e.dataTransfer?.files?.[0];
      if (file && file.type.startsWith('image/')) {
        handleUpload(file);
      }
    });

    // 3. Assets list
    if (assetKeys.length === 0) {
      const emptyState = document.createElement('div');
      emptyState.className = 'asset-empty-state';
      
      const emptyIcon = document.createElement('span');
      emptyIcon.className = 'asset-empty-icon';
      emptyIcon.innerHTML = `
        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
          <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
          <circle cx="8.5" cy="8.5" r="1.5"></circle>
          <polyline points="21 15 16 10 5 21"></polyline>
        </svg>
      `;
      emptyState.appendChild(emptyIcon);

      const emptyText = document.createElement('span');
      emptyText.textContent = 'No assets found. Click upload or drag images here to add assets.';
      emptyState.appendChild(emptyText);

      container.appendChild(emptyState);
    } else {
      const grid = document.createElement('div');
      grid.className = 'assets-grid';

      for (const [key, asset] of Object.entries(this._assets)) {
        const ext = extFromMime(asset.mime);
        const previewUrl = asset.preview
          ? `/store/${this._docPath}/assets/${key}/${asset.preview}`
          : null;

        const card = document.createElement('div');
        card.className = 'asset-card';
        card.id = 'asset-card-' + key;
        card.setAttribute('draggable', 'true');

        // Drag events
        card.addEventListener('dragstart', (e) => {
          card.classList.add('dragging');
          e.dataTransfer.setData('application/x-scribus-asset', JSON.stringify({ assetRef: key, ext }));
          e.dataTransfer.effectAllowed = 'copy';
        });
        card.addEventListener('dragend', () => {
          card.classList.remove('dragging');
        });

        // Thumbnail
        const thumbWrapper = document.createElement('div');
        thumbWrapper.className = 'asset-thumbnail-wrapper' + (previewUrl ? '' : ' asset-thumbnail-wrapper--pending');

        const img = document.createElement('img');
        img.className = 'asset-thumbnail';
        if (previewUrl) img.src = previewUrl;
        img.alt = key;
        thumbWrapper.appendChild(img);
        card.appendChild(thumbWrapper);

        // Info
        const info = document.createElement('div');
        info.className = 'asset-info';

        const name = document.createElement('div');
        name.className = 'asset-name';
        name.textContent = key;
        name.title = key;
        info.appendChild(name);

        const meta = document.createElement('div');
        meta.className = 'asset-meta';

        const dims = document.createElement('span');
        dims.textContent = `${asset.width} × ${asset.height}`;
        meta.appendChild(dims);

        const size = document.createElement('span');
        const sizeKb = Math.round(asset.sizeBytes / 1024);
        size.textContent = sizeKb >= 1024 
          ? `${(sizeKb / 1024).toFixed(1)} MB` 
          : `${sizeKb} KB`;
        meta.appendChild(size);

        info.appendChild(meta);
        card.appendChild(info);

        // Actions
        const actions = document.createElement('div');
        actions.className = 'asset-actions';

        // Delete button
        const delBtn = document.createElement('button');
        delBtn.className = 'asset-action-btn delete';
        delBtn.title = 'Delete Asset';
        delBtn.innerHTML = `
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="3 6 5 6 21 6"></polyline>
            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
            <line x1="10" y1="11" x2="10" y2="17"></line>
            <line x1="14" y1="11" x2="14" y2="17"></line>
          </svg>
        `;
        delBtn.addEventListener('click', async (e) => {
          e.stopPropagation();
          if (confirm(`Are you sure you want to delete asset "${key}"?`)) {
            this.setStatus(`Deleting ${key}...`);
            try {
              const res = await fetch(`/store/${this._docPath}/assets/${key}`, { method: 'DELETE' });
              if (!res.ok) throw new Error(`Delete failed: ${res.status}`);
              const trash = await res.json();
              this._assets = await loadAssets(this._docPath);
              this.setStatus('Asset deleted.', 'ok');
              this.shell?.updatePanels();
              this.shell?.history.submit({
                undo: async () => {
                  await fetch('/store/.trash/restore', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(trash),
                  });
                  this._assets = await loadAssets(this._docPath);
                  this.setStatus('Asset restored.', 'ok');
                  this.shell?.updatePanels();
                },
                redo: async () => {
                  const r = await fetch(`/store/${this._docPath}/assets/${key}`, { method: 'DELETE' });
                  if (!r.ok) throw new Error(`Re-delete failed: ${r.status}`);
                  Object.assign(trash, await r.json());
                  this._assets = await loadAssets(this._docPath);
                  this.setStatus('Asset deleted.', 'ok');
                  this.shell?.updatePanels();
                },
              });
            } catch (err) {
              console.error('Failed to delete asset:', err);
              this.setStatus('Delete failed.', 'error');
            }
          }
        });
        actions.appendChild(delBtn);

        // Insert button (double click or click on this inserts at active page center)
        const insBtn = document.createElement('button');
        insBtn.className = 'asset-action-btn';
        insBtn.title = 'Insert Image Frame';
        insBtn.innerHTML = `
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <line x1="12" y1="5" x2="12" y2="19"></line>
            <line x1="5" y1="12" x2="19" y2="12"></line>
          </svg>
        `;
        insBtn.addEventListener('click', async (e) => {
          e.stopPropagation();
          if (this.currentSpread) {
            const page = this.currentSpread.pageRects[0];
            const cx = page.x + page.width / 2;
            const cy = page.y + page.height / 2;
            await this._placeAssetBoxAt(key, ext, cx, cy);
          }
        });
        actions.appendChild(insBtn);

        card.appendChild(actions);

        // Handle double click on card to insert
        card.addEventListener('dblclick', async () => {
          if (this.currentSpread) {
            const page = this.currentSpread.pageRects[0];
            const cx = page.x + page.width / 2;
            const cy = page.y + page.height / 2;
            await this._placeAssetBoxAt(key, ext, cx, cy);
          }
        });

        grid.appendChild(card);
      }

      container.appendChild(grid);
    }

    return container;
  }
}
