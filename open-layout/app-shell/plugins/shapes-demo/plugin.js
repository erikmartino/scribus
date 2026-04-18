import { selection } from '../../lib/selection-service.js';
import { AppShell } from '../../lib/shell-core.js';
import { AbstractItem, activeDocument } from '../../lib/document-model.js';

export class ShapesDemoPlugin {
  init(shell) {
    this.shell = shell;

    // Wrap initial DOM shapes into AbstractItems
    document.querySelectorAll('.selectable').forEach(el => {
      el.tabIndex = 0;
      this._registerShape(el);
    });

    // Listen for paste on the shell event target
    shell.addEventListener('paste-received', (e) => this._handlePaste(e));
    
    // Listen for marquee selection
    shell.addEventListener('marquee-end', (e) => this._handleMarquee(e));

    // Listen for the shell-level delete command
    shell.addEventListener('delete-requested', () => {
      const items = selection.all.slice();
      if (items.length > 0) {
        this.shell.history.submit({
          label: 'Delete Shapes',
          execute: () => {
            items.forEach(item => {
              item.element.remove();
              activeDocument.removeItem(item.id);
            });
            selection.clear();
          },
          undo: () => {
            items.forEach(item => {
              const data = item.serialize();
              data.isUndo = true;
              this._createShapeFromData(data);
            });
          }
        });
      }
    });

    shell.commands.register({
      id: 'shape.randomColor',
      label: 'Change Color',
      execute: () => {
        const items = selection.all.slice();
        if (items.length === 0) return;
        
        const newColor = '#' + Math.floor(Math.random()*16777215).toString(16);
        const oldColors = items.map(item => item.type === 'triangle' ? item.element.style.borderBottomColor : item.element.style.background);

        this.shell.history.submit({
          label: 'Change Color',
          execute: () => {
            items.forEach(item => {
              if (item.type === 'triangle') item.element.style.borderBottomColor = newColor;
              else item.element.style.background = newColor;
            });
          },
          undo: () => {
            items.forEach((item, i) => {
              if (item.type === 'triangle') item.element.style.borderBottomColor = oldColors[i];
              else item.element.style.background = oldColors[i];
            });
          }
        });
      },
      isEnabled: () => selection.all.length > 0
    });

    shell.commands.register({
      id: 'view.reset',
      label: 'Reset View',
      execute: () => {
        const container = document.getElementById('selectable-shapes');
        if (container) {
          container.style.transform = 'scale(1)';
          container.style.opacity = '1';
        }
      }
    });

    // Register creatable shape types
    shell.registerCreatable({
      id: 'shape.circle',
      label: 'Circle',
      icon: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"></circle></svg>`,
      onCreate: () => this._createNewShape('circle')
    });

    shell.registerCreatable({
      id: 'shape.square',
      label: 'Square',
      icon: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="4" y="4" width="16" height="16" rx="2"></rect></svg>`,
      onCreate: () => this._createNewShape('square')
    });

    shell.registerCreatable({
      id: 'shape.triangle',
      label: 'Triangle',
      icon: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="12,3 22,21 2,21"></polygon></svg>`,
      onCreate: () => this._createNewShape('triangle')
    });

    // Register generic copy/paste if not handled by system shortcuts
    shell.commands.register({
      id: 'shape.duplicate',
      label: 'Duplicate',
      execute: () => {
        this.shell.clipboard.copy();
        this.shell.clipboard.paste();
      },
      isEnabled: () => !!selection.current
    });
  }

  _createNewShape(type) {
    const id = type + '-' + Math.random().toString(36).substr(2, 9);
    const defaults = {
      circle: { color: '#ff4081', text: 'Circle' },
      square: { color: '#3f51b5', text: 'Square' },
      triangle: { color: '#4caf50', text: '' }
    };
    const def = defaults[type] || { color: '#888', text: type };
    const data = {
      id,
      type,
      color: def.color,
      text: def.text,
      left: 60 + Math.round(Math.random() * 120),
      top: 60 + Math.round(Math.random() * 80),
      isUndo: true
    };

    this.shell.history.submit({
      label: `Create ${type}`,
      execute: () => {
        selection.clear();
        this._createShapeFromData(data);
      },
      undo: () => {
        const item = activeDocument.get(data.id);
        if (item) {
          if (item.element) item.element.remove();
          activeDocument.removeItem(data.id);
        }
        selection.clear();
      }
    });
  }

  _registerShape(el) {
    const item = new AbstractItem(el.dataset.id, el.dataset.type);
    item.element = el;
    
    // Override serialize to capture live style/content
    item.serialize = () => ({
      id: item.id,
      type: item.type,
      color: item.type === 'triangle' ? el.style.borderBottomColor : el.style.background,
      text: el.textContent.trim(),
      left: parseInt(el.style.left) || el.offsetLeft,
      top: parseInt(el.style.top) || el.offsetTop
    });

    activeDocument.registerItem(item);
    
    // Wire up standard click selection
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      if (e.shiftKey) {
        selection.toggle(item);
      } else {
        selection.select(item);
      }
      el.focus();
    });

    // Drag-move logic
    let isMoving = false;
    let startX, startY;
    let initialX, initialY;

    el.addEventListener('mousedown', (e) => {
      if (!el.classList.contains('selected')) return;
      isMoving = true;
      startX = e.clientX;
      startY = e.clientY;
      initialX = parseInt(el.style.left) || el.offsetLeft;
      initialY = parseInt(el.style.top) || el.offsetTop;
      
      const onMouseMove = (moveEvent) => {
        if (!isMoving) return;
        const dx = moveEvent.clientX - startX;
        const dy = moveEvent.clientY - startY;
        el.style.left = `${initialX + dx}px`;
        el.style.top = `${initialY + dy}px`;
        el.style.zIndex = '1000';
      };

      const onMouseUp = (upEvent) => {
        if (!isMoving) return;
        isMoving = false;
        el.style.zIndex = '';
        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mouseup', onMouseUp);

        // Submit to history if it moved significantly
        const finalX = parseInt(el.style.left);
        const finalY = parseInt(el.style.top);
        if (Math.abs(finalX - initialX) > 2 || Math.abs(finalY - initialY) > 2) {
          this.shell.history.submit({
            label: 'Move Shape',
            execute: () => {
              el.style.left = `${finalX}px`;
              el.style.top = `${finalY}px`;
            },
            undo: () => {
              el.style.left = `${initialX}px`;
              el.style.top = `${initialY}px`;
            }
          });
        }
      };

      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup', onMouseUp);
    });

    return item;
  }

  _handlePaste(event) {
    const payload = event.detail;
    const compatibleItems = payload.items.filter(data => 
      data.type === 'circle' || data.type === 'square' || data.type === 'triangle'
    );
    
    if (compatibleItems.length === 0) return;

    // Prepare exactly what will be created, including pre-calculated positions and stable IDs
    const itemsToCreate = compatibleItems.map(data => {
      const id = data.id || ('pasted-' + Math.random().toString(36).substr(2, 9));
      // Apply the paste offset only once here
      const offset = (data.isUndo || data.id) ? 0 : 10;
      return {
        ...data,
        id,
        left: (data.left || 0) + offset,
        top: (data.top || 0) + offset,
        isUndo: true // Disable further offsetting in _createShapeFromData
      };
    });

    this.shell.history.submit({
      label: `Paste ${itemsToCreate.length} Shape${itemsToCreate.length > 1 ? 's' : ''}`,
      execute: () => {
        selection.clear();
        itemsToCreate.forEach(data => {
          this._createShapeFromData(data);
        });
      },
      undo: () => {
        itemsToCreate.forEach(data => {
          const item = activeDocument.get(data.id);
          if (item) {
            if (item.element) item.element.remove();
            activeDocument.removeItem(data.id);
          }
        });
        selection.clear();
      }
    });
  }

  _createShapeFromData(data) {
    const container = document.getElementById('selectable-shapes');
    if (!container) return null;

    const el = document.createElement('div');
    el.className = `selectable ${data.type}`;
    el.dataset.type = data.type;
    el.dataset.id = data.id || ('pasted-' + Math.random().toString(36).substr(2, 9));
    el.tabIndex = 0; // Make focusable for native clipboard events
    
    if (data.type === 'triangle') {
      el.style.borderBottomColor = data.color || '#4caf50';
    } else {
      el.style.background = data.color || '#3f51b5';
    }
    
    el.textContent = data.text || '';
    
    // Position with offset if it's a first-time paste (not undo/redo)
    const offset = data.isUndo ? 0 : 10;
    el.style.left = `${(data.left || 0) + offset}px`;
    el.style.top = `${(data.top || 0) + offset}px`;
    el.style.position = 'absolute';
    
    container.appendChild(el);
    
    const item = this._registerShape(el);
    selection.add(item);
    return item;
  }

  _handleMarquee(event) {
    const { left, top, width, height } = event.detail;
    const selectionService = this.shell.selection;
    
    // Standard marquee logic: clear previous and add intersecting
    selectionService.clear();

    const items = activeDocument.getAll().filter(item => item.id !== 'root');
    
    items.forEach(item => {
      const el = document.getElementById(item.id) || (item.element);
      if (!el) return;
      
      const rect = el.getBoundingClientRect();
      
      // Standard AABB intersection: at least partially inside the marquee
      const intersects = (
        rect.left < left + width &&
        rect.right > left &&
        rect.top < top + height &&
        rect.bottom > top
      );

      if (intersects) {
        selectionService.add(item);
      }
    });
  }

  getRibbonSections(selected) {
    const sections = [];
    
    // Always show generic tools
    sections.push(AppShell.createRibbonSection('Workspace', (container) => {
      container.appendChild(this.shell.ui.createButton({
        commandId: 'view.reset'
      }));
    }));

    // Selection-specific tools
    if (selected) {
      sections.push(AppShell.createRibbonSection(`${selected.type.toUpperCase()} TOOLS`, (container) => {
        container.appendChild(this.shell.ui.createButton({
          commandId: 'shape.randomColor'
        }));
      }));
    }

    return sections;
  }

  getPanelContent(selected) {
    if (!selected) return null;
    const container = document.createElement('div');
    container.style.display = 'flex';
    container.style.flexDirection = 'column';
    container.style.gap = '15px';

    const info = document.createElement('p');
    info.style.color = 'var(--text-dim)';
    info.style.fontSize = '0.8rem';
    info.textContent = `ID: ${selected.id}`;
    container.appendChild(info);

    container.appendChild(this.shell.ui.createInput({
      label: 'Title',
      value: selected.element.textContent.trim() || selected.type,
      onInput: (val) => {
        if (selected.type !== 'triangle') {
          selected.element.textContent = val;
        }
      }
    }));

    return container;
  }
}
