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
  serializeStory,
  putJson,
  updateDocTimestamp,
  uploadImageAsset,
  assetNameFromFilename,
  extFromMime,
  loadSpread,
  loadParagraphStyles,
  loadStoryFromStore,
  loadAssets,
} from '../../document-store/lib/document-store.js';
import { computeSpreadLayout } from './spread-geometry.js';
import { createBoxesFromDefaults, clampBoxesToBounds } from './box-model.js';
import { drawBoxOverlay } from './box-overlay.js';
import { BoxInteractionController } from './box-interactions.js';
import shell, { AppShell } from '../../app-shell/lib/shell-core.js';
import { AbstractItem } from '../../app-shell/lib/document-model.js';
import { TextTools } from '../../app-shell/lib/text-tools.js';
import { getTextPropertyDescriptors } from '../../app-shell/lib/text-property-descriptors.js';
import { registerTextCommands } from '../../app-shell/lib/text-commands.js';
import { createLayoutEngine } from '../../doc-renderer/lib/layout-document.js';
import { decorateSpreadForEditor } from '../../doc-renderer/lib/svg-renderer.js';

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

    this._activeSpreadId = 'spread-1';
    this._spreadsList = null;
    this._spreadsMetadata = {};
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
        setBoxes: (next) => {
          const all = [...this.boxes, ...this.imageBoxes];
          const updated = typeof next === 'function' ? next(all) : next;
          // Partition back into text boxes and image boxes
          this.boxes = updated.filter(b => !b.imageUrl);
          this.imageBoxes = updated.filter(b => !!b.imageUrl);
          this.update(); // fire-and-forget from interaction handler
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
    if (!this._spreadsList || this._spreadsList.length === 0) return;
    
    this._spreadsMetadata = {};
    const promises = this._spreadsList.map(async (spreadId) => {
      try {
        const spreadJson = await loadSpread(this._docPath, spreadId);
        this._spreadsMetadata[spreadId] = {
          pages: spreadJson.pages || []
        };
      } catch (err) {
        console.warn(`Failed to load metadata for spread ${spreadId}:`, err);
        this._spreadsMetadata[spreadId] = { pages: [] };
      }
    });
    await Promise.all(promises);
  }

  async _loadFromStore() {
    this.setStatus('Loading document from store...');

    // Clear existing spread-specific data to prevent accumulation when switching
    this.boxes = [];
    this.imageBoxes = [];
    this._stories = [];
    this._activeStory = null;
    this._imageBoxCounter = 0;
    this._storyCounter = 0;
    this._loadedFromStore = false;

    // Discover spreads dynamically if not already done
    if (!this._spreadsList) {
      try {
        const response = await fetch(`/store/${this._docPath}`);
        if (response.ok) {
          const files = await response.json();
          const spreadFiles = files.filter(f => f.startsWith('spreads/') && f.endsWith('.json'));
          this._spreadsList = spreadFiles.map(f => {
            const parts = f.split('/');
            const filename = parts[parts.length - 1];
            return filename.replace('.json', '');
          });
          // Sort spreads list numerically if possible
          this._spreadsList.sort((a, b) => {
            const numA = parseInt(a.replace(/[^\d]/g, ''), 10);
            const numB = parseInt(b.replace(/[^\d]/g, ''), 10);
            if (!isNaN(numA) && !isNaN(numB)) return numA - numB;
            return a.localeCompare(b);
          });
          
          await this._loadAllSpreadsMetadata();
        }
      } catch (err) {
        console.warn('Failed to list spreads from store:', err);
      }
    }

    if (!this._spreadsList || this._spreadsList.length === 0) {
      this._spreadsList = ['spread-1'];
      this._spreadsMetadata['spread-1'] = {
        pages: [{ index: 0, label: '1' }, { index: 1, label: '2' }]
      };
    }

    if (!this._activeSpreadId) {
      this._activeSpreadId = this._spreadsList[0] || 'spread-1';
    }

    // 1. Load the spread definition
    const spreadJson = await loadSpread(this._docPath, this._activeSpreadId);
    
    // Save pages configuration for serialization
    this._activeSpreadPages = spreadJson.pages || [
      { index: 0, label: '1' },
      { index: 1, label: '2' }
    ];

    // 2. Load paragraph style definitions (for resolving styleRef)
    const styleMap = await loadParagraphStyles(this._docPath);

    // 3. Parse frames into boxes and collect storyRefs to load
    const storyRefsToLoad = new Set();
    // Map from storyRef -> ordered list of box IDs in that story chain
    const storyBoxMap = new Map();

    // Pre-load asset metadata so we can resolve assetRefs to URLs
    const assetMeta = await loadAssets(this._docPath);
    this._assets = assetMeta;

    for (const frame of spreadJson.frames || []) {
      if (frame.type === 'image') {
        let imageUrl;
        let assetRef;
        let assetExt;

        if (frame.assetRef) {
          // Resolve assetRef to a URL using metadata or fallback
          assetRef = frame.assetRef;
          const meta = assetMeta[assetRef];
          if (meta && meta.preview) {
            imageUrl = `/store/${this._docPath}/assets/${assetRef}/${meta.preview}`;
            assetExt = 'jpg';
          } else {
            imageUrl = this._emptyImagePlaceholder();
            assetExt = 'jpg';
          }
        } else {
          imageUrl = frame.imageUrl || this._emptyImagePlaceholder();
        }

        this.imageBoxes.push({
          id: frame.id,
          x: frame.x,
          y: frame.y,
          width: frame.width,
          height: frame.height,
          minWidth: 20,
          minHeight: 20,
          imageUrl,
          ...(assetRef ? { assetRef, assetExt } : {}),
        });
        this._imageBoxCounter++;
      } else {
        // Text frame
        this.boxes.push({
          id: frame.id,
          x: frame.x,
          y: frame.y,
          width: frame.width,
          height: frame.height,
          minWidth: 80,
          minHeight: 60,
        });
        if (frame.storyRef) {
          storyRefsToLoad.add(frame.storyRef);
          if (!storyBoxMap.has(frame.storyRef)) {
            storyBoxMap.set(frame.storyRef, []);
          }
          storyBoxMap.get(frame.storyRef).push(frame.id);
        }
      }
    }

    // 4. Load each referenced story
    const storyPromises = [...storyRefsToLoad].map(async (storyRef) => {
      try {
        const { story, paragraphStyles } = await loadStoryFromStore(
          this._docPath,
          storyRef,
          { baseFontSize: this._fontSize, styleMap }
        );

        // Ensure at least one paragraph
        if (story.length === 0) {
          story.push([{ text: '', style: cloneStyle() }]);
          paragraphStyles.push(cloneParagraphStyle({ fontSize: this._fontSize }));
        }

        return {
          storyRef,
          id: storyRef,
          story,
          paragraphStyles,
          boxIds: storyBoxMap.get(storyRef) || [],
        };
      } catch (err) {
        console.warn(`Failed to load story ${storyRef}:`, err);
        return null;
      }
    });

    const loadedStories = (await Promise.all(storyPromises)).filter(Boolean);

    // 5. Build story entries
    this._stories = [];
    for (const loaded of loadedStories) {
      const storyEntry = {
        id: loaded.id,
        editor: new EditorState(loaded.story, loaded.paragraphStyles),
        boxIds: loaded.boxIds,
        lineMap: [],
      };
      this._stories.push(storyEntry);
      this._storyCounter++;
    }

    // If no stories were loaded, create an empty fallback
    if (this._stories.length === 0) {
      const emptyStory = [[{ text: '', style: cloneStyle() }]];
      const emptyStyles = [cloneParagraphStyle({ fontSize: this._fontSize })];
      this._stories.push({
        id: `story-${this._storyCounter++}`,
        editor: new EditorState(emptyStory, emptyStyles),
        boxIds: this.boxes.map(b => b.id),
        lineMap: [],
      });
    }

    this._activeStory = this._stories[0];
    // Mark boxes as loaded so update() won't overwrite with defaults
    this._loadedFromStore = true;
    this.selectedBoxId = this.boxes[0]?.id || this.imageBoxes[0]?.id || null;

    // Kick off browser-based preview generation for any image boxes that
    // are still showing the empty placeholder (no preview in meta.json yet).
    const placeholder = this._emptyImagePlaceholder();
    const needsPreview = this.imageBoxes.some(b => b.imageUrl === placeholder);
    if (needsPreview) {
      this._startPreviewWorker();
    }
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
    iframe.src = '/image-converter/preview-worker.html';
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
    const placeholder = this._emptyImagePlaceholder();
    const stale = this.imageBoxes.filter(b => b.imageUrl === placeholder && b.assetRef);
    if (stale.length === 0) return;

    let changed = false;
    await Promise.all(stale.map(async (box) => {
      try {
        const metaUrl = `/store/${this._docPath}/assets/${box.assetRef}/meta.json`;
        const res = await fetch(metaUrl);
        if (!res.ok) return;
        const meta = await res.json();
        if (meta.preview) {
          box.imageUrl = `/store/${this._docPath}/assets/${box.assetRef}/${meta.preview}?t=${Date.now()}`;
          changed = true;
        }
      } catch { /* ignore */ }
    }));

    if (changed) await this.update();
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

  /** Enter link mode — waiting for the user to click a target frame. */
  _enterLinkMode(sourceBoxId) {
    this._linkSource = { sourceBoxId };
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
    const sourceStory = this._findStoryForBox(this._linkSource.sourceBoxId);
    const targetStory = this._findStoryForBox(targetBoxId);
    if (!sourceStory || !targetStory || sourceStory === targetStory) {
      this._exitLinkMode();
      return;
    }

    this.submitAction('Link Text Frames', () => {
      // Append target story's box IDs to source story's chain
      sourceStory.boxIds = [...sourceStory.boxIds, ...targetStory.boxIds];

      // Merge the target story's text into the source story.
      // If the target story is empty (single paragraph with empty text),
      // don't add extra content.
      const targetText = targetStory.editor.story
        .map(p => p.map(r => r.text).join('')).join('');
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
    if (this.mode !== 'object' || !this.selectedBoxId) return;

    const boxId = this.selectedBoxId;
    const isImage = this.imageBoxes.some(b => b.id === boxId);

    this.submitAction('Delete Frame', () => {
      if (isImage) {
        this.imageBoxes = this.imageBoxes.filter(b => b.id !== boxId);
      } else {
        // Remove from the story chain
        const story = this._findStoryForBox(boxId);
        if (story) {
          story.boxIds = story.boxIds.filter(id => id !== boxId);
          // If no boxes remain, remove the story entirely
          if (story.boxIds.length === 0) {
            this._stories = this._stories.filter(s => s !== story);
            if (this._activeStory === story) {
              this._activeStory = this._stories[0] || null;
            }
          }
        }
        this.boxes = this.boxes.filter(b => b.id !== boxId);
      }
      this.selectedBoxId = null;
    });
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
        this._fontSize = size;
        if (this.editor) {
          const pi = this.editor.cursor.paraIndex;
          if (this.editor.paragraphStyles && this.editor.paragraphStyles[pi]) {
            this.editor.paragraphStyles[pi].fontSize = size;
          }
          if (!this.editor.hasSelection()) {
            this.editor.applyCharacterStyleToCurrentParagraph({ fontSize: size });
          } else {
            this.editor.applyCharacterStyle({ fontSize: size });
          }
        }
        // While the slider thumb is being dragged, skip the full layout rebuild.
        // renderToContainer clears container.innerHTML which causes visible
        // flashing and layout reflows that shift the slider's viewport position,
        // corrupting Chrome's native drag position calculation.
        // Instead, defer a single update for after the drag ends.
        const slider = this.shell?.ribbonContainer?.querySelector('scribus-input#font-size');
        if (slider?._dragging) {
          clearTimeout(this._fontSizeDragTimer);
          this._fontSizeDragTimer = setTimeout(() => this._scheduleStyleUpdate(), 200);
          return;
        }
        this._scheduleStyleUpdate();
      },
      applyLineHeight: (lh) => {
        this._lineHeight = lh;
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
    const oldZoom = this._zoom;
    this._zoom = Math.max(this._zoomMin, Math.min(this._zoomMax, oldZoom * factor));
    const actualFactor = this._zoom / oldZoom;

    if (origin && actualFactor !== 1) {
      // Content pixel under origin before zoom: scrollOffset + originInViewport
      const contentX = this.container.scrollLeft + origin.x;
      const contentY = this.container.scrollTop + origin.y;
      this._applyZoom();
      // Shift scroll so the same content pixel is back under origin
      this.container.scrollLeft = contentX * actualFactor - origin.x;
      this.container.scrollTop = contentY * actualFactor - origin.y;
    } else {
      this._applyZoom();
    }
  }

  /**
   * Set the zoom level to fit the full spread in the container.
   */
  zoomToFit() {
    this._zoom = 1.0;
    this._applyZoom();
  }

  /**
   * Apply current zoom level by scaling the SVG element size.
   * The viewBox always shows the full pasteboard (1:1 SVG units).
   * The width/height attributes grow/shrink with zoom so the browser
   * renders the same content at a larger/smaller CSS pixel size —
   * the container scrolls naturally via overflow:auto.
   */
  _applyZoom() {
    const svg = this._svg;
    const spread = this.currentSpread;
    if (!svg || !spread) return;

    const pb = spread.pasteboardRect;
    svg.setAttribute('width', String(pb.width * this._zoom));
    svg.setAttribute('height', String(pb.height * this._zoom));
    svg.setAttribute(
      'viewBox',
      `${pb.x} ${pb.y} ${pb.width} ${pb.height}`,
    );

    this._updateOverlay();

    const pct = Math.round(this._zoom * 100);
    this.setStatus(`${pct}%`, 'ok');
  }

  // ---------------------------------------------------------------------------
  // Overlay — non-zoomed SVG layer for handles, ports, page decoration
  // ---------------------------------------------------------------------------

  /**
   * Project a content-SVG coordinate to overlay-SVG coordinate.
   * The overlay is position:sticky so it stays at the container's
   * visible viewport corner. Coordinates are relative to the viewport.
   */
  _projectPoint(x, y) {
    const svg = this._svg;
    if (!svg) return { x: 0, y: 0 };

    const ctm = svg.getScreenCTM();
    if (!ctm) return { x: 0, y: 0 };

    const pt = new DOMPoint(x, y).matrixTransform(ctm);
    const cr = this.container.getBoundingClientRect();
    return {
      x: pt.x - cr.left,
      y: pt.y - cr.top,
    };
  }

  /**
   * Project a content-SVG distance (width/height) to overlay pixels.
   */
  _projectSize(size) {
    const svg = this._svg;
    if (!svg) return size;
    const ctm = svg.getScreenCTM();
    if (!ctm) return size;
    return size * ctm.a;
  }

  /**
   * Redraw the overlay SVG with current box/decoration state.
   * Called on zoom, scroll, resize, and after full update().
   */
  _updateOverlay() {
    const overlay = this._overlaySvg;
    const spread = this.currentSpread;
    if (!overlay || !spread) return;

    // Size the overlay to match the container's visible viewport,
    // positioned at the current scroll offset so it tracks the viewport.
    const vw = this.container.clientWidth;
    const vh = this.container.clientHeight;
    overlay.setAttribute('width', String(vw));
    overlay.setAttribute('height', String(vh));
    overlay.setAttribute('viewBox', `0 0 ${vw} ${vh}`);
    overlay.style.top = `${this.container.scrollTop}px`;
    overlay.style.left = `${this.container.scrollLeft}px`;

    // Clear previous content
    overlay.innerHTML = '';

    const project = (x, y) => this._projectPoint(x, y);
    const projectSize = (s) => this._projectSize(s);

    // 1. Spread decoration (pasteboard, pages, spine, margin guides)
    this._decorateSpreadOverlay(overlay, spread, project, projectSize);

    // 2. Box overlay (frames, handles, ports, link highlights)
    drawBoxOverlay(overlay, {
      boxes: [...this.boxes, ...this.imageBoxes],
      selectedBoxId: this.selectedBoxId,
      stories: this._stories.map(s => ({
        boxIds: s.boxIds,
        overflow: s.overflow || false,
      })),
      linkMode: this._linkSource,
      project,
      projectSize,
    });
  }

  /**
   * Draw margin guides into the overlay SVG using projected coordinates.
   * Only UI chrome goes here — page backgrounds stay in the content SVG.
   */
  _decorateSpreadOverlay(overlay, spread, project, projectSize) {
    const mg = spread.margin || 0;
    if (mg <= 0) return;

    for (const page of spread.pageRects) {
      const gTL = project(page.x + mg, page.y + mg);
      const gW = projectSize(page.width - mg * 2);
      const gH = projectSize(page.height - mg * 2);
      const guide = document.createElementNS(SVG_NS, 'rect');
      guide.setAttribute('x', String(gTL.x));
      guide.setAttribute('y', String(gTL.y));
      guide.setAttribute('width', String(gW));
      guide.setAttribute('height', String(gH));
      guide.setAttribute('fill', 'none');
      guide.setAttribute('stroke', '#b0d0f0');
      guide.setAttribute('stroke-width', '0.5');
      guide.classList.add('margin-guide');
      overlay.appendChild(guide);
    }
  }

  // ---------------------------------------------------------------------------
  // Save — serialize in-memory state to the document store
  // ---------------------------------------------------------------------------

  async _save() {
    if (!this._docPath || this._saving) return;

    this._saving = true;
    this.setStatus('Saving...', '');
    this.shell?.requestUpdate();

    try {
      // PUT spread + stories + timestamp in parallel
      const puts = [];

      // Spread
      puts.push(
        putJson(`/store/${this._docPath}/spreads/${this._activeSpreadId}.json`, this._serializeSpread())
      );

      // Stories (using shared serializer)
      for (const storyEntry of this._stories) {
        const json = serializeStory(storyEntry.id, storyEntry.editor);
        puts.push(
          putJson(`/store/${this._docPath}/stories/${storyEntry.id}.json`, json)
        );
      }

      // document.json timestamp
      puts.push(updateDocTimestamp(this._docPath));

      const results = await Promise.all(puts);
      // updateDocTimestamp returns void, so filter only Response objects
      const failed = results.filter(r => r && typeof r.ok === 'boolean' && !r.ok);
      if (failed.length > 0) {
        throw new Error(`${failed.length} file(s) failed to save`);
      }

      this.setStatus('Saved.', 'ok');
    } catch (err) {
      this.setStatus(`Save failed: ${err.message}`, 'error');
      console.error('Save failed:', err);
    } finally {
      this._saving = false;
      this.shell?.requestUpdate();
    }
  }

  /**
   * Serialize boxes and image boxes into a single spread JSON object
   * matching the store format.
   */
  _serializeSpread() {
    const frames = [];

    // Text frames: each box references its story via storyRef
    for (const box of this.boxes) {
      const story = this._findStoryForBox(box.id);
      const frame = {
        id: box.id,
        type: 'text',
        x: Math.round(box.x * 100) / 100,
        y: Math.round(box.y * 100) / 100,
        width: Math.round(box.width * 100) / 100,
        height: Math.round(box.height * 100) / 100,
      };
      if (story) frame.storyRef = story.id;
      frames.push(frame);
    }

    // Image frames — prefer assetRef (spec convention) over inline imageUrl
    for (const box of this.imageBoxes) {
      const frame = {
        id: box.id,
        type: 'image',
        x: Math.round(box.x * 100) / 100,
        y: Math.round(box.y * 100) / 100,
        width: Math.round(box.width * 100) / 100,
        height: Math.round(box.height * 100) / 100,
      };
      if (box.assetRef) {
        frame.assetRef = box.assetRef;
      } else {
        frame.imageUrl = box.imageUrl;
      }
      frames.push(frame);
    }

    return {
      id: this._activeSpreadId,
      pages: this._activeSpreadPages || [
        { index: 0, label: '1' },
        { index: 1, label: '2' },
      ],
      frames,
    };
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

    this._initSelectionSync(shell);

    shell.addEventListener('paste-received', (e) => this.handlePaste(e.detail));

    shell.addEventListener('cut-executed', () => {
      if (this.mode !== 'text' || !this.editor.hasSelection()) return;
      this.submitAction('Cut', () => {
        this.editor.replaceSelectionWithText('');
      });
    });
  }

  _registerCreatables(shell) {
    shell.registerCreatable({
      id: 'spread.textFrame',
      label: 'Text Frame',
      icon: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <rect x="3" y="3" width="18" height="18" rx="2"></rect>
        <line x1="7" y1="8" x2="17" y2="8"></line>
        <line x1="7" y1="12" x2="17" y2="12"></line>
        <line x1="7" y1="16" x2="13" y2="16"></line>
      </svg>`,
      onCreate: () => this._createTextFrame()
    });

    shell.registerCreatable({
      id: 'spread.imageFrame',
      label: 'Image Frame',
      icon: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <rect x="3" y="3" width="18" height="18" rx="2"></rect>
        <circle cx="8.5" cy="8.5" r="1.5"></circle>
        <polyline points="21 15 16 10 5 21"></polyline>
      </svg>`,
      onCreate: () => this._createImageFrame()
    });
  }

  _createTextFrame() {
    if (!this.currentSpread) return;
    const page = this.currentSpread.pageRects[0];
    const boxId = `text-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`;
    const w = 200;
    const h = 150;
    const x = page.x + (page.width - w) / 2;
    const y = page.y + (page.height - h) / 2;

    const box = {
      id: boxId,
      x, y,
      width: w,
      height: h,
      minWidth: 80,
      minHeight: 60,
    };

    // Each new text frame gets its own independent story
    const emptyStory = [[{ text: '', style: { bold: false, italic: false } }]];
    const emptyStyles = [{ fontSize: this._fontSize }];
    const newStoryEntry = {
      id: `story-${this._storyCounter++}`,
      editor: new EditorState(emptyStory, emptyStyles),
      boxIds: [boxId],
      lineMap: [],
    };

    this.submitAction('Create Text Frame', () => {
      this.boxes = [...this.boxes, box];
      this._stories = [...this._stories, newStoryEntry];
      this.selectedBoxId = boxId;
      this._activeStory = newStoryEntry;
      // Select the new box in object mode; the user double-clicks to edit.
      this.setMode('object');
    });
  }

  _createImageFrame() {
    if (!this.currentSpread) return;
    const page = this.currentSpread.pageRects[0];
    const boxId = `image-${++this._imageBoxCounter}`;
    const w = 200;
    const h = 150;
    const x = page.x + (page.width - w) / 2;
    const y = page.y + (page.height - h) / 2;

    const imageBox = {
      id: boxId,
      x, y,
      width: w,
      height: h,
      minWidth: 20,
      minHeight: 20,
      imageUrl: this._emptyImagePlaceholder(),
    };

    this.submitAction('Create Image Frame', () => {
      this.imageBoxes = [...this.imageBoxes, imageBox];
      this.selectedBoxId = boxId;
      this.setMode('object');
    });
  }

  /** Generate a simple SVG data URL as a placeholder for empty image frames. */
  _emptyImagePlaceholder() {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="150" viewBox="0 0 200 150">
      <rect width="200" height="150" fill="#e0ddd5" stroke="#b0ab9f" stroke-width="1"/>
      <line x1="0" y1="0" x2="200" y2="150" stroke="#b0ab9f" stroke-width="0.5"/>
      <line x1="200" y1="0" x2="0" y2="150" stroke="#b0ab9f" stroke-width="0.5"/>
      <text x="100" y="80" text-anchor="middle" fill="#8a857a" font-size="14" font-family="sans-serif">Image</text>
    </svg>`;
    return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
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
        fn();
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
    if (!payload || !payload.items) return;

    // 1. Image paste
    const imageItem = payload.items.find(it => it && it.type === 'image');
    if (imageItem) {
      if (this.mode === 'text') {
        // Insert inline image placeholder in text flow
        const dataUrl = await this._blobToDataUrl(imageItem.data);
        this.submitAction('Paste Inline Image', () => {
          const run = { text: '\uFFFC', style: { bold: false, italic: false, inlineImage: dataUrl } };
          this.editor.insertStory([[run]]);
        });
      } else {
        // Object mode: place image box on the pasteboard (upload as asset if possible)
        await this._placeImageBox(imageItem.data, imageItem.data.name || 'pasted-image');
      }
      return;
    }

    if (this.mode !== 'text') return;

    // 2. Native Story Data (preferred)
    const storyItem = payload.items.find(it => it && it.type === 'story');
    if (storyItem && storyItem.story) {
      this.submitAction('Paste Story', () => {
        this.editor.insertStory(storyItem.story, storyItem.paragraphStyles);
      });
      return;
    }

    // 3. Rich text (HTML from external sources)
    const htmlItem = payload.items.find(it => it && it.type === 'text/html');
    if (htmlItem) {
      const story = parseHtmlToStory(htmlItem.data);
      if (story.length > 0) {
        this.submitAction('Paste Rich Text', () => {
          this.editor.insertStory(story);
        });
        return;
      }
    }

    // 4. Plain Text fallback
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

  /** Convert a Blob or File to a data URL string. */
  _blobToDataUrl(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(blob);
    });
  }

  /**
   * Load an image blob to get its natural dimensions.
   * @param {Blob} blob
   * @returns {Promise<{ width: number, height: number, dataUrl: string }>}
   */
  _loadImageBlob(blob) {
    if (blob.type === 'image/tiff' || blob.name?.endsWith('.tiff') || blob.name?.endsWith('.tif')) {
      return new Promise(async (resolve, reject) => {
        try {
          const buffer = await blob.arrayBuffer();
          const utifModule = await import('https://esm.sh/utif2@4.1.0');
          const UTIF = utifModule.default || utifModule;
          const ifds = UTIF.decode(buffer);
          if (ifds.length === 0 || !ifds[0].t256 || !ifds[0].t257) {
            throw new Error('Invalid TIFF dimensions');
          }
          const width = ifds[0].t256[0];
          const height = ifds[0].t257[0];
          resolve({ width, height, dataUrl: '' });
        } catch (err) {
          resolve({ width: 120, height: 90, dataUrl: '' });
        }
      });
    }

    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(reader.error);
      reader.onload = () => {
        const dataUrl = reader.result;
        const img = new Image();
        img.onload = () => resolve({ width: img.width, height: img.height, dataUrl });
        img.onerror = () => reject(new Error('Failed to decode image'));
        img.src = dataUrl;
      };
      reader.readAsDataURL(blob);
    });
  }

  /**
   * Prepare an image for placement: upload as an asset if the editor is
   * connected to a document store, otherwise keep as a data URL.
   *
   * @param {Blob} blob - Image data
   * @param {string} filename - Original filename (e.g. "photo.png")
   * @returns {Promise<{ imageUrl: string, assetRef?: string, assetExt?: string, width: number, height: number }>}
   */
  async _prepareImageAsset(blob, filename) {
    const { width, height, dataUrl } = await this._loadImageBlob(blob);
    const mime = blob.type || 'image/png';

    if (this._docPath) {
      try {
        const name = assetNameFromFilename(filename || 'image');
        const { assetRef, ext } = await uploadImageAsset(
          this._docPath, name, blob, { mime, width, height },
        );
        // Build the URL to the uploaded file for rendering
        const imageUrl = `/store/${this._docPath}/assets/${assetRef}/${assetRef}.${ext}`;
        this._assets = await loadAssets(this._docPath);
        this.shell?.updatePanels();
        return { imageUrl, assetRef, assetExt: ext, width, height };
      } catch (err) {
        console.warn('Asset upload failed, falling back to data URL:', err);
      }
    }

    return { imageUrl: dataUrl, width, height };
  }

  /** Place an image box on the pasteboard centered in the current view. */
  async _placeImageBox(blob, filename) {
    if (!this.currentSpread) return;
    const asset = await this._prepareImageAsset(blob, filename);

    const maxW = 300;
    const scale = Math.min(1, maxW / asset.width);
    const w = asset.width * scale;
    const h = asset.height * scale;

    const page = this.currentSpread.pageRects[0];
    const x = page.x + (page.width - w) / 2;
    const y = page.y + (page.height - h) / 2;

    const boxId = `image-${++this._imageBoxCounter}`;
    const imageBox = {
      id: boxId,
      x, y, width: w, height: h,
      minWidth: 20, minHeight: 20,
      imageUrl: asset.imageUrl,
      ...(asset.assetRef ? { assetRef: asset.assetRef, assetExt: asset.assetExt } : {}),
    };

    this.submitAction('Paste Image Box', () => {
      this.imageBoxes = [...this.imageBoxes, imageBox];
      this.selectedBoxId = boxId;
    });
  }

  /**
   * Place an image box at a specific content-space position.
   * Used by drag-and-drop to place images where the user drops them.
   */
  async _placeImageBoxAt(blob, filename, cx, cy) {
    if (!this.currentSpread) return;
    const asset = await this._prepareImageAsset(blob, filename);

    const maxW = 300;
    const scale = Math.min(1, maxW / asset.width);
    const w = asset.width * scale;
    const h = asset.height * scale;

    const x = cx - w / 2;
    const y = cy - h / 2;

    const boxId = `image-${++this._imageBoxCounter}`;
    const imageBox = {
      id: boxId,
      x, y, width: w, height: h,
      minWidth: 20, minHeight: 20,
      imageUrl: asset.imageUrl,
      ...(asset.assetRef ? { assetRef: asset.assetRef, assetExt: asset.assetExt } : {}),
    };

    this.submitAction('Drop Image', () => {
      this.imageBoxes = [...this.imageBoxes, imageBox];
      this.selectedBoxId = boxId;
    });
  }

  async _placeAssetBoxAt(assetRef, ext, cx, cy) {
    if (!this.currentSpread) return;

    const meta = this._assets?.[assetRef] || {};
    const width = meta.width || 300;
    const height = meta.height || 200;
    const preview = meta.preview || `${assetRef}.${ext}`;
    const imageUrl = `/store/${this._docPath}/assets/${assetRef}/${preview}`;

    const maxW = 300;
    const scale = Math.min(1, maxW / width);
    const w = width * scale;
    const h = height * scale;

    const x = cx - w / 2;
    const y = cy - h / 2;

    const boxId = `image-${++this._imageBoxCounter}`;
    const imageBox = {
      id: boxId,
      x, y, width: w, height: h,
      minWidth: 20, minHeight: 20,
      imageUrl,
      assetRef,
      assetExt: ext,
    };

    this.submitAction('Drop Asset', () => {
      this.imageBoxes = [...this.imageBoxes, imageBox];
      this.selectedBoxId = boxId;
    });
  }

  /** Set up HTML5 drag-and-drop for image files and document assets on the container. */
  _initDragDrop() {
    const container = this.container;
    let dragCounter = 0;  // Track nested dragenter/dragleave

    const isAcceptableDrag = (e) => {
      return e.dataTransfer?.types?.includes('Files') || e.dataTransfer?.types?.includes('application/x-scribus-asset');
    };

    container.addEventListener('dragover', (e) => {
      if (!isAcceptableDrag(e)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
    });

    container.addEventListener('dragenter', (e) => {
      if (!isAcceptableDrag(e)) return;
      e.preventDefault();
      dragCounter++;
      if (dragCounter === 1) {
        this._showDropHighlight();
      }
    });

    container.addEventListener('dragleave', (e) => {
      if (!isAcceptableDrag(e)) return;
      dragCounter--;
      if (dragCounter <= 0) {
        dragCounter = 0;
        this._hideDropHighlight();
      }
    });

    container.addEventListener('drop', async (e) => {
      e.preventDefault();
      dragCounter = 0;
      this._hideDropHighlight();

      // Convert drop point to content-space coordinates
      const svg = this._svg;
      if (!svg) return;
      const ctm = svg.getScreenCTM();
      if (!ctm) return;
      const contentPt = new DOMPoint(e.clientX, e.clientY)
        .matrixTransform(ctm.inverse());

      // 1. Check for custom document asset drag & drop
      if (e.dataTransfer?.types?.includes('application/x-scribus-asset')) {
        const dataStr = e.dataTransfer.getData('application/x-scribus-asset');
        if (dataStr) {
          try {
            const assetData = JSON.parse(dataStr);
            const assetRef = assetData.assetRef;
            const ext = assetData.ext || 'jpg';

            // Check if dropped on an existing image frame
            const hitImageBox = this.imageBoxes.find(b =>
              contentPt.x >= b.x && contentPt.x <= b.x + b.width &&
              contentPt.y >= b.y && contentPt.y <= b.y + b.height
            );

            if (hitImageBox) {
              const meta = this._assets?.[assetRef] || {};
              const preview = meta.preview || `${assetRef}.${ext}`;
              const imageUrl = `/store/${this._docPath}/assets/${assetRef}/${preview}`;
              this.submitAction('Replace Image in Frame', () => {
                hitImageBox.imageUrl = imageUrl;
                hitImageBox.assetRef = assetRef;
                hitImageBox.assetExt = ext;
              });
            } else {
              await this._placeAssetBoxAt(assetRef, ext, contentPt.x, contentPt.y);
            }
          } catch (err) {
            console.error('Error parsing asset drop data:', err);
          }
        }
        return;
      }

      // 2. Fallback to external files drag & drop
      const files = e.dataTransfer?.files;
      if (!files || files.length === 0) return;

      // Process each image file
      for (const file of files) {
        if (!file.type.startsWith('image/')) continue;
        if (this.mode === 'text') {
          // Insert inline image at cursor position
          const dataUrl = await this._blobToDataUrl(file);
          this.submitAction('Drop Inline Image', () => {
            const run = {
              text: '\uFFFC',
              style: { bold: false, italic: false, inlineImage: dataUrl },
            };
            this.editor.insertStory([[run]]);
          });
        } else {
          // Place image box at drop coordinates (upload as asset if possible)
          await this._placeImageBoxAt(file, file.name, contentPt.x, contentPt.y);
        }
      }
    });
  }

  /** Show a drop-zone highlight in the overlay SVG. */
  _showDropHighlight() {
    if (!this._overlaySvg || !this._svg) return;
    // Remove any existing highlight
    this._hideDropHighlight();

    const overlay = this._overlaySvg;
    const vw = parseFloat(overlay.getAttribute('width') || '0');
    const vh = parseFloat(overlay.getAttribute('height') || '0');
    if (!vw || !vh) return;

    const rect = document.createElementNS(SVG_NS, 'rect');
    rect.setAttribute('x', '0');
    rect.setAttribute('y', '0');
    rect.setAttribute('width', String(vw));
    rect.setAttribute('height', String(vh));
    rect.setAttribute('fill', 'rgba(47, 110, 164, 0.08)');
    rect.setAttribute('stroke', '#2f6ea4');
    rect.setAttribute('stroke-width', '2');
    rect.setAttribute('stroke-dasharray', '8 4');
    rect.setAttribute('rx', '4');
    rect.setAttribute('data-drop-highlight', 'true');
    rect.style.pointerEvents = 'none';
    overlay.appendChild(rect);
  }

  /** Remove the drop-zone highlight from the overlay SVG. */
  _hideDropHighlight() {
    if (!this._overlaySvg) return;
    const el = this._overlaySvg.querySelector('[data-drop-highlight]');
    if (el) el.remove();
  }

  /** Render all image boxes as SVG <image> elements inside the given SVG. */
  _renderImageBoxes(svg) {
    // Remove any previous image-box layer
    const prev = svg.querySelector('[data-layer="image-boxes"]');
    if (prev) prev.remove();

    if (this.imageBoxes.length === 0) return;

    const g = document.createElementNS(SVG_NS, 'g');
    g.setAttribute('data-layer', 'image-boxes');
    svg.appendChild(g);

    for (const box of this.imageBoxes) {
      const imgEl = document.createElementNS(SVG_NS, 'image');
      imgEl.setAttribute('href', box.imageUrl);
      imgEl.setAttribute('x', String(box.x));
      imgEl.setAttribute('y', String(box.y));
      imgEl.setAttribute('width', String(box.width));
      imgEl.setAttribute('height', String(box.height));
      imgEl.setAttribute('data-image-box', 'true');
      imgEl.setAttribute('pointer-events', 'none');
      g.appendChild(imgEl);
    }
  }

  setStatus(msg, type = '') {
    if (this.statusEl) {
      this.statusEl.setText(msg, type);
    }
  }

  bindEvents() {
    this.container.addEventListener('pointerdown', async (e) => {
      if (!this._svg) return;

      const target = e.target;
      const boxId = target?.dataset?.boxId;
      const handle = target?.dataset?.handle;

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
        this.selectedBoxId = boxId;
        await this.update();
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
  }
  /**
   * Draw spread decoration (pasteboard, pages, spine) into the content SVG.
   * These zoom with the content — they represent the physical page surfaces.
   */
  _decorateSpreadContent(svg, spread) {
    decorateSpreadForEditor(svg, spread);
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

        const paragraphLayoutStyles = buildParagraphLayoutStyles(
          this._fontSize, storyEntry.editor.paragraphStyles);

        if (!baseSvg) {
          // First story: render and attach to container
          const result = await this.engine.renderToContainer(
            this.container,
            storyEntry.editor.story,
            storyBoxes,
            this._fontSize,
            this._lineHeight,
            paragraphLayoutStyles,
          );
          baseSvg = result.svg;
          storyEntry.lineMap = result.lineMap;
          storyEntry.overflow = result.overflow || false;
        } else {
          // Additional stories: render off-screen, transplant content
          const result = await this.engine.renderStory(
            storyEntry.editor.story,
            storyBoxes,
            this._fontSize,
            this._lineHeight,
            paragraphLayoutStyles,
          );
          storyEntry.lineMap = result.lineMap;
          storyEntry.overflow = result.overflow || false;

          // Transplant all child elements from the secondary SVG into
          // the base SVG. Skip box background <rect>s (the overlay draws those).
          for (const child of Array.from(result.svg.childNodes)) {
            if (child.tagName === 'rect') continue;
            baseSvg.appendChild(child);
          }
        }
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
  }

  _initSelectionSync(shell) {
    shell.selection.addEventListener('selectionchange', (e) => {
      const primary = e.detail.primary;
      if (primary && primary.id && primary.id !== this.selectedBoxId) {
        // If it's a known box id in this app, select it
        const isBox = this.boxes.some(b => b.id === primary.id) || 
                      this.imageBoxes.some(b => b.id === primary.id);
        if (isBox) {
          this.selectedBoxId = primary.id;
          this.update({ full: false });
        }
      }
    });
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
      const paraIndex = Math.max(0, Math.min(this.editor.story.length - 1, this.editor.cursor.paraIndex));
      const paraStyle = this.editor.paragraphStyles[paraIndex] || {};
      sections.push(
        TextTools.createTypographySection(this.shell, {
          fontFamily: typingStyle.fontFamily || 'EB Garamond',
          bold: !!typingStyle.bold,
          italic: !!typingStyle.italic
        }),
        TextTools.createFormattingSection(this.shell, {
          fontSize: paraStyle.fontSize || this._fontSize || 20,
          lineHeight: this._lineHeight || 138
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

    this._activeSpreadId = spreadId;
    this.selectedBoxId = null;
    this.cursor = null;
    if (this._textInteraction) {
      this._textInteraction.destroy();
      this._textInteraction = null;
    }

    await this._loadFromStore();
    await this.update();
    this.setStatus('Ready - spread editor active.', 'ok');
    this.shell?.updatePanels();
  }

  getPanelContent(panelId, selected) {
    // Reset panel-body to its default styles (overridden by the assets panel to
    // enable internal scrolling; must be restored when switching to other panels).
    const panelBody = this.shell?.element?.panelBody;
    if (panelBody && panelId !== 'assets') {
      panelBody.style.overflow = '';
      panelBody.style.padding = '';
      panelBody.style.display = '';
      panelBody.style.flexDirection = '';
    }

    if (panelId === 'pages') {
      if (panelBody) {
        panelBody.style.overflow = 'hidden';
        panelBody.style.padding = '0';
        panelBody.style.display = 'flex';
        panelBody.style.flexDirection = 'column';
      }

      const container = document.createElement('div');
      container.className = 'pages-panel';

      const style = document.createElement('style');
      style.textContent = `
        .pages-panel {
          display: flex;
          flex-direction: column;
          gap: 16px;
          padding: 1rem;
          height: 100%;
          max-height: 100%;
          overflow: hidden;
          box-sizing: border-box;
        }
        .pages-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          border-bottom: 1px solid var(--border, #2e2e32);
          padding-bottom: 12px;
          margin-bottom: 8px;
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
        .pages-list {
          display: flex;
          flex-direction: column;
          gap: 10px;
          overflow-y: auto;
          flex: 1;
          min-height: 0;
          padding-right: 4px;
        }
        .pages-list::-webkit-scrollbar {
          width: 6px;
        }
        .pages-list::-webkit-scrollbar-thumb {
          background: var(--border, #2e2e32);
          border-radius: 3px;
        }
        .spread-card {
          display: flex;
          align-items: center;
          gap: 12px;
          background: rgba(255, 255, 255, 0.02);
          border: 1px solid var(--border, #2e2e32);
          border-radius: 8px;
          padding: 10px 12px;
          cursor: pointer;
          position: relative;
          transition: transform var(--transition-fast, 0.2s), border-color var(--transition-fast, 0.2s), box-shadow var(--transition-fast, 0.2s), background var(--transition-fast, 0.2s);
          user-select: none;
        }
        .spread-card:hover {
          transform: translateY(-2px);
          border-color: var(--accent, #bb86fc);
          box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
          background: rgba(255, 255, 255, 0.04);
        }
        .spread-card.active {
          border-color: var(--accent, #bb86fc);
          background: rgba(187, 134, 252, 0.08);
          box-shadow: 0 0 8px rgba(187, 134, 252, 0.2);
        }
        .spread-icon {
          color: var(--text-dim, #a1a1aa);
          display: flex;
          align-items: center;
          justify-content: center;
          flex-shrink: 0;
          transition: color var(--transition-fast, 0.2s);
        }
        .spread-card.active .spread-icon, .spread-card:hover .spread-icon {
          color: var(--accent, #bb86fc);
        }
        .spread-details {
          display: flex;
          flex-direction: column;
          justify-content: center;
          min-width: 0;
          flex: 1;
        }
        .spread-name {
          font-size: 0.8rem;
          font-weight: 500;
          color: var(--text-main, #e1e1e6);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          margin-bottom: 2px;
        }
        .spread-meta {
          font-size: 0.7rem;
          color: var(--text-dim, #a1a1aa);
        }
        .spread-card.active .spread-meta {
          color: rgba(161, 161, 170, 0.8);
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
      countBadge.textContent = `${this._spreadsList?.length || 0} Spreads`;
      header.appendChild(countBadge);

      container.appendChild(header);

      // List
      const list = document.createElement('div');
      list.className = 'pages-list';

      if (this._spreadsList) {
        this._spreadsList.forEach((spreadId) => {
          const card = document.createElement('div');
          card.className = 'spread-card' + (spreadId === this._activeSpreadId ? ' active' : '');
          card.dataset.spreadId = spreadId;

          // Get pages for display
          const metadata = this._spreadsMetadata?.[spreadId];
          const pages = metadata?.pages || [];
          const labels = pages.map(p => p.label).join(', ');
          const pageStr = pages.length > 1 ? `Pages: ${labels}` : `Page: ${labels || '?'}`;
          
          // Icon
          const iconContainer = document.createElement('div');
          iconContainer.className = 'spread-icon';
          if (pages.length > 1) {
            iconContainer.innerHTML = `
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                <rect x="3" y="5" width="8" height="14" rx="1" ry="1"></rect>
                <rect x="13" y="5" width="8" height="14" rx="1" ry="1"></rect>
                <line x1="12" y1="3" x2="12" y2="21" stroke-dasharray="2 2"></line>
              </svg>
            `;
          } else {
            iconContainer.innerHTML = `
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                <rect x="7" y="5" width="10" height="14" rx="1" ry="1"></rect>
              </svg>
            `;
          }
          card.appendChild(iconContainer);

          // Details
          const details = document.createElement('div');
          details.className = 'spread-details';

          const name = document.createElement('span');
          name.className = 'spread-name';
          name.textContent = spreadId.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
          details.appendChild(name);

          const meta = document.createElement('span');
          meta.className = 'spread-meta';
          meta.textContent = pageStr;
          details.appendChild(meta);

          card.appendChild(details);

          card.addEventListener('click', () => {
            if (spreadId !== this._activeSpreadId) {
              card.classList.add('active'); // immediate feedback
              this.setStatus(`Loading ${spreadId}...`);
              setTimeout(() => {
                this.selectSpread(spreadId);
              }, 10);
            }
          });

          list.appendChild(card);
        });
      }

      container.appendChild(list);
      return container;
    }

    if (panelId !== 'assets') return null;

    // .panel-body is in shadow DOM so CSS injection can't reach it.
    // Set overflow/padding directly so the flex height chain works and
    // .assets-grid (overflow-y: auto; flex: 1; min-height: 0) can scroll.
    if (panelBody) {
      panelBody.style.overflow = 'hidden';
      panelBody.style.padding = '0';
      panelBody.style.display = 'flex';
      panelBody.style.flexDirection = 'column';
    }

    const container = document.createElement('div');
    container.className = 'assets-panel';

    // Inject styles directly for shadow DOM encapsulation bypass
    const style = document.createElement('style');
    style.textContent = `
      .shell-panel-content {
        height: 100%;
        display: flex;
        flex-direction: column;
        overflow: hidden;
      }
      .shell-panel-content-wrapper {
        height: 100%;
        display: flex;
        flex-direction: column;
        overflow: hidden;
      }
      .assets-panel {
        display: flex;
        flex-direction: column;
        gap: 16px;
        padding: 1rem;
        height: 100%;
        max-height: 100%;
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
      .assets-grid::-webkit-scrollbar {
        width: 6px;
      }
      .assets-grid::-webkit-scrollbar-thumb {
        background: var(--border, #2e2e32);
        border-radius: 3px;
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
              if (res.ok) {
                this._assets = await loadAssets(this._docPath);
                this.setStatus('Asset deleted successfully.', 'ok');
                this.shell?.updatePanels();
              } else {
                throw new Error(`Delete failed: ${res.status}`);
              }
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
