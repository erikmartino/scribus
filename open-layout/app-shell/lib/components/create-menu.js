/**
 * ScribusCreateMenu - Dropdown button for creating new objects.
 *
 * Reads `window.scribusShell.creatables` to populate the menu items.
 * Placed in the ribbon bar as the leftmost element.
 *
 * The dropdown panel is portalled to document.body so it escapes the
 * ribbon's overflow clipping context.
 */
export class ScribusCreateMenu extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this._open = false;
    this._dropdown = null;
    this._onDocClick = this._onDocClick.bind(this);
  }

  connectedCallback() {
    this.render();
    this._createDropdown();
    document.addEventListener('click', this._onDocClick, true);

    if (window.scribusShell) {
      this._onCreatablesChanged = () => { if (this._open) this._updateItems(); };
      window.scribusShell.addEventListener('creatables-changed', this._onCreatablesChanged);
    }
  }

  disconnectedCallback() {
    document.removeEventListener('click', this._onDocClick, true);
    if (this._dropdown && this._dropdown.parentNode) {
      this._dropdown.parentNode.removeChild(this._dropdown);
    }
    if (window.scribusShell && this._onCreatablesChanged) {
      window.scribusShell.removeEventListener('creatables-changed', this._onCreatablesChanged);
    }
  }

  _onDocClick(e) {
    if (!this._open) return;
    // Close if the click is outside both the trigger and the dropdown
    const path = e.composedPath();
    if (!path.includes(this) && !path.includes(this._dropdown)) {
      this._close();
    }
  }

  _toggle() {
    this._open ? this._close() : this._openMenu();
  }

  _openMenu() {
    this._open = true;
    this._updateItems();
    this._positionDropdown();
    this._dropdown.style.display = 'block';
  }

  _close() {
    this._open = false;
    if (this._dropdown) {
      this._dropdown.style.display = 'none';
    }
  }

  _positionDropdown() {
    const trigger = this.shadowRoot.getElementById('trigger');
    const rect = trigger.getBoundingClientRect();
    this._dropdown.style.top = `${rect.bottom + 6}px`;
    this._dropdown.style.left = `${rect.left}px`;
  }

  _createDropdown() {
    const dd = document.createElement('div');
    dd.className = 'scribus-create-dropdown';
    dd.style.cssText = `
      display: none;
      position: fixed;
      min-width: 180px;
      background: #1e1e20;
      border: 1px solid #2e2e32;
      border-radius: 10px;
      box-shadow: 0 12px 40px rgba(0,0,0,0.5);
      z-index: 9000;
      padding: 6px;
      font-family: 'Inter', system-ui, -apple-system, sans-serif;
    `;
    dd.innerHTML = '<div class="scribus-create-dropdown-items"></div>';
    document.body.appendChild(dd);
    this._dropdown = dd;
  }

  _updateItems() {
    const list = this._dropdown.querySelector('.scribus-create-dropdown-items');
    if (!list) return;

    list.innerHTML = '';
    const shell = window.scribusShell;
    if (!shell || shell.creatables.length === 0) {
      const empty = document.createElement('div');
      empty.style.cssText = 'padding:16px;text-align:center;color:#666;font-size:0.8rem;';
      empty.textContent = 'No object types registered.';
      list.appendChild(empty);
      return;
    }

    shell.creatables.forEach(c => {
      const item = document.createElement('button');
      item.className = 'scribus-create-menu-item';
      item.style.cssText = `
        display: flex;
        align-items: center;
        gap: 10px;
        width: 100%;
        padding: 10px 14px;
        background: none;
        border: none;
        border-radius: 6px;
        color: #e1e1e6;
        font-size: 0.875rem;
        font-family: inherit;
        cursor: pointer;
        transition: background 0.12s;
        text-align: left;
      `;
      const iconSpan = c.icon
        ? `<span style="display:flex;align-items:center;justify-content:center;width:22px;flex-shrink:0;opacity:0.85">${c.icon}</span>`
        : '';
      item.innerHTML = `${iconSpan}<span style="flex:1;white-space:nowrap">${c.label}</span>`;
      item.addEventListener('mousedown', (e) => e.preventDefault());
      item.addEventListener('mouseover', () => { item.style.background = 'rgba(255,255,255,0.06)'; });
      item.addEventListener('mouseout', () => { item.style.background = 'none'; });
      item.addEventListener('click', (e) => {
        e.stopPropagation();
        c.onCreate();
        this._close();
      });
      list.appendChild(item);
    });
  }

  render() {
    this.shadowRoot.innerHTML = `
      <style>
        :host {
          display: inline-block;
        }

        .trigger {
          background: var(--accent, #bb86fc);
          border: none;
          color: #000;
          width: 36px;
          height: 36px;
          border-radius: 8px;
          cursor: pointer;
          font-size: 1.25rem;
          font-weight: 700;
          font-family: inherit;
          display: flex;
          align-items: center;
          justify-content: center;
          transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
          outline: none;
        }
        .trigger:hover {
          filter: brightness(1.1);
          transform: translateY(-1px);
          box-shadow: 0 0 15px rgba(187, 134, 252, 0.4);
        }
        .trigger:active {
          transform: translateY(0);
        }
      </style>

      <button class="trigger" id="trigger" title="Create new object">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">
          <line x1="12" y1="5" x2="12" y2="19"></line>
          <line x1="5" y1="12" x2="19" y2="12"></line>
        </svg>
      </button>
    `;

    this.shadowRoot.getElementById('trigger').addEventListener('mousedown', (e) => e.preventDefault());
    this.shadowRoot.getElementById('trigger').addEventListener('click', (e) => {
      e.stopPropagation();
      this._toggle();
    });
  }
}

if (!customElements.get('scribus-create-menu')) {
  customElements.define('scribus-create-menu', ScribusCreateMenu);
}
