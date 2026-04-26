/**
 * ScribusAppShell - Reusable layout component for Scribus demos/apps.
 * 
 * Slots:
 *   default: Main workspace content
 *   ribbon: Contents of the top ribbon bar
 *   panels: Right side panel contents
 */
export class ScribusAppShell extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
  }

  connectedCallback() {
    this.shadowRoot.innerHTML = `
      <style>
        :host {
          --ribbon-height: 80px;
          --panel-width: 250px;
          --bg-color: #121214;
          --shell-bg: #1e1e20;
          --accent: #bb86fc;
          --accent-secondary: #03dac6;
          --text-main: #e1e1e6;
          --text-dim: #a1a1aa;
          --border: #2e2e32;
          --panel-bg: rgba(30,30,32, 0.8);
          --glass: blur(14px);
          --shadow-lg: 0 10px 30px rgba(0,0,0,0.5);
          --transition-fast: 0.2s cubic-bezier(0.4, 0, 0.2, 1);
          --transition-slow: 0.4s cubic-bezier(0.4, 0, 0.2, 1);
          
          display: block;
          width: 100vw;
          height: 100vh;
          overflow: hidden;
          background-color: var(--bg-color);
          color: var(--text-main);
          font-family: 'Inter', system-ui, -apple-system, sans-serif;
        }

        .app-shell {
          display: grid;
          grid-template-areas: 
            "ribbon ribbon ribbon"
            "main handle panels";
          grid-template-rows: var(--ribbon-height) 1fr;
          grid-template-columns: 1fr 4px auto;
          width: 100%;
          height: 100%;
        }

        .ribbon {
          grid-area: ribbon;
          background: var(--shell-bg);
          border-bottom: 1px solid var(--border);
          display: flex;
          align-items: center;
          gap: 16px;
          padding: 0 20px;
          z-index: 100;
          backdrop-filter: var(--glass);
          box-shadow: 0 4px 10px rgba(0,0,0,0.3);
          overflow-x: auto;
          scrollbar-width: none; /* Firefox */
        }
        .ribbon::-webkit-scrollbar {
          display: none; /* Safari/Chrome */
        }

        .app-launcher {
          flex-shrink: 0;
          display: flex;
          align-items: center;
        }

        .app-launcher-btn {
          display: flex;
          align-items: center;
          justify-content: center;
          width: 32px;
          height: 32px;
          border: 1px solid var(--border);
          border-radius: 6px;
          background: rgba(255, 255, 255, 0.02);
          color: var(--text-dim);
          cursor: pointer;
          transition: border-color var(--transition-fast), color var(--transition-fast), background-color var(--transition-fast);
          padding: 0;
        }

        .app-launcher-btn:hover,
        .app-launcher-btn:focus-visible,
        .app-launcher-btn[aria-expanded="true"] {
          color: var(--accent);
          border-color: var(--accent);
          background: rgba(187, 134, 252, 0.08);
          outline: none;
        }

        .app-launcher-btn svg {
          width: 16px;
          height: 16px;
        }

        .app-launcher-menu {
          display: none;
          position: fixed;
          min-width: 180px;
          background: var(--shell-bg);
          border: 1px solid var(--border);
          border-radius: 8px;
          box-shadow: var(--shadow-lg);
          padding: 4px 0;
          z-index: 200;
        }

        .app-launcher-menu[open] {
          display: block;
        }

        .app-launcher-menu a {
          display: block;
          padding: 0.5rem 0.85rem;
          color: var(--text-main);
          text-decoration: none;
          font-size: 0.82rem;
          transition: background var(--transition-fast), color var(--transition-fast);
        }

        .app-launcher-menu a:hover {
          background: rgba(187, 134, 252, 0.1);
          color: var(--accent);
        }

        .main-body {
          grid-area: main;
          overflow: auto;
          position: relative;
          background: var(--bg-color);
        }

        .panels {
          grid-area: panels;
          width: var(--panel-width);
          min-width: 150px;
          max-width: 600px;
          background: var(--panel-bg);
          backdrop-filter: var(--glass);
          display: flex;
          flex-direction: column;
          box-shadow: -5px 0 20px rgba(0,0,0,0.2);
          z-index: 10;
        }

        .resize-handle {
          grid-area: handle;
          width: 4px;
          cursor: col-resize;
          background: transparent;
          transition: background 0.2s;
          z-index: 20;
          border-left: 1px solid var(--border);
        }

        .resize-handle:hover, .resize-handle.active {
          background: var(--accent);
          box-shadow: 0 0 10px var(--accent);
        }

        .panels.collapsed {
          width: 0;
          min-width: 0;
          overflow: hidden;
          z-index: 10;
        }

        .marquee {
          position: absolute;
          border: 1px solid var(--accent);
          background: rgba(187, 134, 252, 0.1);
          pointer-events: none;
          display: none;
          z-index: 1000;
        }
      </style>
      <div class="app-shell">
        <header class="ribbon">
          <div class="app-launcher">
            <button class="app-launcher-btn" id="app-launcher-btn" aria-expanded="false" aria-label="Applications" title="Applications">
              <svg viewBox="0 0 16 16" fill="currentColor"><rect x="1" y="1" width="4" height="4" rx="0.5"/><rect x="6" y="1" width="4" height="4" rx="0.5"/><rect x="11" y="1" width="4" height="4" rx="0.5"/><rect x="1" y="6" width="4" height="4" rx="0.5"/><rect x="6" y="6" width="4" height="4" rx="0.5"/><rect x="11" y="6" width="4" height="4" rx="0.5"/><rect x="1" y="11" width="4" height="4" rx="0.5"/><rect x="6" y="11" width="4" height="4" rx="0.5"/><rect x="11" y="11" width="4" height="4" rx="0.5"/></svg>
            </button>
            <div class="app-launcher-menu" id="app-launcher-menu">
              <a href="/document-browser/" id="document-browser-link">Document Browser</a>
            </div>
          </div>
          <slot name="ribbon"></slot>
        </header>

        <main class="main-body" id="workspace">
          <slot></slot>
          <div class="marquee" id="marquee"></div>
        </main>

        <div class="resize-handle" id="panels-resizer"></div>

        <aside class="panels" id="side-panels">
          <slot name="panels"></slot>
        </aside>

        <scribus-command-palette></scribus-command-palette>
      </div>
    `;

    this._setupResizing();
    this._setupMarquee();
    this._setupAppLauncher();
  }

  _setupAppLauncher() {
    const btn = this.shadowRoot.getElementById('app-launcher-btn');
    const menu = this.shadowRoot.getElementById('app-launcher-menu');

    const close = () => {
      menu.removeAttribute('open');
      btn.setAttribute('aria-expanded', 'false');
    };

    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const open = menu.hasAttribute('open');
      if (open) {
        close();
      } else {
        // Position the menu below the button using fixed coordinates
        const rect = btn.getBoundingClientRect();
        menu.style.top = `${rect.bottom + 4}px`;
        menu.style.left = `${rect.left}px`;
        menu.setAttribute('open', '');
        btn.setAttribute('aria-expanded', 'true');
      }
    });

    // Close on any click outside the launcher.
    // Use mousedown on window to catch clicks everywhere including
    // slotted content and elements outside the shadow root.
    window.addEventListener('mousedown', (e) => {
      if (!menu.hasAttribute('open')) return;
      // Check if click is inside the launcher via composedPath
      const path = e.composedPath();
      const launcher = this.shadowRoot.querySelector('.app-launcher');
      if (!path.includes(launcher) && !path.includes(btn)) {
        close();
      }
    }, true);

    // Close on Escape
    this.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && menu.hasAttribute('open')) {
        close();
        btn.focus();
      }
    });
  }

  _setupMarquee() {
    const workspace = this.shadowRoot.getElementById('workspace');
    const marquee = this.shadowRoot.getElementById('marquee');
    
    let startX, startY;
    let isDragging = false;

    workspace.addEventListener('mousedown', (e) => {
      // Only trigger if clicking directly on workspace background or un-selectable items
      // Start marquee if clicking on background of workspace
      const isInteraction = e.target.closest('button, input, scribus-button, scribus-input, .selectable');
      if (isInteraction) return;
      
      isDragging = true;
      const rect = workspace.getBoundingClientRect();
      startX = e.clientX - rect.left + workspace.scrollLeft;
      startY = e.clientY - rect.top + workspace.scrollTop;
      
      marquee.style.left = `${startX}px`;
      marquee.style.top = `${startY}px`;
      marquee.style.width = '0';
      marquee.style.height = '0';
      marquee.style.display = 'block';
      this.dispatchEvent(new CustomEvent('marquee-start', { detail: { startX, startY, originalEvent: e } }));
    });

    document.addEventListener('mousemove', (e) => {
      if (!isDragging) return;
      
      const rect = workspace.getBoundingClientRect();
      const currentX = e.clientX - rect.left + workspace.scrollLeft;
      const currentY = e.clientY - rect.top + workspace.scrollTop;
      
      const left = Math.min(startX, currentX);
      const top = Math.min(startY, currentY);
      const width = Math.abs(startX - currentX);
      const height = Math.abs(startY - currentY);
      
      marquee.style.left = `${left}px`;
      marquee.style.top = `${top}px`;
      marquee.style.width = `${width}px`;
      marquee.style.height = `${height}px`;

      this.dispatchEvent(new CustomEvent('marquee-change', {
        detail: { left, top, width, height, originalEvent: e }
      }));
    });

    document.addEventListener('mouseup', (e) => {
      if (!isDragging) return;
      isDragging = false;
      const rect = marquee.getBoundingClientRect();
      marquee.style.display = 'none';
      
      this.dispatchEvent(new CustomEvent('marquee-end', {
        detail: { 
          left: rect.left, 
          top: rect.top, 
          width: rect.width, 
          height: rect.height,
          originalEvent: e 
        }
      }));
    });
  }

  _setupResizing() {
    const resizer = this.shadowRoot.getElementById('panels-resizer');
    const panels = this.shadowRoot.getElementById('side-panels');
    
    // Load persisted width
    const savedWidth = localStorage.getItem('scribus-shell-panel-width');
    if (savedWidth) {
      this.style.setProperty('--panel-width', `${savedWidth}px`);
    }

    let isResizing = false;

    resizer.addEventListener('mousedown', (e) => {
      isResizing = true;
      resizer.classList.add('active');
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
      e.preventDefault();
    });

    document.addEventListener('mousemove', (e) => {
      if (!isResizing) return;

      const width = window.innerWidth - e.clientX;
      if (width >= 150 && width <= 600) {
        this.style.setProperty('--panel-width', `${width}px`);
      }
    });

    document.addEventListener('mouseup', () => {
      if (!isResizing) return;
      isResizing = false;
      resizer.classList.remove('active');
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      
      const currentWidth = parseInt(getComputedStyle(this).getPropertyValue('--panel-width'));
      if (!isNaN(currentWidth)) {
        localStorage.setItem('scribus-shell-panel-width', currentWidth);
      }
    });
  }

  /**
   * Returns the element slotted into 'ribbon'
   */
  get ribbon() {
    return this.shadowRoot.querySelector('slot[name="ribbon"]').assignedElements()[0];
  }

  /**
   * Returns the element slotted into 'panels'
   */
  get panels() {
    return this.shadowRoot.querySelector('slot[name="panels"]').assignedElements()[0];
  }

  /**
   * Returns the main content area (inside shadow DOM)
   */
  get workspace() {
    return this.shadowRoot.querySelector('.main-body');
  }
}

/**
 * ScribusRibbonSection - Building block for the ribbon bar.
 */
export class ScribusRibbonSection extends HTMLElement {
  static get observedAttributes() { return ['label']; }

  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
  }

  attributeChangedCallback(name, old, next) {
    if (name === 'label') this.render();
  }

  connectedCallback() {
    this.render();
  }

  render() {
    const label = this.getAttribute('label') || '';
    this.shadowRoot.innerHTML = `
      <style>
        :host {
          display: flex;
          flex-direction: column;
          justify-content: center;
          border-right: 1px solid var(--border, #2e2e32);
          padding-right: 1.5rem;
          height: 100%;
          flex-shrink: 0;
          white-space: nowrap;
        }
        :host(:last-child) {
          border-right: none;
        }
        .ribbon-label {
          font-size: 0.75rem;
          color: var(--text-dim, #a1a1aa);
          text-transform: uppercase;
          margin-bottom: 4px;
          letter-spacing: 0.05em;
          white-space: nowrap;
        }
        .ribbon-content {
          display: flex;
          gap: 0.5rem;
          align-items: center;
          flex-wrap: nowrap;
        }
      </style>
      <span class="ribbon-label">${label}</span>
      <div class="ribbon-content">
        <slot></slot>
      </div>
    `;
  }
}

if (!customElements.get('scribus-app-shell')) {
  customElements.define('scribus-app-shell', ScribusAppShell);
}

if (!customElements.get('scribus-ribbon-section')) {
  customElements.define('scribus-ribbon-section', ScribusRibbonSection);
}
