import { selection } from '../selection-service.js';
import { activeDocument } from '../document-model.js';

export class ScribusLayersPanel extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this._lastClickedId = null;
    this._onUpdate = this._onUpdate.bind(this);
  }

  connectedCallback() {
    selection.addEventListener('selectionchange', this._onUpdate);
    activeDocument.addEventListener('items-changed', this._onUpdate);
    this.render();
  }

  disconnectedCallback() {
    selection.removeEventListener('selectionchange', this._onUpdate);
    activeDocument.removeEventListener('items-changed', this._onUpdate);
  }

  _onUpdate() {
    this.render();
  }

  _getItemColor(item) {
    if (!item.element) return null;
    if (item.type === 'triangle') return item.element.style.borderBottomColor;
    return item.element.style.background || item.element.style.backgroundColor || null;
  }

  _getItemIconSvg(type) {
    const svgStyles = 'width: 14px; height: 14px; flex-shrink: 0; fill: currentColor;';
    switch (type) {
      case 'text-frame':
      case 'text':
      case 'Story':
        return `<svg style="${svgStyles}" viewBox="0 0 24 24">
          <path d="M4 19h16v2H4zm0-4h16v-2H4zm0-4h16V9H4zm0-4h16V3H4z"/>
        </svg>`;
      case 'image-frame':
        return `<svg style="${svgStyles}" viewBox="0 0 24 24">
          <path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 16H5V5h14v14zm-5.04-6.71l-2.75 3.54-1.96-2.36L6.5 17h11l-3.54-4.71z"/>
        </svg>`;
      case 'rect':
        return `<svg style="${svgStyles}" viewBox="0 0 24 24">
          <path d="M3 3v18h18V3H3zm16 16H5V5h14v14z"/>
        </svg>`;
      case 'ellipse':
        return `<svg style="${svgStyles}" viewBox="0 0 24 24">
          <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8z"/>
        </svg>`;
      case 'triangle':
        return `<svg style="${svgStyles}" viewBox="0 0 24 24">
          <path d="M12 6L5.3 18h13.4L12 6zm0-4L2 20h20L12 2z"/>
        </svg>`;
      default:
        return `<svg style="${svgStyles}" viewBox="0 0 24 24">
          <path d="M11.99 18.54l-7.37-5.73L3 14.07l9 7 9-7-1.63-1.27-7.38 5.74zM12 16l7.36-5.73L21 9l-9-7-9 7 1.63 1.27L12 16z"/>
        </svg>`;
    }
  }

  _getTypeTag(type) {
    switch (type) {
      case 'text-frame':
      case 'text':
        return { text: 'TXT', class: 'tag-txt' };
      case 'Story':
        return { text: 'STORY', class: 'tag-story' };
      case 'image-frame':
        return { text: 'IMG', class: 'tag-img' };
      case 'rect':
        return { text: 'RECT', class: 'tag-shape' };
      case 'ellipse':
        return { text: 'CIRC', class: 'tag-shape' };
      case 'triangle':
        return { text: 'TRI', class: 'tag-shape' };
      default:
        return { text: 'OBJ', class: 'tag-other' };
    }
  }

  render() {
    const items = activeDocument.getAll();
    if (items.length === 0) {
      this.shadowRoot.innerHTML = `
        <style>
          .panel-empty {
            color: #8e8e93;
            font-size: 0.82rem;
            padding: 0.5rem 0;
            display: block;
          }
        </style>
        <span class="panel-empty">No objects in document.</span>
      `;
      return;
    }

    this.shadowRoot.innerHTML = '';

    // Style element
    const style = document.createElement('style');
    style.textContent = `
      .layers-list {
        display: flex;
        flex-direction: column;
        gap: 8px;
        padding: 0.5rem 0;
        margin: 0;
      }

      .layer-item {
        display: flex;
        align-items: center;
        gap: 0.8rem;
        padding: 0.6rem 0.8rem;
        border-radius: 8px;
        cursor: pointer;
        background: rgba(255, 255, 255, 0.02);
        border: 1px solid rgba(255, 255, 255, 0.03);
        transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
        position: relative;
        overflow: hidden;
      }

      .layer-item:hover {
        background: rgba(255, 255, 255, 0.06);
        border-color: rgba(255, 255, 255, 0.08);
        transform: translateX(4px);
      }

      .layer-item.selected {
        background: rgba(255, 255, 255, 0.08);
        border-color: rgba(255, 255, 255, 0.15);
      }

      .layer-item.primary-selected {
        background: rgba(187, 134, 252, 0.12);
        border-color: rgba(187, 134, 252, 0.4);
        color: #bb86fc;
      }

      .layer-item.primary-selected::before {
        content: '';
        position: absolute;
        left: 0;
        top: 0;
        bottom: 0;
        width: 4px;
        background: #bb86fc;
        box-shadow: 0 0 8px #bb86fc;
      }

      .layer-icon-wrapper {
        display: flex;
        align-items: center;
        justify-content: center;
        width: 28px;
        height: 28px;
        flex-shrink: 0;
        border-radius: 6px;
        background: rgba(0, 0, 0, 0.2);
        border: 1px solid rgba(255, 255, 255, 0.05);
        transition: all 0.2s ease;
      }

      .layer-item:hover .layer-icon-wrapper {
        transform: scale(1.1);
        background: rgba(0, 0, 0, 0.3);
      }

      .layer-info {
        display: flex;
        flex-direction: column;
        flex-grow: 1;
        min-width: 0;
      }

      .layer-title {
        font-size: 0.8rem;
        font-weight: 500;
        color: #e1e1e6;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        margin-bottom: 2px;
      }

      .layer-item.primary-selected .layer-title {
        color: #bb86fc;
      }

      .layer-subtitle {
        font-size: 0.68rem;
        color: #8e8e93;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      .layer-tag {
        font-size: 0.62rem;
        font-weight: 700;
        padding: 2px 6px;
        border-radius: 4px;
        text-transform: uppercase;
        letter-spacing: 0.5px;
        flex-shrink: 0;
        border: 1px solid transparent;
      }

      .tag-txt {
        background: rgba(64, 169, 255, 0.1);
        color: #40a9ff;
        border-color: rgba(64, 169, 255, 0.2);
      }

      .tag-story {
        background: rgba(114, 46, 209, 0.1);
        color: #9254de;
        border-color: rgba(114, 46, 209, 0.2);
      }

      .tag-img {
        background: rgba(115, 209, 61, 0.1);
        color: #73d13d;
        border-color: rgba(115, 209, 61, 0.2);
      }

      .tag-shape {
        background: rgba(255, 197, 61, 0.1);
        color: #ffc53d;
        border-color: rgba(255, 197, 61, 0.2);
      }

      .tag-other {
        background: rgba(255, 255, 255, 0.08);
        color: #8e8e93;
        border-color: rgba(255, 255, 255, 0.15);
      }
    `;
    this.shadowRoot.appendChild(style);

    const list = document.createElement('div');
    list.className = 'layers-list';

    const selectedItems = selection.all;
    const currentItem = selection.current;

    for (const item of items) {
      const li = document.createElement('div');
      let className = 'layer-item';
      if (selectedItems.includes(item)) {
        className += ' selected';
      }
      if (item === currentItem) {
        className += ' primary-selected';
      }
      li.className = className;
      li.dataset.itemId = item.id;

      // Icon Wrapper (colored with the object color)
      const iconWrapper = document.createElement('span');
      iconWrapper.className = 'layer-icon-wrapper';
      iconWrapper.innerHTML = this._getItemIconSvg(item.type);
      const color = this._getItemColor(item);
      iconWrapper.style.color = color || '#8e8e93';
      li.appendChild(iconWrapper);

      // Info container
      const info = document.createElement('div');
      info.className = 'layer-info';

      const title = document.createElement('span');
      title.className = 'layer-title';
      title.textContent = item.label || (item.type === 'Story' ? 'Global Story' : item.id);
      info.appendChild(title);

      const subtitle = document.createElement('span');
      subtitle.className = 'layer-subtitle';
      
      let details = '';
      if (item.type === 'text-frame' || item.type === 'text' || item.type === 'Story') {
        details = item.data?.text || item.element?.textContent?.trim() || 'Empty Text';
        if (details.length > 25) details = details.slice(0, 22) + '...';
      } else if (item.type === 'image-frame') {
        details = item.data?.src || 'No Image Loaded';
        if (details.includes('/')) details = details.split('/').pop();
        if (details.length > 25) details = details.slice(0, 22) + '...';
      } else {
        // Shapes
        const left = item.element ? (parseInt(item.element.style.left) || item.element.offsetLeft) : (item.data?.x || 0);
        const top = item.element ? (parseInt(item.element.style.top) || item.element.offsetTop) : (item.data?.y || 0);
        details = `Pos: (${left}px, ${top}px)`;
      }
      subtitle.textContent = details;
      info.appendChild(subtitle);
      li.appendChild(info);

      // Pill Tag
      const tagInfo = this._getTypeTag(item.type);
      const tag = document.createElement('span');
      tag.className = `layer-tag ${tagInfo.class}`;
      tag.textContent = tagInfo.text;
      li.appendChild(tag);

      // Click / Selection behavior
      li.addEventListener('click', (e) => {
        const allItems = activeDocument.getAll();
        const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
        const isToggle = isMac ? e.metaKey : e.ctrlKey;

        if (e.shiftKey) {
          let idxA = allItems.findIndex(i => i.id === this._lastClickedId);
          if (idxA === -1) idxA = 0;
          const idxB = allItems.indexOf(item);
          const min = Math.min(idxA, idxB);
          const max = Math.max(idxA, idxB);
          const range = allItems.slice(min, max + 1);
          selection.selectMany(range);
        } else if (isToggle) {
          selection.toggle(item);
          this._lastClickedId = item.id;
        } else {
          selection.select(item);
          this._lastClickedId = item.id;
        }
      });

      list.appendChild(li);
    }

    this.shadowRoot.appendChild(list);
  }
}

if (!customElements.get('scribus-layers-panel')) {
  customElements.define('scribus-layers-panel', ScribusLayersPanel);
}
