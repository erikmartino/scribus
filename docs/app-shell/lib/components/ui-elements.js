/**
 * ScribusButton - Standard action button for the Scribus ecosystem.
 */
export class ScribusButton extends HTMLElement {
  static get observedAttributes() { return ['label', 'primary', 'icon', 'active']; }

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
    
    this.shadowRoot.innerHTML = `
      <style>
        :host {
          display: inline-block;
        }
        button {
          background: ${active ? 'rgba(187, 134, 252, 0.15)' : (primary ? 'var(--accent, #bb86fc)' : 'rgba(255, 255, 255, 0.03)')};
          border: ${active ? '1.5px solid var(--accent, #bb86fc)' : (primary ? 'none' : '1px solid var(--border, #2e2e32)')};
          color: ${active ? 'var(--accent, #bb86fc)' : (primary ? '#000' : 'var(--text-main, #e1e1e6)')};
          padding: 8px 14px;
          border-radius: 8px;
          cursor: pointer;
          font-size: 0.875rem;
          font-family: inherit;
          font-weight: ${(primary || active) ? '600' : '500'};
          transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 8px;
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
        }
      </style>
      <button>
        ${icon ? `<span class="icon">${icon}</span>` : ''}
        <span>${label}</span>
      </button>
    `;
  }
}

/**
 * ScribusInput - Standard labeled input field.
 */
export class ScribusInput extends HTMLElement {
  static get observedAttributes() { return ['label', 'value', 'type', 'placeholder']; }

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

  get value() {
    return this.shadowRoot.querySelector('input')?.value || '';
  }

  set value(v) {
    const input = this.shadowRoot.querySelector('input');
    if (input) input.value = v;
  }

  render() {
    const label = this.getAttribute('label') || '';
    const value = this.getAttribute('value') || '';
    const type = this.getAttribute('type') || 'text';
    const placeholder = this.getAttribute('placeholder') || '';
    const min = this.getAttribute('min') || '';
    const max = this.getAttribute('max') || '';

    this.shadowRoot.innerHTML = `
      <style>
        :host {
          display: flex;
          flex-direction: column;
          gap: 6px;
          font-family: inherit;
        }
        .header {
          display: flex;
          justify-content: space-between;
          align-items: center;
        }
        label {
          font-size: 0.65rem;
          color: var(--text-dim, #a1a1aa);
          text-transform: uppercase;
          letter-spacing: 0.08em;
          font-weight: 700;
        }
        .val {
          font-size: 0.7rem;
          font-family: 'JetBrains Mono', monospace;
          color: var(--accent, #bb86fc);
          font-weight: bold;
        }
        input {
          background: rgba(255, 255, 255, 0.03);
          border: 1px solid var(--border, rgba(255, 255, 255, 0.08));
          color: var(--text-main, #e1e1e6);
          padding: 8px 12px;
          border-radius: 6px;
          font-size: 0.85rem;
          font-family: inherit;
          transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
          outline: none;
        }
        input:focus {
          border-color: var(--accent, #bb86fc);
          background: rgba(255, 255, 255, 0.06);
          box-shadow: 0 0 12px rgba(187, 134, 252, 0.15);
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

    const updateDisplay = () => {
      if (type === 'range') display.textContent = input.value;
    };

    updateDisplay();

    input.addEventListener('input', (e) => {
      updateDisplay();
      // Use 'change' for consistency with components but trigger on input for immediate feedback
      this.dispatchEvent(new CustomEvent('change', { 
        detail: e.target.value,
        bubbles: true,
        composed: true
      }));
    });
  }
}

if (!customElements.get('scribus-button')) {
  customElements.define('scribus-button', ScribusButton);
}
if (!customElements.get('scribus-input')) {
  customElements.define('scribus-input', ScribusInput);
}
