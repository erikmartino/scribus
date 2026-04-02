import { selection } from './selection-service.js';

/**
 * ClipboardService - Handles rich copy-pasting across windows.
 */
export class ClipboardService {
  constructor(shell) {
    this.shell = shell;
    this._localKey = 'scribus_local_clipboard';
    this._attachListeners();
  }

  _attachListeners() {
    window.addEventListener('copy', (e) => this._handleCopy(e));
    window.addEventListener('cut', (e) => this._handleCopy(e));
    window.addEventListener('paste', (e) => this._handlePaste(e));
  }

  _handleCopy(e) {
    // If we're focusing on an input, let the browser handle it (plain text)
    if (['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName)) return;

    const items = selection.all;
    if (items.length === 0) return;

    // Call serialize() on all items (ADM protocol)
    const serialized = items.map(item => {
      // If the item has a serialize/export method, use it
      return (typeof item.serialize === 'function') ? item.serialize() : item;
    });

    const payload = {
      version: 1,
      source: window.location.origin,
      items: serialized
    };

    const json = JSON.stringify(payload);

    // 1. Write to System Clipboard (text fallback)
    e.clipboardData.setData('text/plain', json);
    e.clipboardData.setData('application/json', json);

    // 2. Write to Local Storage (cross-window rich state)
    localStorage.setItem(this._localKey, json);

    e.preventDefault();
  }

  _handlePaste(e) {
    const types = e.clipboardData.types;
    let payload = {
      version: 1,
      source: 'External',
      items: []
    };

    // 1. Try Scribus-specific JSON from system clipboard FIRST
    let json = e.clipboardData.getData('application/json');
    if (json) {
       try {
         const data = JSON.parse(json);
         if (data.items) {
           this.shell.dispatchEvent(new CustomEvent('paste-received', { detail: data }));
           return;
         }
       } catch (err) { /* ignore and try fallbacks */ }
    }

    // 2. Handle Rich Text from External Apps (macOS, Word, etc.)
    if (types.includes('text/html')) {
      const html = e.clipboardData.getData('text/html');
      payload.items.push({
        type: 'rich-text-fragment',
        data: html
      });
    } else if (types.includes('text/plain')) {
      const text = e.clipboardData.getData('text/plain');
      
      // Check if this text/plain is actually our JSON (some browsers/OSs might strip it)
      if (text.startsWith('{"version":')) {
        try {
          const data = JSON.parse(text);
          if (data.items) {
            this.shell.dispatchEvent(new CustomEvent('paste-received', { detail: data }));
            return;
          }
        } catch (e) {}
      }

      payload.items.push({
        type: 'plain-text',
        data: text
      });
    }
    
    // 3. Last fallback: localStorage (only if we didn't find anything in the system clipboard)
    if (payload.items.length === 0) {
      const localJson = localStorage.getItem(this._localKey);
      if (localJson) {
        try {
          const data = JSON.parse(localJson);
          if (data.items) {
             this.shell.dispatchEvent(new CustomEvent('paste-received', { detail: data }));
             return;
          }
        } catch (e) {}
      }
    }

    // 3. Handle Images from External Apps
    if (e.clipboardData.files && e.clipboardData.files.length > 0) {
      for (const file of e.clipboardData.files) {
        if (file.type.startsWith('image/')) {
          payload.items.push({
            type: 'image-blob',
            data: URL.createObjectURL(file), // Provide a blob URL
            fileName: file.name,
            mimeType: file.type
          });
        }
      }
    }

    if (payload.items.length > 0) {
      this.shell.dispatchEvent(new CustomEvent('paste-received', { detail: payload }));
    }
  }

  /**
   * Manual copy trigger
   */
  copy() {
    document.execCommand('copy');
  }

  /**
   * Manual cut trigger
   */
  cut() {
    document.execCommand('cut');
  }

  /**
   * Manual paste trigger
   */
  paste() {
    document.execCommand('paste');
  }
}
