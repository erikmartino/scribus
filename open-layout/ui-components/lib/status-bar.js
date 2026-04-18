/**
 * ScribusStatusBar - Shared status bar component.
 *
 * Attributes:
 *   type - "ok" | "error" | omit for default dim text
 *
 * Usage:
 *   <scribus-status-bar type="ok">Ready</scribus-status-bar>
 *
 * JS API:
 *   el.setText('message', 'ok')   // convenience setter
 */
export class ScribusStatusBar extends HTMLElement {
  static get observedAttributes() { return ['type']; }

  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
  }

  connectedCallback() {
    this._render();
  }

  attributeChangedCallback() {
    this._render();
  }

  /**
   * Convenience method: set text content and optional type in one call.
   * @param {string} msg
   * @param {'ok'|'error'|''} [type]
   */
  setText(msg, type) {
    this.textContent = msg;
    if (type) {
      this.setAttribute('type', type);
    } else {
      this.removeAttribute('type');
    }
  }

  _render() {
    const type = this.getAttribute('type') || '';
    let color = 'var(--text-dim, #a1a1aa)';
    if (type === 'ok') color = 'var(--accent-secondary, #03dac6)';
    if (type === 'error') color = '#ff5555';

    this.shadowRoot.innerHTML = `
      <style>
        :host {
          position: absolute;
          bottom: 0;
          left: 0;
          padding: 4px 12px;
          font-size: 0.7rem;
          color: ${color};
          background: rgba(0, 0, 0, 0.4);
          z-index: 2000;
          border-top-right-radius: 8px;
          backdrop-filter: blur(4px);
          font-family: inherit;
        }
      </style>
      <slot></slot>
    `;
  }
}

if (!customElements.get('scribus-status-bar')) {
  customElements.define('scribus-status-bar', ScribusStatusBar);
}
