// editor-state.js - single source of truth for story editing state

import {
  normalizeStory,
  clampPos,
  comparePositions,
  orderPositions,
  replaceRange,
  textInRange,
  insertText,
  deleteBackward,
  deleteForward,
  insertParagraphBreak,
  applyStyleRange,
  getStyleAtPos,
  getStoryFragment,
  insertStoryFragment,
} from './story-ops.js';
import { cloneStyle } from './style.js';

/**
 * @typedef {import('./text-extract.js').Story} Story
 */

function toStoryPos(cursor) {
  return { paraIndex: cursor.paraIndex, charOffset: cursor.charOffset };
}

function paragraphText(paragraphRuns) {
  return paragraphRuns.map((run) => run.text).join('');
}

function isWordChar(ch) {
  return /[\p{L}\p{N}_]/u.test(ch);
}

function findWordRange(text, offset) {
  const len = text.length;
  if (len === 0) return { start: 0, end: 0 };

  let idx = Math.max(0, Math.min(len, offset));
  if (idx === len) idx = len - 1;

  const ch = text[idx];
  if (!isWordChar(ch) && idx > 0 && isWordChar(text[idx - 1])) {
    idx -= 1;
  }

  const wordMode = isWordChar(text[idx]);
  let start = idx;
  let end = idx + 1;

  while (start > 0) {
    const ok = wordMode ? isWordChar(text[start - 1]) : !isWordChar(text[start - 1]) && text[start - 1] !== ' ';
    if (!ok) break;
    start -= 1;
  }

  while (end < len) {
    const ok = wordMode ? isWordChar(text[end]) : !isWordChar(text[end]) && text[end] !== ' ';
    if (!ok) break;
    end += 1;
  }

  return { start, end };
}

function leftWordBoundary(text, offset) {
  let i = Math.max(0, Math.min(text.length, offset));
  while (i > 0 && text[i - 1] === ' ') i -= 1;
  if (i > 0 && isWordChar(text[i - 1])) {
    while (i > 0 && isWordChar(text[i - 1])) i -= 1;
  } else {
    while (i > 0 && text[i - 1] !== ' ' && !isWordChar(text[i - 1])) i -= 1;
  }
  return i;
}

function rightWordBoundary(text, offset) {
  let i = Math.max(0, Math.min(text.length, offset));
  while (i < text.length && text[i] === ' ') i += 1;
  if (i < text.length && isWordChar(text[i])) {
    while (i < text.length && isWordChar(text[i])) i += 1;
  } else {
    while (i < text.length && text[i] !== ' ' && !isWordChar(text[i])) i += 1;
  }
  return i;
}

export class EditorState {
  /**
   * @param {Story} story
   * @param {import('./paragraph-style.js').ParagraphStyle[]} paragraphStyles
   */
  constructor(story, paragraphStyles = []) {
    this._story = normalizeStory(story);
    this._paragraphStyles = [...paragraphStyles];
    this._cursor = { paraIndex: 0, charOffset: 0, lineIndex: 0 };
    this._selection = null;
    this._typingStyle = null;
  }

  /** @returns {import('./paragraph-style.js').ParagraphStyle[]} */
  get paragraphStyles() {
    return this._paragraphStyles;
  }

  /** @returns {Story} */
  get story() {
    return this._story;
  }

  /** @returns {{ paraIndex: number, charOffset: number, lineIndex: number }} */
  get cursor() {
    return { ...this._cursor };
  }

  /** @returns {{ anchor: { paraIndex: number, charOffset: number }, focus: { paraIndex: number, charOffset: number } }|null} */
  get selection() {
    if (!this._selection) return null;
    return {
      anchor: { ...this._selection.anchor },
      focus: { ...this._selection.focus },
    };
  }

  /** @returns {boolean} */
  hasSelection() {
    if (!this._selection) return false;
    return comparePositions(this._selection.anchor, this._selection.focus) !== 0;
  }

  /**
   * @returns {{ start: { paraIndex: number, charOffset: number }, end: { paraIndex: number, charOffset: number } }|null}
   */
  getSelectionRange() {
    if (!this.hasSelection()) return null;
    return orderPositions(this._selection.anchor, this._selection.focus);
  }

  /**
   * @param {{ paraIndex: number, charOffset: number, lineIndex?: number }} cursor
   */
  setCursor(cursor) {
    const clamped = clampPos(this._story, cursor);
    this._cursor = {
      paraIndex: clamped.paraIndex,
      charOffset: clamped.charOffset,
      lineIndex: Number.isInteger(cursor?.lineIndex) ? cursor.lineIndex : this._cursor.lineIndex,
    };
    this._selection = null;
  }

  /**
   * Returns a deep-cloned snapshot of the current state.
   */
  getState() {
    return {
      story: JSON.parse(JSON.stringify(this._story)),
      paragraphStyles: JSON.parse(JSON.stringify(this._paragraphStyles)),
      cursor: { ...this._cursor },
      selection: this._selection ? {
        anchor: { ...this._selection.anchor },
        focus: { ...this._selection.focus }
      } : null,
      typingStyle: this._typingStyle ? { ...this._typingStyle } : null
    };
  }

  /**
   * Restores state from a snapshot.
   */
  setState(state) {
    this._story = state.story;
    this._paragraphStyles.length = 0;
    this._paragraphStyles.push(...state.paragraphStyles);
    this._cursor = { ...state.cursor };
    this._selection = state.selection ? {
      anchor: { ...state.selection.anchor },
      focus: { ...state.selection.focus }
    } : null;
    this._typingStyle = state.typingStyle ? { ...state.typingStyle } : null;
  }

  /**
   * @param {{ paraIndex: number, charOffset: number }} anchor
   * @param {{ paraIndex: number, charOffset: number }} focus
   */
  setSelection(anchor, focus) {
    this._selection = {
      anchor: clampPos(this._story, anchor),
      focus: clampPos(this._story, focus),
    };
  }

  clearSelection() {
    this._selection = null;
  }

  /**
   * Move cursor and optionally extend selection.
   * @param {{ paraIndex: number, charOffset: number, lineIndex?: number }} nextCursor
   * @param {boolean} extend
   */
  moveCursor(nextCursor, extend = false) {
    const clamped = clampPos(this._story, nextCursor);
    const prevPos = { paraIndex: this._cursor.paraIndex, charOffset: this._cursor.charOffset };
    this._cursor = {
      paraIndex: clamped.paraIndex,
      charOffset: clamped.charOffset,
      lineIndex: Number.isInteger(nextCursor?.lineIndex) ? nextCursor.lineIndex : this._cursor.lineIndex,
    };

    if (!extend) {
      this._selection = null;
      return;
    }

    if (this._selection) {
      this._selection = {
        anchor: this._selection.anchor,
        focus: { paraIndex: clamped.paraIndex, charOffset: clamped.charOffset },
      };
    } else {
      this._selection = {
        anchor: prevPos,
        focus: { paraIndex: clamped.paraIndex, charOffset: clamped.charOffset },
      };
    }
  }

  /**
   * Move cursor by word boundary.
   * @param {'left'|'right'} direction
   * @param {boolean} extend
   */
  moveCursorByWord(direction, extend = false) {
    const p = this._cursor.paraIndex;
    const text = paragraphText(this._story[p]);
    let i = this._cursor.charOffset;

    if (direction === 'left') {
      if (i === 0 && p > 0) {
        const prevLen = paragraphText(this._story[p - 1]).length;
        this.moveCursor({ paraIndex: p - 1, charOffset: prevLen, lineIndex: this._cursor.lineIndex }, extend);
        return;
      }
      i = leftWordBoundary(text, i);
    } else {
      if (i >= text.length && p < this._story.length - 1) {
        this.moveCursor({ paraIndex: p + 1, charOffset: 0, lineIndex: this._cursor.lineIndex }, extend);
        return;
      }
      i = rightWordBoundary(text, i);
    }

    this.moveCursor({ paraIndex: p, charOffset: i, lineIndex: this._cursor.lineIndex }, extend);
  }

  /**
   * @param {{ paraIndex: number, charOffset: number, lineIndex?: number }} pos
   */
  selectWordAt(pos) {
    const clamped = clampPos(this._story, pos);
    const text = paragraphText(this._story[clamped.paraIndex]);
    const range = findWordRange(text, clamped.charOffset);
    this._cursor = {
      paraIndex: clamped.paraIndex,
      charOffset: range.end,
      lineIndex: Number.isInteger(pos?.lineIndex) ? pos.lineIndex : this._cursor.lineIndex,
    };
    this._selection = {
      anchor: { paraIndex: clamped.paraIndex, charOffset: range.start },
      focus: { paraIndex: clamped.paraIndex, charOffset: range.end },
    };
  }

  /**
   * @param {{ paraIndex: number, lineIndex?: number }} pos
   */
  selectParagraphAt(pos) {
    const paraIndex = Math.max(0, Math.min(this._story.length - 1, pos?.paraIndex ?? 0));
    const len = paragraphText(this._story[paraIndex]).length;
    this._cursor = {
      paraIndex,
      charOffset: len,
      lineIndex: Number.isInteger(pos?.lineIndex) ? pos.lineIndex : this._cursor.lineIndex,
    };
    this._selection = {
      anchor: { paraIndex, charOffset: 0 },
      focus: { paraIndex, charOffset: len },
    };
  }

  selectAll() {
    const lastPara = this._story.length - 1;
    const lastLen = paragraphText(this._story[lastPara]).length;
    this._cursor = { paraIndex: lastPara, charOffset: lastLen, lineIndex: this._cursor.lineIndex };
    this._selection = {
      anchor: { paraIndex: 0, charOffset: 0 },
      focus: { paraIndex: lastPara, charOffset: lastLen },
    };
  }

  deleteWordBackward() {
    if (this.hasSelection()) {
      return this.replaceSelectionWithText('');
    }
    const p = this._cursor.paraIndex;
    const text = paragraphText(this._story[p]);
    const cur = this._cursor.charOffset;

    if (cur === 0) {
      if (p === 0) return false;
      return this.applyOperation('deleteBackward');
    }

    const start = leftWordBoundary(text, cur);
    let end = cur;
    if (end < text.length && text[end] === ' ' && end > 0 && isWordChar(text[end - 1])) {
      end += 1;
    }
    const result = replaceRange(
      this._story,
      { paraIndex: p, charOffset: start },
      { paraIndex: p, charOffset: end },
      '',
      { typingStyle: this._typingStyle },
    );
    this._story = result.story;
    this._cursor = {
      paraIndex: result.cursor.paraIndex,
      charOffset: result.cursor.charOffset,
      lineIndex: this._cursor.lineIndex,
    };
    this._selection = null;
    return true;
  }

  deleteWordForward() {
    if (this.hasSelection()) {
      return this.replaceSelectionWithText('');
    }
    const p = this._cursor.paraIndex;
    const text = paragraphText(this._story[p]);
    const cur = this._cursor.charOffset;

    if (cur === text.length) {
      if (p === this._story.length - 1) return false;
      return this.applyOperation('deleteForward');
    }

    const end = rightWordBoundary(text, cur);
    const result = replaceRange(
      this._story,
      { paraIndex: p, charOffset: cur },
      { paraIndex: p, charOffset: end },
      '',
      { typingStyle: this._typingStyle },
    );
    this._story = result.story;
    this._cursor = {
      paraIndex: result.cursor.paraIndex,
      charOffset: result.cursor.charOffset,
      lineIndex: this._cursor.lineIndex,
    };
    this._selection = null;
    return true;
  }

  _replaceSelectionIfAny(textForInsert = null) {
    const range = this.getSelectionRange();
    if (!range) return false;

    const replacementText = typeof textForInsert === 'string' ? textForInsert : '';
    const result = replaceRange(
      this._story,
      range.start,
      range.end,
      replacementText,
      { typingStyle: this._typingStyle },
    );

    this._story = result.story;
    this._cursor = {
      paraIndex: result.cursor.paraIndex,
      charOffset: result.cursor.charOffset,
      lineIndex: this._cursor.lineIndex,
    };
    this._selection = null;
    return true;
  }

  /**
   * @param {string} op
   * @param {object} payload
   * @returns {boolean}
   */
  applyOperation(op, payload = {}) {
    if (op === 'insertText') {
      // Typing over a selection is a direct replace operation and can return early.
      if (this._replaceSelectionIfAny(payload.text ?? '')) return true;
    } else if (op === 'deleteBackward' || op === 'deleteForward' || op === 'insertParagraphBreak') {
      if (this._replaceSelectionIfAny('')) return true;
    }

    const beforeCount = this._story.length;
    const pos = toStoryPos(this._cursor);
    let result = null;

    if (op === 'insertText') {
      result = insertText(this._story, pos, payload.text ?? '', { typingStyle: this._typingStyle });
    } else if (op === 'deleteBackward') {
      result = deleteBackward(this._story, pos);
    } else if (op === 'deleteForward') {
      result = deleteForward(this._story, pos);
    } else if (op === 'insertParagraphBreak') {
      result = insertParagraphBreak(this._story, pos);
    } else {
      return false;
    }

    this._story = result.story;
    
    // Manage paragraph styles synchronization
    const afterCount = this._story.length;
    if (afterCount > beforeCount) {
      // Multiple paragraphs added (likely just +1 for Enter)
      const added = afterCount - beforeCount;
      const target = result.cursor.paraIndex;
      // Use previous paragraph's style as a base for the new one(s)
      const baseStyle = this._paragraphStyles[Math.max(0, target - 1)] || { fontSize: 22 };
      const newStyles = Array.from({ length: added }, () => ({ ...baseStyle }));
      this._paragraphStyles.splice(target, 0, ...newStyles);
    } else if (afterCount < beforeCount) {
      // Paragraph deleted/merged
      const removed = beforeCount - afterCount;
      const target = pos.paraIndex;
      this._paragraphStyles.splice(target, removed);
    }

    this._cursor = {
      paraIndex: result.cursor.paraIndex,
      charOffset: result.cursor.charOffset,
      lineIndex: this._cursor.lineIndex,
    };
    this._selection = null;
    return true;
  }

  /**
   * @param {import('./story-ops.js').Story} storyFragment
   * @param {import('./paragraph-style.js').ParagraphStyle[]} fragmentStyles
   */
  insertStory(storyFragment, fragmentStyles = []) {
    if (!storyFragment || storyFragment.length === 0) return false;
    
    // Replace selection if any
    this._replaceSelectionIfAny('');
    
    const beforeCount = this._story.length;
    const pos = toStoryPos(this._cursor);
    const result = insertStoryFragment(this._story, pos, storyFragment);
    
    this._story = result.story;
    const addedCount = this._story.length - beforeCount;
    
    if (addedCount > 0 && fragmentStyles.length > 0) {
      // Splice in the new styles (skipping the first one as it's merged)
      const targetIndex = result.cursor.paraIndex - addedCount + 1;
      const newStyles = fragmentStyles.slice(1).map(s => ({...s}));
      this._paragraphStyles.splice(targetIndex, 0, ...newStyles);
    }

    this._cursor = {
      paraIndex: result.cursor.paraIndex,
      charOffset: result.cursor.charOffset,
      lineIndex: this._cursor.lineIndex,
    };
    this._selection = null;
    return true;
  }

  /**
   * @param {InputEvent} event
   * @returns {boolean}
   */
  handleBeforeInput(event) {
    const type = event.inputType;

    if (type === 'insertText' && typeof event.data === 'string') {
      return this.applyOperation('insertText', { text: event.data });
    }

    if (type === 'insertFromPaste' && typeof event.data === 'string') {
      return this.applyOperation('insertText', { text: event.data });
    }

    if (type === 'insertLineBreak' || type === 'insertParagraph') {
      return this.applyOperation('insertParagraphBreak');
    }

    if (type === 'deleteContentBackward') {
      return this.applyOperation('deleteBackward');
    }

    if (type === 'deleteContentForward') {
      return this.applyOperation('deleteForward');
    }

    if (type === 'deleteWordBackward') {
      return this.deleteWordBackward();
    }

    if (type === 'deleteWordForward') {
      return this.deleteWordForward();
    }

    return false;
  }

  /**
   * @param {KeyboardEvent} event
   * @returns {boolean}
   */
  handleKeydown(event) {
    if (event.isComposing) return false;

    const wordDeleteMod = (event.altKey || event.ctrlKey) && !event.metaKey;
    if (wordDeleteMod && event.key === 'Backspace') {
      return this.deleteWordBackward();
    }
    if (wordDeleteMod && event.key === 'Delete') {
      return this.deleteWordForward();
    }

    if (event.key === 'Backspace') return this.applyOperation('deleteBackward');
    if (event.key === 'Delete') return this.applyOperation('deleteForward');
    if (event.key === 'Enter') return this.applyOperation('insertParagraphBreak');

    const key = event.key;
    if (event.ctrlKey || event.metaKey) {
      if (key.toLowerCase() === 'a') {
        event.preventDefault();
        this.selectAll();
        return true;
      }
      if (key.toLowerCase() === 'b') {
        event.preventDefault();
        this.applyCharacterStyle({ bold: !this.getTypingStyle().bold });
        return true;
      }
      if (key.toLowerCase() === 'i') {
        event.preventDefault();
        this.applyCharacterStyle({ italic: !this.getTypingStyle().italic });
        return true;
      }
      return false;
    }
    if (event.altKey) return false;
    if (event.key.length === 1) {
      return this.applyOperation('insertText', { text: event.key });
    }

    return false;
  }

  /**
   * @returns {string}
   */
  getSelectedText() {
    const range = this.getSelectionRange();
    if (!range) return '';
    return textInRange(this._story, range.start, range.end);
  }
  
  /**
   * @returns {import('./story-ops.js').Story}
   */
  getRichSelection() {
    const range = this.getSelectionRange();
    if (!range) return [];
    return getStoryFragment(this._story, range.start, range.end);
  }

  /**
   * @param {string} text
   * @returns {boolean}
   */
  replaceSelectionWithText(text) {
    const range = this.getSelectionRange();
    if (!range) return false;
    const result = replaceRange(
      this._story,
      range.start,
      range.end,
      String(text ?? ''),
      { typingStyle: this._typingStyle },
    );
    this._story = result.story;
    this._cursor = {
      paraIndex: result.cursor.paraIndex,
      charOffset: result.cursor.charOffset,
      lineIndex: this._cursor.lineIndex,
    };
    this._selection = null;
    return true;
  }

  /**
   * @param {Partial<import('./style.js').CharacterStyle>} stylePatch
   * @returns {boolean}
   */
  applyCharacterStyle(stylePatch) {
    const patch = { ...(stylePatch || {}) };
    if (Object.keys(patch).length === 0) return false;

    const range = this.getSelectionRange();
    if (range) {
      this._story = applyStyleRange(this._story, range.start, range.end, patch);
      this._selection = null;
      this._cursor = {
        paraIndex: range.end.paraIndex,
        charOffset: range.end.charOffset,
        lineIndex: this._cursor.lineIndex,
      };
      return true;
    }

    const caret = { paraIndex: this._cursor.paraIndex, charOffset: this._cursor.charOffset };
    const base = getStyleAtPos(this._story, caret, this._cursor.charOffset === 0 ? 'right' : 'left');
    this._typingStyle = cloneStyle({ ...base, ...patch });
    return true;
  }

  /**
   * Apply a character style to the entire current paragraph without
   * disturbing the cursor position. Used when no text is selected and
   * the style should affect the whole paragraph (e.g., font-family change).
   * @param {Partial<import('./style.js').CharacterStyle>} stylePatch
   */
  applyCharacterStyleToCurrentParagraph(stylePatch) {
    const p = this._cursor.paraIndex;
    const text = this._story[p].map(r => r.text).join('');
    const savedCursor = { ...this._cursor };
    this.setSelection({ paraIndex: p, charOffset: 0 }, { paraIndex: p, charOffset: text.length });
    this.applyCharacterStyle(stylePatch);
    this.clearSelection();
    this.moveCursor(savedCursor);
  }

  /**
   * @returns {import('./style.js').CharacterStyle}
   */
  getTypingStyle() {
    if (this._typingStyle) return cloneStyle(this._typingStyle);
    const caret = { paraIndex: this._cursor.paraIndex, charOffset: this._cursor.charOffset };
    const bias = this._cursor.charOffset === 0 ? 'right' : 'left';
    return getStyleAtPos(this._story, caret, bias);
  }
}
