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
  static get observedAttributes() {
    return ['label', 'value', 'type', 'placeholder', 'min', 'max', 'step', 'layout', 'no-focus'];
  }

  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
  }

  connectedCallback() {
    this.render();
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
      // Don't overwrite the value of a range input while the user is dragging
      // it — the drag is tracked by the browser using the current DOM value, so
      // setting input.value externally during a drag resets the thumb position.
      if (input.type === 'range' && this._dragging) return;
      // Guard against null (attribute removed): setting input.value = null
      // gets clamped to min on range inputs, resetting the thumb to 1.
      if (val === null || val === undefined) return;
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
        .input-container {
          position: relative;
          display: flex;
          align-items: center;
          width: 100%;
        }
        input {
          background: rgba(255, 255, 255, 0.03);
          border: 1px solid var(--border, #2e2e32);
          color: var(--text-main, #e1e1e6);
          padding: 8px 12px;
          padding-right: ${type === 'number' ? '32px' : '12px'};
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
        /* Hide native spinner buttons */
        input[type="number"]::-webkit-outer-spin-button,
        input[type="number"]::-webkit-inner-spin-button {
          -webkit-appearance: none;
          margin: 0;
        }
        input[type="number"] {
          -moz-appearance: textfield;
        }
        .spinner-buttons {
          position: absolute;
          right: 4px;
          display: flex;
          flex-direction: column;
          height: calc(100% - 8px);
          width: 24px;
          justify-content: center;
          gap: 2px;
          z-index: 10;
        }
        .spin-btn {
          background: rgba(255, 255, 255, 0.05);
          border: 1px solid var(--border, #2e2e32);
          color: var(--text-dim, #94949b);
          font-size: 8px;
          display: flex;
          align-items: center;
          justify-content: center;
          height: 14px;
          width: 100%;
          cursor: pointer;
          border-radius: 3px;
          padding: 0;
          user-select: none;
          transition: all 0.15s ease;
        }
        .spin-btn:hover {
          background: rgba(255, 255, 255, 0.15);
          color: var(--text-main, #e1e1e6);
          border-color: var(--accent, #bb86fc);
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
          appearance: none;
          height: 3px;
          background: rgba(255, 255, 255, 0.1);
          border: none;
          padding: 0;
          margin: 10px 0;
        }
      </style>
      <div class="header">
        ${label ? `<label>${label}</label>` : ''}
        <span class="val" id="val-display"></span>
      </div>
      <div class="input-container">
        <input
          id="input"
          type="${type}"
          value="${value}"
          placeholder="${placeholder}"
          ${min ? `min="${min}"` : ''}
          ${max ? `max="${max}"` : ''}
        >
        ${type === 'number' ? `
          <div class="spinner-buttons">
            <button type="button" class="spin-btn spin-up" aria-label="Increment">▲</button>
            <button type="button" class="spin-btn spin-down" aria-label="Decrement">▼</button>
          </div>
        ` : ''}
      </div>
    `;

    const input = this.shadowRoot.getElementById('input');
    const display = this.shadowRoot.getElementById('val-display');

    const updateDisplay = () => this._updateDisplay();
    updateDisplay();

    if (type === 'range') {
      // Set _dragging on mousedown so that attribute reconciliation from
      // concurrent update() calls cannot reset the slider value mid-drag.
      // Using mousedown (not pointerdown) because Playwright's synthetic
      // page.mouse.down() reliably fires mousedown on shadow-DOM inputs.
      // Clear via window mouseup/pointerup so release outside the element works.
      input.addEventListener('mousedown', () => {
        this._dragging = true;
        const clearDragging = () => { this._dragging = false; };
        window.addEventListener('mouseup',    clearDragging, { once: true });
        window.addEventListener('pointerup',  clearDragging, { once: true });
        window.addEventListener('pointercancel', clearDragging, { once: true });
      });
    }

    if (type === 'number') {
      const upBtn = this.shadowRoot.querySelector('.spin-up');
      const downBtn = this.shadowRoot.querySelector('.spin-down');
      
      const changeVal = (direction) => {
        let val = Number(input.value) || 0;
        const step = Number(this.getAttribute('step')) || 1;
        const minVal = min !== null ? Number(min) : -Infinity;
        const maxVal = max !== null ? Number(max) : Infinity;
        
        if (direction === 'up') {
          val = Math.min(maxVal, val + step);
        } else {
          val = Math.max(minVal, val - step);
        }
        
        input.value = String(val);
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
      };

      if (upBtn) upBtn.addEventListener('click', () => changeVal('up'));
      if (downBtn) downBtn.addEventListener('click', () => changeVal('down'));
    }

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
