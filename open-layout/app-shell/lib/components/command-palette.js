/**
 * ScribusCommandRegistry - Small search overlay for executing actions.
 */
export class ScribusCommandPalette extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this.isOpen = false;
    this.commands = [];
    this._onKeyDown = this._onKeyDown.bind(this);
  }

  connectedCallback() {
    this.render();
    document.addEventListener('keydown', this._onKeyDown);
  }

  disconnectedCallback() {
    document.removeEventListener('keydown', this._onKeyDown);
  }

  _onKeyDown(e) {
    if ((e.ctrlKey || e.metaKey) && e.key === 'p') {
      e.preventDefault();
      this.toggle();
    } else if (e.key === 'Escape' && this.isOpen) {
      this.close();
    }
  }

  toggle() {
    this.isOpen ? this.close() : this.open();
  }

  open() {
    this.isOpen = true;
    this.render();
    setTimeout(() => {
      this.shadowRoot.querySelector('input')?.focus();
    }, 10);
    
    // Refresh commands from the shell
    if (window.scribusShell) {
      this.commands = window.scribusShell.commands.getAll();
      this._filterCommands('');
    }
  }

  close() {
    this.isOpen = false;
    this.render();
  }

  _filterCommands(query) {
    const list = this.shadowRoot.getElementById('command-list');
    if (!list) return;

    list.innerHTML = '';
    const filtered = this.commands.filter(c => 
      c.label.toLowerCase().includes(query.toLowerCase()) || 
      c.id.toLowerCase().includes(query.toLowerCase())
    );

    filtered.forEach((cmd, index) => {
      const item = document.createElement('div');
      item.className = 'command-item';
      item.innerHTML = `
        <span class="icon">${cmd.icon || ''}</span>
        <span class="label">${cmd.label}</span>
        <span class="shortcut">${cmd.shortcut || ''}</span>
      `;
      item.onclick = () => {
        window.scribusShell.commands.execute(cmd.id);
        this.close();
      };
      list.appendChild(item);
    });

    if (filtered.length === 0) {
      list.innerHTML = '<div class="no-results">No commands found.</div>';
    }
  }

  render() {
    if (!this.isOpen) {
      this.shadowRoot.innerHTML = '';
      return;
    }

    this.shadowRoot.innerHTML = `
      <style>
        :host {
          position: fixed;
          top: 0;
          left: 0;
          width: 100vw;
          height: 100vh;
          background: rgba(0,0,0,0.6);
          backdrop-filter: blur(8px);
          display: flex;
          justify-content: center;
          align-items: flex-start;
          padding-top: 10vh;
          z-index: 9999;
          font-family: 'Inter', system-ui, sans-serif;
        }

        .palette {
          background: #1e1e20;
          width: 600px;
          max-width: 90vw;
          border-radius: 12px;
          border: 1px solid #2e2e32;
          box-shadow: 0 20px 50px rgba(0,0,0,0.5);
          overflow: hidden;
          animation: slideDown 0.2s cubic-bezier(0.4, 0, 0.2, 1);
        }

        @keyframes slideDown {
          from { transform: translateY(-20px); opacity: 0; }
          to { transform: translateY(0); opacity: 1; }
        }

        .search-area {
          padding: 16px;
          border-bottom: 1px solid #2e2e32;
        }

        input {
          width: 100%;
          background: transparent;
          border: none;
          color: #e1e1e6;
          font-size: 1.1rem;
          outline: none;
          padding: 4px 8px;
        }

        .command-list {
          max-height: 400px;
          overflow-y: auto;
          padding: 8px;
        }

        .command-item {
          padding: 12px 16px;
          border-radius: 8px;
          display: flex;
          align-items: center;
          gap: 12px;
          cursor: pointer;
          transition: background 0.1s;
          color: #a1a1aa;
        }

        .command-item:hover {
          background: rgba(255, 255, 255, 0.05);
          color: #e1e1e6;
        }

        .command-item .label {
          flex: 1;
        }

        .command-item .shortcut {
          font-size: 0.75rem;
          color: #666;
          background: rgba(0,0,0,0.2);
          padding: 2px 6px;
          border-radius: 4px;
        }

        .icon {
          display: flex;
          align-items: center;
          justify-content: center;
          width: 20px;
          opacity: 0.7;
        }

        .no-results {
          padding: 32px;
          text-align: center;
          color: #666;
        }
      </style>
      <div class="palette">
        <div class="search-area">
          <input type="text" placeholder="Type a command..." id="search-input">
        </div>
        <div class="command-list" id="command-list"></div>
      </div>
    `;

    const input = this.shadowRoot.getElementById('search-input');
    input?.addEventListener('input', (e) => this._filterCommands(e.target.value));
    
    // Close on backdrop click
    this.onclick = (e) => {
      if (e.target === this) this.close();
    };
  }
}

if (!customElements.get('scribus-command-palette')) {
  customElements.define('scribus-command-palette', ScribusCommandPalette);
}
