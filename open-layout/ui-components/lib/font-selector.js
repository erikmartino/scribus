/**
 * ScribusFontSelector - Custom element for picking fonts.
 * Integrates with ScribusAppShell and its FontManager.
 */
import { GoogleFontManager } from '../../font-manager/google-font-manager.js';

export class ScribusFontSelector extends HTMLElement {
  static get observedAttributes() { return ['label', 'value', 'layout', 'no-focus']; }

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
          font-family: inherit;
        }
        :host(:not([label=""])) {
          gap: 6px;
        }
        :host([layout="horizontal"]) {
          flex-direction: row;
          align-items: center;
          gap: 12px;
        }
        label {
          color: var(--text-dim, #94949b);
          font-size: 0.75rem;
          font-weight: 500;
          text-transform: uppercase;
          letter-spacing: 0.025em;
          white-space: nowrap;
        }
        :host([layout="horizontal"]) label {
          margin-bottom: 0;
          min-width: 60px;
        }
        select {
          background: rgba(255, 255, 255, 0.03);
          border: 1px solid var(--border, #2e2e32);
          color: var(--text-main, #e1e1e6);
          padding: 8px 12px;
          border-radius: 8px;
          font-size: 0.875rem;
          font-family: inherit;
          cursor: pointer;
          transition: all 0.2s ease;
          outline: none;
          min-width: 160px;
        }
        select:hover {
          background: rgba(255, 255, 255, 0.06);
          border-color: var(--accent, #bb86fc);
        }
        select:focus {
          border-color: var(--accent, #bb86fc);
          box-shadow: 0 0 0 2px rgba(187, 134, 252, 0.1);
        }
        option {
          background: #1e1e20;
          color: #e1e1e6;
        }
      </style>
      <div 
        style="display: contents;" 
        onmousedown="if (event.target.tagName !== 'SELECT' && this.parentNode.host.hasAttribute('no-focus')) event.preventDefault()"
      >
        ${label ? `<label>${label}</label>` : ''}
        <select id="select">
          ${this._populateOptionsHtml()}
        </select>
      </div>
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
