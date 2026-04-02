/**
 * ScribusFontSelector - Custom element for picking fonts.
 * Integrates with ScribusAppShell and its FontManager.
 */
import { GoogleFontManager } from '../../font-manager/google-font-manager.js';

export class ScribusFontSelector extends HTMLElement {
  static get observedAttributes() { return ['value', 'label']; }

  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this._fontManager = new GoogleFontManager();
    this._loading = false;
    this._initialized = false;
    this._families = [];
  }

  connectedCallback() {
    this._initialized = true;
    this.render();
    this._loadFonts();
  }

  attributeChangedCallback() {
    if (this._initialized) this.render();
  }

  get value() {
    return this.shadowRoot.querySelector('select')?.value || this.getAttribute('value') || '';
  }

  set value(v) {
    this.setAttribute('value', v);
    const select = this.shadowRoot.querySelector('select');
    if (select) select.value = v;
  }

  async _loadFonts() {
    if (this._loading) return;
    this._loading = true;

    try {
      this._families = await this._fontManager.getFamilies();
      this.render(); // Re-render once we have the full list
    } catch (e) {
      console.warn('ScribusFontSelector: Failed to load fonts:', e);
    } finally {
      this._loading = false;
    }
  }

  render() {
    const label = this.getAttribute('label') || '';
    const value = this.getAttribute('value') || '';

    this.shadowRoot.innerHTML = `
      <style>
        :host {
          display: flex;
          flex-direction: column;
          gap: 6px;
          font-family: inherit;
        }
        label {
          font-size: 0.65rem;
          color: var(--text-dim, #a1a1aa);
          text-transform: uppercase;
          letter-spacing: 0.08em;
          font-weight: 700;
        }
        select {
          background: rgba(255, 255, 255, 0.03);
          border: 1px solid var(--border, rgba(255, 255, 255, 0.08));
          color: var(--text-main, #e1e1e6);
          padding: 8px 12px;
          border-radius: 6px;
          font-size: 0.85rem;
          font-family: inherit;
          transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
          outline: none;
          cursor: pointer;
          min-width: 140px;
        }
        select:focus {
          border-color: var(--accent, #bb86fc);
          background: rgba(255, 255, 255, 0.06);
          box-shadow: 0 0 12px rgba(187, 134, 252, 0.15);
        }
        option {
          background: #1e1e20;
          color: #e1e1e6;
        }
      </style>
      ${label ? `<label>${label}</label>` : ''}
      <select id="select">
        ${this._populateOptionsHtml()}
      </select>
    `;

    const select = this.shadowRoot.getElementById('select');
    if (select) {
      select.addEventListener('change', (e) => {
        this.setAttribute('value', e.target.value);
        this.dispatchEvent(new CustomEvent('change', { 
          detail: e.target.value,
          bubbles: true,
          composed: true
        }));
      });
    }
  }

  _populateOptionsHtml() {
    const value = this.getAttribute('value') || '';
    if (!this._families || this._families.length === 0) {
      return value ? `<option value="${value}">${value}</option>` : '<option value="">Loading fonts...</option>';
    }

    let html = '';
    
    // Ensure the current value is always represented even if not in the list
    if (value && !this._families.find(f => f.family === value)) {
      html += `<option value="${value}">${value}</option>`;
    }

    for (const f of this._families) {
      const selected = f.family === value ? 'selected' : '';
      html += `<option value="${f.family}" ${selected}>${f.family}</option>`;
    }
    return html;
  }
}

if (!customElements.get('scribus-font-selector')) {
  customElements.define('scribus-font-selector', ScribusFontSelector);
}
