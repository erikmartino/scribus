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
        try {
          await navigator.clipboard.writeText(json);
        } catch (writeErr) {
          // System clipboard entirely unavailable; localStorage fallback below will handle it
          console.info('[Clipboard] System clipboard write denied; using local storage only.');
        }
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
        } else {
          // Build items array from available clipboard data
          const items = [];
          const html = e.clipboardData.getData('text/html');
          if (html) items.push({ type: 'text/html', data: html });
          if (json) items.push({ type: 'plain-text', data: json });
          // Check for pasted images (files on the clipboard)
          for (const file of (e.clipboardData.files || [])) {
            if (file.type.startsWith('image/')) {
              items.push({ type: 'image', data: file, mimeType: file.type });
            }
          }
          if (items.length > 0) payload = { items };
        }
      } else {
        // Manual/Shortcut context (Async)
        const clipItems = await navigator.clipboard.read();
        for (const item of clipItems) {
          if (item.types.includes('application/json')) {
            const blob = await item.getType('application/json');
            payload = JSON.parse(await blob.text());
            break;
          }

          const items = [];

          // Check for image types
          const imageType = item.types.find(t => t.startsWith('image/'));
          if (imageType) {
            const blob = await item.getType(imageType);
            items.push({ type: 'image', data: blob, mimeType: imageType });
          }

          // Check for HTML
          if (item.types.includes('text/html')) {
            const blob = await item.getType('text/html');
            items.push({ type: 'text/html', data: await blob.text() });
          }

          // Check for plain text
          if (item.types.includes('text/plain')) {
            const blob = await item.getType('text/plain');
            const text = await blob.text();
            if (text.startsWith('{"version":') || text.startsWith('{"items":')) {
              payload = JSON.parse(text);
              break;
            }
            items.push({ type: 'plain-text', data: text });
          }

          if (!payload && items.length > 0) {
            payload = { items };
          }
        }
      }
    } catch (err) {
      if (err.name === 'NotAllowedError') {
        console.info('[Clipboard] System access denied; relying exclusively on internal local storage pasteboard.');
      } else {
        console.warn('[Clipboard] Read failed, falling back to local storage:', err.message);
      }
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
