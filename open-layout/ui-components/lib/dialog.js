/**
 * ScribusDialog - Modal dialog with overlay.
 *
 * Attributes:
 *   open     - Boolean; controls visibility.
 *   heading  - Optional dialog title text.
 *
 * Slots:
 *   (default) - Dialog body content (inputs, text, etc.)
 *   actions   - Footer button row (right-aligned flex).
 *
 * Methods:
 *   show()   - Opens the dialog.
 *   close()  - Closes the dialog.
 *
 * Events:
 *   close    - Dispatched when the user dismisses via backdrop click or Escape.
 *
 * Usage:
 *   <scribus-dialog heading="New Document">
 *     <label>Name</label>
 *     <input type="text" value="my-doc">
 *     <div slot="actions">
 *       <button>Cancel</button>
 *       <button class="primary">Create</button>
 *     </div>
 *   </scribus-dialog>
 */
export class ScribusDialog extends HTMLElement {
  static get observedAttributes() { return ['open', 'heading']; }

  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this._onKeyDown = this._onKeyDown.bind(this);
  }

  connectedCallback() {
    this._render();
    if (this.hasAttribute('open')) {
      document.addEventListener('keydown', this._onKeyDown);
    }
  }

  disconnectedCallback() {
    document.removeEventListener('keydown', this._onKeyDown);
  }

  attributeChangedCallback(name) {
    if (name === 'open') {
      if (this.hasAttribute('open')) {
        document.addEventListener('keydown', this._onKeyDown);
      } else {
        document.removeEventListener('keydown', this._onKeyDown);
      }
    }
    this._render();
  }

  show() {
    this.setAttribute('open', '');
  }

  close() {
    this.removeAttribute('open');
    this.dispatchEvent(new Event('close', { bubbles: true }));
  }

  _onKeyDown(e) {
    if (e.key === 'Escape') {
      e.stopPropagation();
      this.close();
    }
  }

  _render() {
    const isOpen = this.hasAttribute('open');
    const heading = this.getAttribute('heading') || '';

    if (!isOpen) {
      this.shadowRoot.innerHTML = '';
      return;
    }

    this.shadowRoot.innerHTML = `
      <style>
        :host {
          position: fixed;
          inset: 0;
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 5000;
          font-family: 'Inter', system-ui, -apple-system, sans-serif;
        }
        .overlay {
          position: fixed;
          inset: 0;
          background: rgba(0, 0, 0, 0.6);
        }
        .dialog {
          position: relative;
          background: var(--shell-bg, #1e1e20);
          border: 1px solid var(--border, #2e2e32);
          border-radius: 12px;
          padding: 1.5rem;
          min-width: 340px;
          max-width: 90vw;
          box-shadow: var(--shadow-lg, 0 10px 30px rgba(0,0,0,0.5));
          animation: slideIn 0.2s cubic-bezier(0.4, 0, 0.2, 1);
        }
        @keyframes slideIn {
          from { transform: translateY(-20px); opacity: 0; }
          to   { transform: translateY(0);     opacity: 1; }
        }
        h3 {
          margin: 0 0 1rem;
          font-size: 1rem;
          color: var(--text-main, #e1e1e6);
        }

        /* Light-DOM slotted form elements get baseline styling via ::slotted */
        ::slotted(label) {
          display: block;
          font-size: 0.8rem;
          color: var(--text-dim, #a1a1aa);
          margin-bottom: 0.3rem;
        }
        ::slotted(input) {
          width: 100%;
          padding: 0.5rem;
          border: 1px solid var(--border, #2e2e32);
          border-radius: 6px;
          background: var(--bg-color, #121214);
          color: var(--text-main, #e1e1e6);
          font-family: inherit;
          font-size: 0.9rem;
          outline: none;
          margin-bottom: 0.8rem;
          box-sizing: border-box;
        }
        ::slotted(input:focus) {
          border-color: var(--accent, #bb86fc);
        }

        .actions {
          display: flex;
          gap: 0.5rem;
          justify-content: flex-end;
          margin-top: 0.5rem;
        }
        /* Style slotted buttons in the actions row */
        ::slotted(button) {
          font-family: inherit;
          font-size: 0.85rem;
          padding: 0.4rem 1rem;
          border-radius: 6px;
          border: 1px solid var(--border, #2e2e32);
          background: transparent;
          color: var(--text-main, #e1e1e6);
          cursor: pointer;
        }
        ::slotted(button.primary) {
          background: var(--accent, #bb86fc);
          color: #121214;
          border-color: var(--accent, #bb86fc);
          font-weight: 600;
        }
        ::slotted(button:disabled) {
          opacity: 0.4;
          pointer-events: none;
        }
      </style>
      <div class="overlay" id="overlay"></div>
      <div class="dialog">
        ${heading ? `<h3>${heading}</h3>` : ''}
        <slot></slot>
        <div class="actions">
          <slot name="actions"></slot>
        </div>
      </div>
    `;

    // Close on overlay click
    this.shadowRoot.getElementById('overlay').addEventListener('click', () => {
      this.close();
    });
  }
}

if (!customElements.get('scribus-dialog')) {
  customElements.define('scribus-dialog', ScribusDialog);
}
