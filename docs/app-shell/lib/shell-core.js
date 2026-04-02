import { selection } from './selection-service.js';
import { ClipboardService } from './clipboard-service.js';
import { activeDocument } from './document-model.js';
import { CommandRegistry, CommandHistory } from './command-manager.js';
import './components/ui-elements.js';
import './components/command-palette.js';


export class AppShell extends EventTarget {
  constructor() {
    super();
    this.plugins = [];
    this._updateQueued = false;
    this.commands = new CommandRegistry(this);
    this.history = new CommandHistory();
    this.clipboard = new ClipboardService(this);
    this.selection = selection;
    this.doc = activeDocument;
    
    // Find the shell custom element
    this.element = document.querySelector('scribus-app-shell');
    this._initialized = false;
    
    // Wait until the window is fully loaded to avoid layout flashes and unstyled content.
    if (document.readyState === 'complete') {
      this._initFromElement();
    } else {
      window.addEventListener('load', () => this._initFromElement());
    }

    // Declarative UI Helpers
    this.ui = new UIHelper(this);

    this._setupGlobalEvents();
  }

  _initFromElement() {
    if (!this.element) {
      console.warn('ScribusAppShell element not found in DOM.');
      return;
    }

    // Move logic from hardcoded IDs to element-relative lookups
    this.ribbonContainer = this.element.ribbon;
    this.panelsContainer = this.element.panels;
    
    // Check if we have specific sub-elements for properties
    if (this.panelsContainer) {
      this.panelContent = this.panelsContainer.querySelector('#properties-view') || this.panelsContainer;
      this.panelTitle = this.panelsContainer.querySelector('#panel-title');
    }

    this.mainBody = this.element.workspace;
    
    // Forward component events to the shell instance
    this.element.addEventListener('marquee-start', (e) => this.dispatchEvent(new CustomEvent('marquee-start', { detail: e.detail })));
    this.element.addEventListener('marquee-change', (e) => this.dispatchEvent(new CustomEvent('marquee-change', { detail: e.detail })));
    this.element.addEventListener('marquee-end', (e) => this.dispatchEvent(new CustomEvent('marquee-end', { detail: e.detail })));
    
    this._initialized = true;

    // Trigger an update if we have a selection already (rare at init)
    this.updateRibbon(selection.current);
    this.updatePanels(selection.current);
  }
  registerPlugin(plugin) {
    this.plugins.push(plugin);
    if (plugin.init) {
      plugin.init(this);
    }
    
    // Ensure plugin content is visible immediately (debounced)
    if (this._initialized) {
      this.requestUpdate();
    }
  }

  requestUpdate() {
    if (this._updateQueued) return;
    this._updateQueued = true;
    
    requestAnimationFrame(() => {
      const selected = selection.current || null;
      this.updateRibbon(selected);
      this.updatePanels(selected);
      this._updateQueued = false;
    });
  }

  _setupKeyboardShortcuts() {
    window.addEventListener('keydown', (e) => {
      const isMod = e.ctrlKey || e.metaKey;
      
      if (isMod && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) this.commands.execute('app.redo');
        else this.commands.execute('app.undo');
      }

      if (isMod && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        this.commands.execute('app.redo');
      }

      if (isMod && e.key.toLowerCase() === 'c') {
        // Only trigger rich copy if not in an input
        if (!['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName)) {
          this.clipboard.copy();
        }
      }

      if (isMod && e.key.toLowerCase() === 'v') {
        // Only trigger rich paste if not in an input
        if (!['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName)) {
           this.clipboard.paste();
        }
      }
    });
  }

  _setupGlobalEvents() {
    this._setupKeyboardShortcuts();
    // Selection-based updates
    selection.addEventListener('selectionchange', (e) => {
      this.requestUpdate();

      // Manage visual selection indicators
      const detail = e.detail;
      document.querySelectorAll('.selectable.selected').forEach(el => el.classList.remove('selected'));
      detail.all.forEach(item => {
         if (item.element) item.element.classList.add('selected');
      });
    });

    // Handle initial selection (none)
    this.requestUpdate();

    // Workspace-wide selection listener (global clear)
    document.addEventListener('click', (e) => {
      // Clear selection if clicking background
      if (e.target.closest('#main-content') && !e.target.closest('.selectable')) {
        selection.clear();
      }
    });
  }

  updateRibbon(selected) {
    if (!this._initialized || !this.ribbonContainer) return;
    
    const fragment = document.createDocumentFragment();

    // Ask all plugins for their sections
    this.plugins.forEach(plugin => {
      if (typeof plugin.getRibbonSections === 'function') {
        const sections = plugin.getRibbonSections(selected);
        if (sections) {
          sections.forEach(section => fragment.appendChild(section));
        }
      }
    });

    // Surgical update: Only clear and replace if content has changed 
    // (though for now, simple clear + fragment is much smoother than multiple updates)
    this.ribbonContainer.innerHTML = '';
    this.ribbonContainer.appendChild(fragment);
  }

  updatePanels(selected) {
    if (!this._initialized || !this.panelContent) return;
    
    this.panelContent.innerHTML = '';
    this.panelTitle.textContent = selected ? `Properties: ${selected.type}` : 'Properties';
    
    this.plugins.forEach(plugin => {
      if (typeof plugin.getPanelContent === 'function') {
        const panel = plugin.getPanelContent(selected);
        if (panel) {
          this.panelContent.appendChild(panel);
        }
      }
    });

    if (this.panelContent.innerHTML === '') {
      this.panelContent.innerHTML = '<span style="color: var(--text-dim)">Select an object to inspect.</span>';
    }
  }

  // Helper factory for building ribbon elements
  static createRibbonSection(label, contentBuilder) {
    const section = document.createElement('scribus-ribbon-section');
    section.setAttribute('label', label);
    contentBuilder(section); // Slots directly into the ribbon-content of the component
    return section;
  }

  toggleFullscreen() {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen();
    } else if (document.exitFullscreen) {
      document.exitFullscreen();
    }
  }
}

/**
 * System Plugin - Demonstration of a plugin that provides global application controls.
 */
class SystemPlugin {
  init(shell) {
    this.shell = shell;
    
    // Register Global System Commands
    shell.commands.register({
      id: 'app.fullscreen',
      label: 'Fullscreen',
      icon: '⛶',
      execute: () => shell.toggleFullscreen(),
      shortcut: 'F11'
    });

    shell.commands.register({
      id: 'app.help',
      label: 'Help',
      icon: '?',
      execute: () => alert('Scribus App Shell - Plugin based desktop-UI.')
    });

    shell.commands.register({
      id: 'app.undo',
      label: 'Undo',
      icon: `
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M11 17l-5-5 5-5"></path>
          <path d="M18 17a5 5 0 0 0-5-5H6"></path>
        </svg>`,
      execute: () => shell.history.undo(),
      isEnabled: () => shell.history.canUndo(),
      shortcut: 'Ctrl+Z'
    });

    shell.commands.register({
      id: 'app.redo',
      label: 'Redo',
      icon: `
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M13 17l5-5-5-5"></path>
          <path d="M6 17a5 5 0 0 1 5-5h7"></path>
        </svg>`,
      execute: () => shell.history.redo(),
      isEnabled: () => shell.history.canRedo(),
      shortcut: 'Ctrl+Y'
    });

    shell.commands.register({
      id: 'app.cut',
      label: 'Cut',
      icon: `
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="6" cy="6" r="3"></circle>
          <circle cx="6" cy="18" r="3"></circle>
          <line x1="20" y1="4" x2="8.12" y2="15.88"></line>
          <line x1="14.47" y1="14.48" x2="20" y2="20"></line>
          <line x1="8.12" y1="8.12" x2="12" y2="12"></line>
        </svg>`,
      execute: () => shell.clipboard.cut(),
      shortcut: 'Ctrl+X'
    });

    shell.commands.register({
      id: 'app.copy',
      label: 'Copy',
      icon: `
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
          <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
        </svg>`,
      execute: () => shell.clipboard.copy(),
      shortcut: 'Ctrl+C'
    });

    shell.commands.register({
      id: 'app.paste',
      label: 'Paste',
      icon: `
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"></path>
          <rect x="8" y="2" width="8" height="4" rx="1" ry="1"></rect>
        </svg>`,
      execute: () => shell.clipboard.paste(),
      shortcut: 'Ctrl+V'
    });
  }

  getRibbonSections(selected) {
    return [
      AppShell.createRibbonSection('Application', (container) => {
        container.appendChild(this.shell.ui.createButton({
          commandId: 'app.undo',
          iconOnly: true
        }));
        container.appendChild(this.shell.ui.createButton({
          commandId: 'app.redo',
          iconOnly: true
        }));
        container.appendChild(this.shell.ui.createButton({
          commandId: 'app.fullscreen',
          iconOnly: true
        }));
        container.appendChild(this.shell.ui.createButton({
          commandId: 'app.help',
          iconOnly: true
        }));
      }),
      AppShell.createRibbonSection('Edit', (container) => {
        container.appendChild(this.shell.ui.createButton({
          commandId: 'app.cut',
          iconOnly: true
        }));
        container.appendChild(this.shell.ui.createButton({
          commandId: 'app.copy',
          iconOnly: true
        }));
        container.appendChild(this.shell.ui.createButton({
          commandId: 'app.paste',
          iconOnly: true
        }));
      })
    ];
  }
}

/**
 * UIHelper - Provides a declarative API for creating consistently styled shell components.
 */
class UIHelper {
  constructor(shell) {
    this.shell = shell;
  }

  /**
   * Creates a button. Can be linked to a command.
   * @param {Object} options - { label, icon, primary, onClick, commandId, iconOnly }
   */
  createButton({ label, icon, primary, onClick, commandId, iconOnly }) {
    const btn = document.createElement('scribus-button');
    
    let actualLabel = label;
    let actualIcon = icon;
    let actualClick = onClick;

    // If a command is provided, use its properties if not overridden
    if (commandId) {
      const cmd = this.shell.commands.get(commandId);
      if (cmd) {
        if (!actualLabel) actualLabel = cmd.label;
        if (!actualIcon) actualIcon = cmd.icon;
        if (!actualClick) {
          actualClick = () => this.shell.commands.execute(commandId);
        }
      } else {
        console.warn(`UIHelper: Command ID "${commandId}" not found for button.`);
      }
    }

    btn.setAttribute('label', actualLabel || '');
    if (actualIcon) btn.setAttribute('icon', actualIcon);
    if (primary) btn.setAttribute('primary', '');
    if (iconOnly) btn.setAttribute('icon-only', '');
    if (actualClick) btn.onclick = actualClick;
    
    return btn;
  }

  createInput({ label, value, onInput, placeholder, type, min, max }) {
    const input = document.createElement('scribus-input');
    if (label) input.setAttribute('label', label);
    if (value) input.setAttribute('value', value);
    if (placeholder) input.setAttribute('placeholder', placeholder);
    if (type) input.setAttribute('type', type);
    if (min) input.setAttribute('min', min);
    if (max) input.setAttribute('max', max);
    
    if (onInput) {
      input.addEventListener('change', (e) => onInput(e.detail, e));
    }
    return input;
  }
}

// Global Shell Initialization
const shell = new AppShell();

// Register on window for components to access (Command Palette, etc)
window.scribusShell = shell;

// Register System Plugin
shell.registerPlugin(new SystemPlugin());

// Export as ESM for use by external demos
export default shell;
