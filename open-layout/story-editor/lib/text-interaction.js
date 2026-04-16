import { ClickTracker } from './click-tracker.js';

/**
 * TextInteractionController - Handles Mouse, Keyboard, and Input events for the Story Editor.
 * Consolidates selection, navigation, and typing logic into a reusable class.
 */
export class TextInteractionController {
  constructor(options) {
    this.container = options.container;
    this.editor = options.editor;
    this.cursor = options.cursor;
    this.submitAction = options.submitAction; // fn(label, mutationFn, opType)
    this.update = options.update; // fn() to refresh view
    this.enabled = options.enabled || (() => true); // optional check
    
    this._selecting = false;
    this._dragMoved = false;
    this._dragAnchor = null;
    this._dragMode = 'char';
    this._keydownHandled = false;
    this._clickTracker = new ClickTracker();
    this._pendingSingleClickTimer = null;

    this._bindEvents();
  }

  _bindEvents() {
    this._onPointerDown = this._handlePointerDown.bind(this);
    this._onPointerMove = this._handlePointerMove.bind(this);
    this._onPointerUp = this._handlePointerUp.bind(this);
    this._onKeyDown = this._handleKeyDown.bind(this);
    this._onBeforeInput = this._handleBeforeInput.bind(this);
    
    // Pointer Events for better touch/pen support
    this.container.addEventListener('pointerdown', this._onPointerDown);
    document.addEventListener('pointermove', this._onPointerMove);
    document.addEventListener('pointerup', this._onPointerUp);
    
    this.container.addEventListener('keydown', this._onKeyDown);
    this.container.addEventListener('beforeinput', this._onBeforeInput);

    // Initial focus support
    this.container.setAttribute('tabindex', '0');
    this.container.style.outline = 'none';
  }

  destroy() {
    if (this._pendingSingleClickTimer != null) {
      clearTimeout(this._pendingSingleClickTimer);
      this._pendingSingleClickTimer = null;
    }
    this.container.removeEventListener('pointerdown', this._onPointerDown);
    document.removeEventListener('pointermove', this._onPointerMove);
    document.removeEventListener('pointerup', this._onPointerUp);
    this.container.removeEventListener('keydown', this._onKeyDown);
    this.container.removeEventListener('beforeinput', this._onBeforeInput);
  }

  setCursor(cursor) {
    this.cursor = cursor;
  }

  setEditor(editor) {
    this.editor = editor;
  }

  async _handlePointerDown(e) {
    if (!this.enabled() || !this.cursor || e.button !== 0) return;
    
    // Don't preventDefault if we want the browser to focus naturally,
    // but we use manual container.focus() to be safe.
    this.container.focus();

    // Cancel any pending single-click update — a new click arrived
    if (this._pendingSingleClickTimer != null) {
      clearTimeout(this._pendingSingleClickTimer);
      this._pendingSingleClickTimer = null;
    }

    this.cursor.handleClick(e);
    const pos = this.cursor.getPosition();
    if (!pos) return;

    this._clickTracker.registerClick(Date.now());
    const { mode, action } = this._clickTracker.resolveAction(e);

    if (action === 'extend') {
      this.editor.moveCursor(pos, true);
    } else if (action === 'paragraph') {
      this.editor.selectParagraphAt(pos);
      this._dragAnchor = { paraIndex: pos.paraIndex, charOffset: 0 };
    } else if (action === 'word') {
      this.editor.selectWordAt(pos);
      const base = this.editor.selection?.anchor || { paraIndex: pos.paraIndex, charOffset: pos.charOffset };
      this._dragAnchor = { paraIndex: base.paraIndex, charOffset: base.charOffset };
    } else {
      // Single click: place cursor and clear selection immediately so the
      // user gets instant visual feedback (caret appears, selection rects
      // disappear). Defer the full re-layout update — if a rapid second
      // click arrives (double-click), we cancel the deferred update and go
      // straight to word selection without an intermediate render flash.
      this.editor.moveCursor(pos, false);
      this._dragAnchor = { paraIndex: pos.paraIndex, charOffset: pos.charOffset };
      this._dragMode = mode;
      this._selecting = true;
      this._dragMoved = false;

      // Lightweight visual update: clear selection highlights and show caret
      this.cursor.updateSelection(null);
      this.cursor.moveTo(this.editor.cursor);
      this.cursor.setVisible(true);

      this._pendingSingleClickTimer = setTimeout(async () => {
        this._pendingSingleClickTimer = null;
        await this.update();
      }, this._clickTracker.threshold);
      return;
    }
    this._dragMode = mode;

    this._selecting = true;
    this._dragMoved = false;
    await this.update();
  }

  async _handlePointerMove(e) {
    if (!this.enabled() || !this._selecting || !this.cursor || !this._dragAnchor) return;

    // If a deferred single-click update is pending and the user starts
    // dragging, flush it immediately so the selection renders.
    if (this._pendingSingleClickTimer != null) {
      clearTimeout(this._pendingSingleClickTimer);
      this._pendingSingleClickTimer = null;
      await this.update();
    }

    this.cursor.handleClick(e);
    const pos = this.cursor.getPosition();
    if (!pos) return;

    if (this._dragMode === 'paragraph') {
      const endLen = this.editor.story[pos.paraIndex].reduce((sum, run) => sum + run.text.length, 0);
      const focus = pos.paraIndex >= this._dragAnchor.paraIndex
        ? { paraIndex: pos.paraIndex, charOffset: endLen }
        : { paraIndex: pos.paraIndex, charOffset: 0 };
      this.editor.moveCursor({ paraIndex: focus.paraIndex, charOffset: focus.charOffset, lineIndex: pos.lineIndex }, false);
      this.editor.setSelection(this._dragAnchor, focus);
    } else if (this._dragMode === 'word') {
      this.editor.selectWordAt(pos);
      const sel = this.editor.selection;
      if (sel) {
        const focus = pos.charOffset < this._dragAnchor.charOffset ? sel.anchor : sel.focus;
        this.editor.moveCursor({ paraIndex: focus.paraIndex, charOffset: focus.charOffset, lineIndex: pos.lineIndex }, false);
        this.editor.setSelection(this._dragAnchor, focus);
      }
    } else {
      this.editor.moveCursor(pos, false);
      this.editor.setSelection(this._dragAnchor, { paraIndex: pos.paraIndex, charOffset: pos.charOffset });
    }
    this._dragMoved = true;
    await this.update();
  }

  _handlePointerUp() {
    this._selecting = false;
    this._dragAnchor = null;
    // If a deferred single-click update is still pending (no drag, no
    // double-click), flush it now on pointer-up so the caret renders.
    if (this._pendingSingleClickTimer != null) {
      clearTimeout(this._pendingSingleClickTimer);
      this._pendingSingleClickTimer = null;
      this.update();
    }
  }

  async _handleKeyDown(e) {
    if (!this.enabled() || !this.cursor) return;
    const mod = e.metaKey || e.ctrlKey;
    const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;

    // 1. Navigation & Selection Shortcuts
    if (mod && (e.key === 'a' || e.key === 'A')) {
      e.preventDefault();
      this.editor.selectAll();
      await this.update();
      return;
    }

    if (mod && (e.key === 'b' || e.key === 'B')) {
      e.preventDefault();
      const style = this.editor.getTypingStyle();
      this.submitAction('Bold', () => this.editor.applyCharacterStyle({ bold: !style.bold }), 'formatBold');
      return;
    }

    if (mod && (e.key === 'i' || e.key === 'I')) {
       e.preventDefault();
       const style = this.editor.getTypingStyle();
       this.submitAction('Italic', () => this.editor.applyCharacterStyle({ italic: !style.italic }), 'formatItalic');
       return;
    }

    // 2. Cursor movement (Arrows)
    if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) {
      const wordMod = isMac ? e.altKey : e.ctrlKey;
      if (wordMod && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
        e.preventDefault();
        this.editor.moveCursorByWord(e.key === 'ArrowLeft' ? 'left' : 'right', e.shiftKey);
        if (this.cursor) this.cursor.moveTo(this.editor.cursor);
        await this.update();
        return;
      }

      this.cursor.handleKeydown(e);
      const pos = this.cursor.getPosition();
      if (pos) this.editor.moveCursor(pos, e.shiftKey);
      await this.update();
      return;
    }

    // 3. Home/End keys
    if (e.key === 'Home' || e.key === 'End') {
      e.preventDefault();
      const lineMap = this.cursor.getLineMap() || [];
      const line = lineMap[this.editor.cursor.lineIndex] || lineMap.find((l) => l.paraIndex === this.editor.cursor.paraIndex);
      if (line && line.positions && line.positions.length > 0) {
        const side = e.key === 'Home' ? 'start' : 'end';
        const charOffset = side === 'start' ? line.positions[0].charOffset : line.positions[line.positions.length - 1].charOffset;
        this.editor.moveCursor({ paraIndex: line.paraIndex, charOffset, lineIndex: line.lineIndex }, e.shiftKey);
        this.cursor.moveTo(this.editor.cursor);
        await this.update();
      }
      return;
    }

    // 4. Editor Actions (Typing, Deleting)
    const isMod = (e.ctrlKey || e.metaKey);
    const wordDel = (e.altKey || (e.ctrlKey && !e.metaKey));
    
    // We handle single characters, Enter, and Delete/Backspace
    const isEditorKey = !e.isComposing && (
      e.key === 'Backspace' || e.key === 'Delete' || e.key === 'Enter' ||
      (wordDel && (e.key === 'Backspace' || e.key === 'Delete')) ||
      (!e.ctrlKey && !e.metaKey && !e.altKey && e.key.length === 1)
    );

    if (isEditorKey) {
      e.preventDefault();
      // Set flag to prevent double-handling in beforeinput
      this._keydownHandled = true;
      setTimeout(() => { this._keydownHandled = false; }, 0);

      const label = (e.key.length === 1 ? 'Type' : e.key);
      const opType = (e.key === 'Backspace' || e.key === 'Delete') ? 'deleteContent' : 'insertText';
      
      this.submitAction('Keyboard ' + label, () => {
        this.editor.handleKeydown(e);
      }, opType);
      
      if (this.cursor) this.cursor.moveTo(this.editor.cursor);
    }
  }

  async _handleBeforeInput(e) {
    if (!this.enabled() || !this.cursor) return;
    // Skip if already handled by keydown (prevents double-entry in most desktop browsers)
    if (this._keydownHandled) return;

    const label = e.inputType.replace(/([A-Z])/g, ' $1').trim();
    this.submitAction(label, () => {
      this.editor.handleBeforeInput(e);
    }, e.inputType);
    
    e.preventDefault();
  }
}
