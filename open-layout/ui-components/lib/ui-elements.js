/**
 * ScribusButton - Standard action button for the Scribus ecosystem.
 */
export class ScribusButton extends HTMLElement {
  static get observedAttributes() { return ['label', 'primary', 'icon', 'active', 'icon-only', 'no-focus']; }

  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
  }

  connectedCallback() {
    this.render();
  }

  attributeChangedCallback() {
    this.render();
  }

  render() {
    const label = this.getAttribute('label') || '';
    const primary = this.hasAttribute('primary');
    const icon = this.getAttribute('icon') || '';
    const active = this.hasAttribute('active');
    const iconOnly = this.hasAttribute('icon-only');
    
    this.shadowRoot.innerHTML = `
      <style>
        :host {
          display: inline-block;
        }
        button {
          background: ${active ? 'rgba(187, 134, 252, 0.15)' : (primary ? 'var(--accent, #bb86fc)' : 'rgba(255, 255, 255, 0.03)')};
          border: ${active ? '1.5px solid var(--accent, #bb86fc)' : (primary ? 'none' : '1px solid var(--border, #2e2e32)')};
          color: ${active ? 'var(--accent, #bb86fc)' : (primary ? '#000' : 'var(--text-main, #e1e1e6)')};
          padding: ${iconOnly ? '8px' : '8px 14px'};
          min-width: ${iconOnly ? '36px' : 'auto'};
          border-radius: 8px;
          cursor: pointer;
          font-size: 0.875rem;
          font-family: inherit;
          font-weight: ${(primary || active) ? '600' : '500'};
          transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
          display: flex;
          align-items: center;
          justify-content: center;
          gap: ${iconOnly ? '0' : '8px'};
          outline: none;
          box-shadow: ${active ? '0 0 15px rgba(187, 134, 252, 0.2)' : 'none'};
        }
        button:hover {
          background: ${active ? 'rgba(187, 134, 252, 0.2)' : (primary ? 'var(--accent, #bb86fc)' : 'rgba(255, 255, 255, 0.08)')};
          ${primary ? 'filter: brightness(1.1);' : 'border-color: var(--accent, #bb86fc);'}
          transform: translateY(-1px);
          box-shadow: ${primary ? '0 0 15px rgba(187, 134, 252, 0.4)' : (active ? '0 0 20px rgba(187, 134, 252, 0.3)' : '0 4px 12px rgba(187, 134, 252, 0.15)')};
        }
        button:active {
          transform: translateY(0);
        }
        .icon {
          display: flex;
          align-items: center;
          justify-content: center;
          pointer-events: none;
        }
        .label {
          display: ${iconOnly ? 'none' : 'block'};
        }
      </style>
      <button 
        title="${iconOnly ? label : ''}" 
        onmousedown="if (this.parentNode.host.hasAttribute('no-focus')) event.preventDefault()"
      >
        ${icon ? `<span class="icon">${icon}</span>` : ''}
        <span class="label">${label}</span>
      </button>
    `;
  }
}

/**
 * ScribusInput - Standard labeled input field.
 */
export class ScribusInput extends HTMLElement {
  static get observedAttributes() { return ['label', 'value', 'placeholder', 'type', 'min', 'max', 'layout', 'no-focus']; }

  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
  }

  connectedCallback() {
    this.render();
  }

  static get observedAttributes() {
    return ['label', 'value', 'type', 'placeholder', 'min', 'max', 'step', 'layout'];
  }

  attributeChangedCallback(name, oldVal, newVal) {
    if (oldVal === newVal) return;
    if (this._rendered) {
      this._updateSurgical(name, newVal);
    } else {
      this.render();
    }
  }

  _updateSurgical(name, val) {
    const input = this.shadowRoot.getElementById('input');
    const label = this.shadowRoot.querySelector('label');
    
    if (name === 'value' && input) {
      if (input.value !== val) {
        input.value = val;
        this._updateDisplay();
      }
    } else if (name === 'label' && label) {
      label.textContent = val || '';
      label.style.display = val ? 'block' : 'none';
    } else if (name === 'type' && input) {
      input.type = val || 'text';
      this.render(); // Changing type is a structural change, full render is safer but rare
    } else if (name === 'placeholder' && input) {
      input.placeholder = val || '';
    } else if (name === 'min' && input) {
      input.min = val;
    } else if (name === 'max' && input) {
      input.max = val;
    } else if (name === 'step' && input) {
      input.step = val;
    }
  }

  get value() {
    return this.shadowRoot.querySelector('input')?.value || '';
  }

  set value(v) {
    const input = this.shadowRoot.querySelector('input');
    if (input) {
      input.value = v;
      this._updateDisplay();
    }
  }

  _updateDisplay() {
    const input = this.shadowRoot.getElementById('input');
    const display = this.shadowRoot.getElementById('val-display');
    const type = this.getAttribute('type');
    if (input && display && type === 'range') {
      display.textContent = input.value;
    }
  }

  render() {
    this._rendered = true;
    const label = this.getAttribute('label') || '';
    const value = this.getAttribute('value') || '';
    const type = this.getAttribute('type') || 'text';
    const placeholder = this.getAttribute('placeholder') || '';
    const min = this.getAttribute('min') || null;
    const max = this.getAttribute('max') || null;

    this.shadowRoot.innerHTML = `
      <style>
        :host {
          display: flex;
          flex-direction: column;
          gap: 6px;
          font-family: inherit;
        }
        :host([layout="horizontal"]) {
          flex-direction: row;
          align-items: center;
          gap: 8px;
        }
        label {
          color: var(--text-dim, #94949b);
          font-size: 0.75rem;
          font-weight: 500;
          text-transform: uppercase;
          letter-spacing: 0.025em;
          white-space: nowrap;
        }
        input {
          background: rgba(255, 255, 255, 0.03);
          border: 1px solid var(--border, #2e2e32);
          color: var(--text-main, #e1e1e6);
          padding: 8px 12px;
          border-radius: 6px;
          font-size: 0.875rem;
          font-family: inherit;
          transition: all 0.2s ease;
          width: 100%;
          box-sizing: border-box;
          outline: none;
        }
        input:focus {
          border-color: var(--accent, #bb86fc);
          background: rgba(255, 255, 255, 0.05);
          box-shadow: 0 0 0 2px rgba(187, 134, 252, 0.1);
        }
        .val {
          font-size: 0.7rem;
          font-family: 'JetBrains Mono', monospace;
          color: var(--accent, #bb86fc);
          font-weight: bold;
          min-width: 2.5em;
          display: inline-block;
          text-align: right;
        }
        .header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          width: 100%;
        }
        input[type="range"] {
          -webkit-appearance: none;
          height: 3px;
          background: rgba(255, 255, 255, 0.1);
          border: none;
          padding: 0;
          margin: 10px 0;
        }
        input[type="range"]::-webkit-slider-thumb {
          -webkit-appearance: none;
          width: 12px;
          height: 12px;
          background: var(--accent, #bb86fc);
          border-radius: 50%;
          cursor: pointer;
          box-shadow: 0 0 10px rgba(187, 134, 252, 0.4);
          transition: transform 0.1s ease;
        }
        input[type="range"]::-webkit-slider-thumb:hover {
          transform: scale(1.3);
          background: #fff;
        }
      </style>
      <div class="header">
        ${label ? `<label>${label}</label>` : ''}
        <span class="val" id="val-display"></span>
      </div>
      <input 
        id="input"
        type="${type}" 
        value="${value}" 
        placeholder="${placeholder}"
        ${min ? `min="${min}"` : ''}
        ${max ? `max="${max}"` : ''}
      >
    `;

    const input = this.shadowRoot.getElementById('input');
    const display = this.shadowRoot.getElementById('val-display');

    const updateDisplay = () => this._updateDisplay();
    updateDisplay();

    input.addEventListener('input', (e) => {
      updateDisplay();
      if (type === 'range') {
        this.dispatchEvent(new CustomEvent('change', { 
          detail: e.target.value,
          bubbles: true,
          composed: true
        }));
      }
    });

    input.addEventListener('change', (e) => {
      if (type !== 'range') {
        this.dispatchEvent(new CustomEvent('change', { 
          detail: e.target.value,
          bubbles: true,
          composed: true
        }));
      }
    });

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        input.blur();
      }
    });
  }
}

if (!customElements.get('scribus-button')) {
  customElements.define('scribus-button', ScribusButton);
}
if (!customElements.get('scribus-input')) {
  customElements.define('scribus-input', ScribusInput);
}
