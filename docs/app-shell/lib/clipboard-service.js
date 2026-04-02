import { selection } from './selection-service.js';

/**
 * ClipboardService - Handles rich copy-pasting across windows.
 */
export class ClipboardService {
  constructor(shell) {
    this.shell = shell;
    this._localKey = 'scribus_local_clipboard';
    this._lastPayload = null;
    this._attachListeners();
  }

  _attachListeners() {
    window.addEventListener('copy', (e) => this._handleCopy(e));
    window.addEventListener('cut', (e) => {
      this._handleCopy(e);
      this.shell.dispatchEvent(new CustomEvent('cut-executed', { detail: { type: 'cut' } }));
    });
    window.addEventListener('paste', (e) => this._handlePaste(e));
  }

  async _handleCopy(e) {
    // If we're focusing on an input and this is a native event, let the browser handle it
    if (e && ['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName)) return;

    // Aggregate all potential serializables
    const plugins = this.shell.plugins || [];
    const selectionItems = this.shell.selection ? this.shell.selection.all : [];
    
    // Convert to rich data fragments
    const serializedItems = [...plugins, ...selectionItems]
      .filter(p => typeof p.serialize === 'function')
      .map(p => p.serialize())
      .filter(Boolean);

    if (serializedItems.length === 0) return;

    const payload = {
      version: 1,
      source: window.location.origin,
      items: serializedItems
    };

    const json = JSON.stringify(payload);
    this._lastPayload = payload;

    // 1. Write to System Clipboard
    if (e && e.clipboardData) {
      e.clipboardData.setData('text/plain', json);
      e.clipboardData.setData('application/json', json);
      e.preventDefault();
    } else {
      // Manual trigger or shortcut intercepted by JS
      try {
        const clipboardItem = new ClipboardItem({
          'text/plain': new Blob([json], { type: 'text/plain' }),
          'application/json': new Blob([json], { type: 'application/json' })
        });
        await navigator.clipboard.write([clipboardItem]);
      } catch (err) {
        // Fallback for browsers with restricted ClipboardItem support for custom types
        await navigator.clipboard.writeText(json);
      }
    }

    // 2. Write to Local Storage (secondary fallback)
    localStorage.setItem(this._localKey, json);
    
    return payload;
  }

  async _handlePaste(e) {
    // If we're in an input and this is a native event, let native paste happen
    if (e && ['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName)) return;

    // 1. Try local cache for immediate/synchronous internal paste
    if (!e && this._lastPayload) {
      this.shell.dispatchEvent(new CustomEvent('paste-received', { detail: this._lastPayload }));
      return;
    }

    let payload = null;

    // 2. Try System Clipboard
    try {
      if (e && e.clipboardData) {
        // Native event context (Synchronous)
        const json = e.clipboardData.getData('application/json') || e.clipboardData.getData('text/plain');
        if (json && (json.startsWith('{"version":') || json.startsWith('{"items":'))) {
           payload = JSON.parse(json);
        } else if (json) {
           payload = { items: [{ type: 'plain-text', data: json }] };
        }
      } else {
        // Manual/Shortcut context (Async)
        const items = await navigator.clipboard.read();
        for (const item of items) {
          if (item.types.includes('application/json')) {
            const blob = await item.getType('application/json');
            payload = JSON.parse(await blob.text());
          } else if (item.types.includes('text/plain')) {
            const blob = await item.getType('text/plain');
            const text = await blob.text();
            if (text.startsWith('{"version":') || text.startsWith('{"items":')) {
              payload = JSON.parse(text);
            } else {
              payload = { items: [{ type: 'plain-text', data: text }] };
            }
          }
        }
      }
    } catch (err) {
      console.warn('System clipboard read failed, falling back to localStorage.', err);
    }

    // 2. Fallback to Local Storage
    if (!payload) {
      const localJson = localStorage.getItem(this._localKey);
      if (localJson) {
        try {
          payload = JSON.parse(localJson);
        } catch (e) {}
      }
    }

    if (payload && payload.items) {
      if (e) e.preventDefault();
      this.shell.dispatchEvent(new CustomEvent('paste-received', { detail: payload }));
    }
  }

  async copy() {
    return await this._handleCopy();
  }

  async cut() {
    const payload = await this._handleCopy();
    if (payload) {
      this.shell.dispatchEvent(new CustomEvent('cut-executed', { detail: payload }));
    }
    return payload;
  }

  async paste() {
    return await this._handlePaste();
  }
}
