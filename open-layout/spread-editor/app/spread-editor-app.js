import {
  LayoutEngine,
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
import { serializeStory, putJson, updateDocTimestamp } from '../../document-store/lib/document-store.js';
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
    this._ribbonSections = null; // Cache sections

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
    this._zoomMin = 0.25;
    this._zoomMax = 4.0;
    this._zoomStep = 1.1; // multiplicative step per wheel tick

    // Document store path (e.g. "alice/brochure-q2").
    // When set, the Save button writes back to /store/{docPath}/...
    this._docPath = null;
    this._saving = false;
  }

  /** Active editor — returns the EditorState of the currently active story. */
  get editor() {
    return this._activeStory?.editor ?? null;
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

      this.bindEvents();

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
    if (this.cursor && this.editor) {
      this.cursor.setVisible(mode === 'text' && !this.editor.hasSelection());
    }
    
    this.update({ full: false });
    this.shell?.requestUpdate();
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

  async _loadFromStore() {
    this.setStatus('Loading document from store...');

    // 1. Load the spread definition
    const spreadUrl = `/store/${this._docPath}/spreads/spread-1.json`;
    const spreadRes = await fetch(spreadUrl);
    if (!spreadRes.ok) {
      throw new Error(`Failed to load spread: ${spreadRes.status} ${spreadUrl}`);
    }
    const spreadJson = await spreadRes.json();

    // 2. Load paragraph style definitions (for resolving styleRef)
    let styleMap = {};
    try {
      const stylesUrl = `/store/${this._docPath}/styles/paragraph.aggregate.json`;
      const stylesRes = await fetch(stylesUrl);
      if (stylesRes.ok) {
        const styles = await stylesRes.json();
        for (const s of styles) styleMap[s.id] = s;
      }
    } catch { /* styles are optional */ }

    // 3. Parse frames into boxes and collect storyRefs to load
    const storyRefsToLoad = new Set();
    // Map from storyRef -> ordered list of box IDs in that story chain
    const storyBoxMap = new Map();

    for (const frame of spreadJson.frames || []) {
      if (frame.type === 'image') {
        this.imageBoxes.push({
          id: frame.id,
          x: frame.x,
          y: frame.y,
          width: frame.width,
          height: frame.height,
          minWidth: 20,
          minHeight: 20,
          imageUrl: frame.imageUrl || this._emptyImagePlaceholder(),
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
      const storyUrl = `/store/${this._docPath}/stories/${storyRef}.json`;
      const res = await fetch(storyUrl);
      if (!res.ok) {
        console.warn(`Failed to load story ${storyRef}: ${res.status}`);
        return null;
      }
      const storyJson = await res.json();

      // Convert store format -> editor format
      const story = [];
      const paragraphStyles = [];
      for (const para of storyJson.paragraphs || []) {
        const runs = (para.runs || []).map(run => ({
          text: run.text,
          style: cloneStyle(run.style),
        }));
        story.push(runs);

        const def = styleMap[para.styleRef] || {};
        paragraphStyles.push(cloneParagraphStyle({
          styleRef: para.styleRef || 'body',
          fontSize: def.fontSize ?? this._fontSize,
          fontFamily: def.fontFamily ?? 'EB Garamond',
        }));
      }

      // Ensure at least one paragraph
      if (story.length === 0) {
        story.push([{ text: '', style: cloneStyle() }]);
        paragraphStyles.push(cloneParagraphStyle({ fontSize: this._fontSize }));
      }

      return {
        storyRef,
        id: storyJson.id || storyRef,
        story,
        paragraphStyles,
        boxIds: storyBoxMap.get(storyRef) || [],
      };
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
    const shellEl = this.root.querySelector('scribus-app-shell');
    if (shellEl) shellEl.setAttribute('data-mode', 'link');
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

    // Ctrl+scroll wheel zoom
    this.container.addEventListener('wheel', (e) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      e.preventDefault();
      const factor = e.deltaY < 0 ? this._zoomStep : 1 / this._zoomStep;
      this.zoomBy(factor);
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
   */
  zoomBy(factor) {
    this._zoom = Math.max(this._zoomMin, Math.min(this._zoomMax, this._zoom * factor));
    this._applyZoom();
  }

  /**
   * Set the zoom level to fit the full spread in the container.
   */
  zoomToFit() {
    this._zoom = 1.0;
    this._applyZoom();
  }

  /**
   * Apply current zoom level to the SVG viewBox without a full re-layout.
   */
  _applyZoom() {
    const svg = this._svg;
    const spread = this.currentSpread;
    if (!svg || !spread) return;

    const pb = spread.pasteboardRect;
    const vbW = pb.width / this._zoom;
    const vbH = pb.height / this._zoom;
    // Center the zoomed view on the spread center
    const cx = pb.x + pb.width / 2;
    const cy = pb.y + pb.height / 2;
    const vbX = cx - vbW / 2;
    const vbY = cy - vbH / 2;

    svg.setAttribute('viewBox', `${vbX} ${vbY} ${vbW} ${vbH}`);

    // Update the status bar with zoom percentage
    const pct = Math.round(this._zoom * 100);
    this.setStatus(`${pct}%`, 'ok');
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
        putJson(`/store/${this._docPath}/spreads/spread-1.json`, this._serializeSpread())
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

    // Image frames
    for (const box of this.imageBoxes) {
      frames.push({
        id: box.id,
        type: 'image',
        x: Math.round(box.x * 100) / 100,
        y: Math.round(box.y * 100) / 100,
        width: Math.round(box.width * 100) / 100,
        height: Math.round(box.height * 100) / 100,
        imageUrl: box.imageUrl,
      });
    }

    return {
      id: 'spread-1',
      pages: [
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
      // Activate the new story and enter text mode with cursor ready
      this._activeStory = newStoryEntry;
      if (this._textInteraction) {
        this._textInteraction.setEditor(newStoryEntry.editor);
      }
      newStoryEntry.editor.moveCursor({ paraIndex: 0, charOffset: 0 });
      this.setMode('text');
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
      const dataUrl = await this._blobToDataUrl(imageItem.data);
      if (this.mode === 'text') {
        // Insert inline image placeholder in text flow
        this.submitAction('Paste Inline Image', () => {
          const run = { text: '\uFFFC', style: { bold: false, italic: false, inlineImage: dataUrl } };
          this.editor.insertStory([[run]]);
        });
      } else {
        // Object mode: place image box on the pasteboard
        this._placeImageBox(dataUrl);
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

  /** Place an image box on the pasteboard centered in the current view. */
  _placeImageBox(dataUrl) {
    if (!this.currentSpread) return;
    const img = new Image();
    img.onload = () => {
      // Size the box proportionally, capped at 300px wide
      const maxW = 300;
      const scale = Math.min(1, maxW / img.width);
      const w = img.width * scale;
      const h = img.height * scale;

      // Place near center of the first page
      const page = this.currentSpread.pageRects[0];
      const x = page.x + (page.width - w) / 2;
      const y = page.y + (page.height - h) / 2;

      const boxId = `image-${++this._imageBoxCounter}`;
      const imageBox = {
        id: boxId,
        x, y, width: w, height: h,
        minWidth: 20, minHeight: 20,
        imageUrl: dataUrl,
      };

      this.submitAction('Paste Image Box', () => {
        this.imageBoxes = [...this.imageBoxes, imageBox];
        this.selectedBoxId = boxId;
      });
    };
    img.src = dataUrl;
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
          if (isTextContent) return;

          // Check if click point is geometrically inside a text box
          const pt = this._interaction._toSvgPoint(e);
          if (pt) {
            const hitBox = this.boxes.find(b =>
              pt.x >= b.x && pt.x <= b.x + b.width &&
              pt.y >= b.y && pt.y <= b.y + b.height
            );
            if (hitBox) {
              // If the clicked box has no rendered lines (empty linked
              // frame), place the cursor at the end of its story instead
              // of letting TextInteractionController do a geometric
              // nearest-line lookup into a different frame.
              const storyEntry = this._findStoryForBox(hitBox.id);
              const storyLineMap = storyEntry?.lineMap || [];
              const boxHasLines = storyLineMap.some(line =>
                Math.abs(line.colX - hitBox.x) < 1 &&
                Math.abs(line.boxY - hitBox.y) < 1
              );
              if (!boxHasLines && storyEntry) {
                e.stopImmediatePropagation();
                this._activateStoryForBox(hitBox.id);
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
              return;
            }
          }
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
          // If the clicked box has no rendered lines, intercept the
          // click and place the cursor at the end of the story rather
          // than letting TextInteractionController map it to the
          // geometrically nearest line in another frame.
          const clickedBox = this.boxes.find(b => b.id === boxId);
          if (clickedBox) {
            const storyEntry = this._findStoryForBox(boxId);
            const storyLineMap = storyEntry?.lineMap || [];
            const boxHasLines = storyLineMap.some(line =>
              Math.abs(line.colX - clickedBox.x) < 1 &&
              Math.abs(line.boxY - clickedBox.y) < 1
            );
            if (!boxHasLines && storyEntry) {
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



  decorateSpread(svg, pageRects, spread) {
    const mg = spread.margin || 0;
    // Collect decoration elements so we can insert them in correct
    // z-order: pasteboard → spread shadow → pages → spine → margin guides.
    // All decorations go before existing SVG content (text, boxes, etc.).
    const firstContent = svg.firstChild;

    // 1. Pasteboard background (bottom-most)
    const bg = document.createElementNS(SVG_NS, 'rect');
    bg.setAttribute('x', String(spread.pasteboardRect.x));
    bg.setAttribute('y', String(spread.pasteboardRect.y));
    bg.setAttribute('width', String(spread.pasteboardRect.width));
    bg.setAttribute('height', String(spread.pasteboardRect.height));
    bg.setAttribute('fill', '#ccc8bc');
    svg.insertBefore(bg, firstContent);

    // 2. Spread shadow (sits behind pages, visible as a border effect)
    const spreadShadow = document.createElementNS(SVG_NS, 'rect');
    spreadShadow.setAttribute('x', String(spread.spreadRect.x));
    spreadShadow.setAttribute('y', String(spread.spreadRect.y));
    spreadShadow.setAttribute('width', String(spread.spreadRect.width));
    spreadShadow.setAttribute('height', String(spread.spreadRect.height));
    spreadShadow.setAttribute('fill', '#e9e3d6');
    spreadShadow.setAttribute('stroke', '#b9b09f');
    spreadShadow.setAttribute('stroke-width', '1.2');
    svg.insertBefore(spreadShadow, firstContent);

    // 3. Pages (white, on top of spread shadow)
    for (const page of pageRects) {
      const r = document.createElementNS(SVG_NS, 'rect');
      r.setAttribute('x', String(page.x));
      r.setAttribute('y', String(page.y));
      r.setAttribute('width', String(page.width));
      r.setAttribute('height', String(page.height));
      r.setAttribute('fill', '#ffffff');
      r.setAttribute('stroke', '#c7c1b5');
      r.setAttribute('stroke-width', '1.2');
      svg.insertBefore(r, firstContent);
    }

    // 4. Spine (center divider between pages)
    const spine = document.createElementNS(SVG_NS, 'line');
    const spineX = spread.spreadRect.x + spread.spreadRect.width / 2;
    spine.setAttribute('x1', String(spineX));
    spine.setAttribute('y1', String(spread.spreadRect.y));
    spine.setAttribute('x2', String(spineX));
    spine.setAttribute('y2', String(spread.spreadRect.y + spread.spreadRect.height));
    spine.setAttribute('stroke', '#aba18d');
    spine.setAttribute('stroke-width', '1');
    spine.setAttribute('stroke-dasharray', '4 4');
    svg.insertBefore(spine, firstContent);

    // 5. Margin guides (type area rectangles, on top of everything)
    if (mg > 0) {
      for (const page of pageRects) {
        const guide = document.createElementNS(SVG_NS, 'rect');
        guide.setAttribute('x', String(page.x + mg));
        guide.setAttribute('y', String(page.y + mg));
        guide.setAttribute('width', String(page.width - mg * 2));
        guide.setAttribute('height', String(page.height - mg * 2));
        guide.setAttribute('fill', 'none');
        guide.setAttribute('stroke', '#b0d0f0');
        guide.setAttribute('stroke-width', '0.5');
        guide.classList.add('margin-guide');
        svg.appendChild(guide);
      }
    }
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
      // Render each story into its own set of boxes, then merge SVGs.
      // The first story renders via renderToContainer (creates the base SVG).
      // Additional stories render via renderStory and their text content
      // is transplanted into the base SVG.
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
          // First story: use renderToContainer to set up the base SVG
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
          // the base SVG. Skip box background <rect>s (the base SVG
          // and the overlay system draw those).
          for (const child of Array.from(result.svg.childNodes)) {
            if (child.tagName === 'rect') continue; // skip box backgrounds
            baseSvg.appendChild(child);
          }
        }
      }

      svg = baseSvg || this._svg;
      this._svg = svg;
    }

    if (!svg) return;

    // Determine the active story's lineMap for cursor operations
    const activeLineMap = this._activeStory?.lineMap || [];

    this.decorateSpread(svg, spread.pageRects, spread);

    // Render image boxes into the SVG (they are not part of text layout)
    this._renderImageBoxes(svg);

    drawBoxOverlay(svg, {
      boxes: [...this.boxes, ...this.imageBoxes],
      selectedBoxId: this.selectedBoxId,
      stories: this._stories.map(s => ({
        boxIds: s.boxIds,
        overflow: s.overflow || false,
      })),
      linkMode: this._linkSource,
    });
    const pb = spread.pasteboardRect;
    svg.setAttribute('width', String(pb.width));
    svg.setAttribute('height', String(pb.height));
    // Apply zoom: a smaller viewBox = zoomed in, larger = zoomed out
    const vbW = pb.width / this._zoom;
    const vbH = pb.height / this._zoom;
    const cx = pb.x + pb.width / 2;
    const cy = pb.y + pb.height / 2;
    svg.setAttribute(
      'viewBox',
      `${cx - vbW / 2} ${cy - vbH / 2} ${vbW} ${vbH}`,
    );

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

    // Update style buttons
    if (this.editor) {
      const typingStyle = this.editor.getTypingStyle();
      const boldBtn = this.root.querySelector('#toggle-bold');
      const italicBtn = this.root.querySelector('#toggle-italic');
      boldBtn?.toggleAttribute('active', !!typingStyle.bold);
      italicBtn?.toggleAttribute('active', !!typingStyle.italic);
    }
  }

  getRibbonSections(selected) {
    const sections = [];

    // Document section — always visible (Save button)
    if (this._docPath) {
      sections.push(AppShell.createRibbonSection('Document', (container) => {
        container.appendChild(this.shell.ui.createButton({
          commandId: 'doc.save',
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
          fontFamily: typingStyle.fontFamily || 'EB Garamond'
        }),
        TextTools.createFormattingSection(this.shell, {
          fontSize: paraStyle.fontSize || this._fontSize || 20,
          lineHeight: this._lineHeight || 138
        })
      );
    }

    return sections;
  }
}
