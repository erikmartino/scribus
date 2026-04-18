import shell from '../../app-shell/lib/shell-core.js';
import {
  loadDocument,
  loadParagraphStyles,
  loadCharacterStyles,
} from '../lib/document-store.js';

class DocumentInspectorPlugin {
  init(shellInstance) {
    this.shell = shellInstance;
    this._workspace = document.getElementById('workspace');
    this._status = document.getElementById('status');

    const params = new URLSearchParams(location.search);
    this._docPath = params.get('doc') || null;

    if (!this._docPath) {
      this._renderNoDoc();
      this._setStatus('No document specified', '');
      return;
    }

    this._load();
  }

  async _load() {
    try {
      this._setStatus(`Loading ${this._docPath}...`, '');

      // Fetch document metadata + file listing, paragraph styles, and
      // character styles in parallel.
      const [docResult, paraStyles, charStyles] = await Promise.all([
        loadDocument(this._docPath),
        loadParagraphStyles(this._docPath),
        loadCharacterStyles(this._docPath),
      ]);

      const { meta, files } = docResult;

      // Derive spreads, stories, styles, and assets from the file listing.
      const spreads = files.filter(f => f.startsWith('spreads/') && f.endsWith('.json'));
      const stories = files.filter(f => f.startsWith('stories/') && f.endsWith('.json'));
      const paraStyleFiles = files.filter(f => f.startsWith('styles/paragraph/') && f.endsWith('.json'));
      const charStyleFiles = files.filter(f => f.startsWith('styles/character/') && f.endsWith('.json'));
      const assetFiles = files.filter(f => f.startsWith('assets/'));

      // Group asset files by folder (assets/{name}/...)
      const assetFolders = new Map();
      for (const f of assetFiles) {
        const parts = f.replace('assets/', '').split('/');
        const folder = parts[0];
        if (!assetFolders.has(folder)) assetFolders.set(folder, []);
        assetFolders.get(folder).push(parts.slice(1).join('/'));
      }

      // Fetch spread JSON for each spread file (in parallel)
      const spreadData = await Promise.all(
        spreads.map(async (f) => {
          const res = await fetch(`/store/${this._docPath}/${f}`);
          if (!res.ok) return { file: f, data: null };
          return { file: f, data: await res.json() };
        })
      );

      // Fetch story JSON for each story file (in parallel)
      const storyData = await Promise.all(
        stories.map(async (f) => {
          const res = await fetch(`/store/${this._docPath}/${f}`);
          if (!res.ok) return { file: f, data: null };
          return { file: f, data: await res.json() };
        })
      );

      this._render({
        meta,
        files,
        spreadData,
        storyData,
        paraStyles,
        charStyles,
        paraStyleFiles,
        charStyleFiles,
        assetFolders,
      });

      this._setStatus(`Loaded: ${meta.title || this._docPath}`, 'ok');

    } catch (err) {
      this._setStatus(`Error: ${err.message}`, 'error');
      console.error(err);
    }
  }

  _render(data) {
    const { meta, files, spreadData, storyData, paraStyles, charStyles,
            paraStyleFiles, charStyleFiles, assetFolders } = data;

    this._workspace.innerHTML = '';

    // Document header
    this._workspace.appendChild(this._renderHeader(meta));

    // Sections
    this._workspace.appendChild(
      this._renderSection('Spreads', `${spreadData.length}`, () =>
        this._renderSpreads(spreadData))
    );

    this._workspace.appendChild(
      this._renderSection('Stories', `${storyData.length}`, () =>
        this._renderStories(storyData))
    );

    this._workspace.appendChild(
      this._renderSection('Paragraph Styles', `${paraStyleFiles.length}`, () =>
        this._renderStyles(paraStyles))
    );

    this._workspace.appendChild(
      this._renderSection('Character Styles', `${charStyleFiles.length}`, () =>
        this._renderStyles(charStyles))
    );

    this._workspace.appendChild(
      this._renderSection('Assets', `${assetFolders.size}`, () =>
        this._renderAssets(assetFolders))
    );

    this._workspace.appendChild(
      this._renderSection('All Files', `${files.length}`, () =>
        this._renderFileList(files))
    );
  }

  _renderHeader(meta) {
    const header = document.createElement('div');
    header.className = 'doc-header';
    header.id = 'doc-header';

    const title = document.createElement('div');
    title.className = 'doc-title';
    title.id = 'doc-title';
    title.textContent = meta.title || this._docPath;
    header.appendChild(title);

    const metaDiv = document.createElement('div');
    metaDiv.className = 'doc-meta';

    const fields = [
      ['Format', meta.format],
      ['Page Size', meta.pageSize ? `${meta.pageSize.width} x ${meta.pageSize.height} ${meta.defaultUnits || 'mm'}` : null],
      ['Created', meta.created ? new Date(meta.created).toLocaleString() : null],
      ['Modified', meta.modified ? new Date(meta.modified).toLocaleString() : null],
    ];

    for (const [label, value] of fields) {
      if (!value) continue;
      const span = document.createElement('span');
      span.innerHTML = `<strong>${label}:</strong> ${value}`;
      metaDiv.appendChild(span);
    }

    if (meta.bleed) {
      const span = document.createElement('span');
      span.innerHTML = `<strong>Bleed:</strong> ${meta.bleed.top}/${meta.bleed.right}/${meta.bleed.bottom}/${meta.bleed.left} ${meta.defaultUnits || 'mm'}`;
      metaDiv.appendChild(span);
    }

    header.appendChild(metaDiv);
    return header;
  }

  _renderSection(label, badge, contentFn) {
    const section = document.createElement('div');
    section.className = 'tree-section';
    section.dataset.section = label.toLowerCase().replace(/\s+/g, '-');

    const header = document.createElement('div');
    header.className = 'tree-section-header';

    const chevron = document.createElement('span');
    chevron.className = 'chevron';
    chevron.textContent = '\u25B6';
    header.appendChild(chevron);

    const text = document.createElement('span');
    text.textContent = label;
    header.appendChild(text);

    const badgeEl = document.createElement('span');
    badgeEl.className = 'badge';
    badgeEl.textContent = badge;
    header.appendChild(badgeEl);

    const body = document.createElement('div');
    body.className = 'tree-section-body';

    header.addEventListener('click', () => {
      const isOpen = chevron.classList.toggle('open');
      body.classList.toggle('open', isOpen);
      // Lazy-render content on first open
      if (isOpen && body.childElementCount === 0) {
        body.appendChild(contentFn());
      }
    });

    section.appendChild(header);
    section.appendChild(body);
    return section;
  }

  _renderSpreads(spreadData) {
    const container = document.createElement('div');

    for (const { file, data } of spreadData) {
      if (!data) {
        container.appendChild(this._makeItem(file, 'Failed to load'));
        continue;
      }

      const item = document.createElement('div');
      item.className = 'tree-item';
      item.dataset.spreadId = data.id || file;

      const idSpan = document.createElement('span');
      idSpan.className = 'item-id';
      idSpan.textContent = data.id || file;
      item.appendChild(idSpan);

      const pages = data.pages || [];
      const frames = data.frames || [];
      const detail = document.createElement('div');
      detail.className = 'item-detail';
      detail.textContent = `${pages.length} page(s), ${frames.length} frame(s)`;
      item.appendChild(detail);

      // Frames sub-items
      for (const frame of frames) {
        const sub = document.createElement('div');
        sub.className = 'tree-sub-item';
        sub.dataset.frameId = frame.id;

        const label = document.createElement('span');
        label.className = 'sub-label';
        label.textContent = `${frame.type} `;

        const id = document.createElement('span');
        id.className = 'item-id';
        id.textContent = frame.id;

        const info = document.createElement('span');
        info.className = 'item-detail';
        const ref = frame.storyRef ? ` -> ${frame.storyRef}` :
                    frame.assetRef ? ` -> ${frame.assetRef}` : '';
        info.textContent = ` (${frame.width}x${frame.height} at ${frame.x},${frame.y})${ref}`;

        sub.appendChild(label);
        sub.appendChild(id);
        sub.appendChild(info);
        item.appendChild(sub);
      }

      container.appendChild(item);
    }

    return container;
  }

  _renderStories(storyData) {
    const container = document.createElement('div');

    for (const { file, data } of storyData) {
      if (!data) {
        container.appendChild(this._makeItem(file, 'Failed to load'));
        continue;
      }

      const item = document.createElement('div');
      item.className = 'tree-item';
      item.dataset.storyId = data.id || file;

      const idSpan = document.createElement('span');
      idSpan.className = 'item-id';
      idSpan.textContent = data.id || file;
      item.appendChild(idSpan);

      const paragraphs = data.paragraphs || [];
      const totalRuns = paragraphs.reduce((sum, p) => sum + (p.runs || []).length, 0);
      const totalChars = paragraphs.reduce(
        (sum, p) => sum + (p.runs || []).reduce((s, r) => s + r.text.length, 0), 0
      );
      const detail = document.createElement('div');
      detail.className = 'item-detail';
      detail.textContent = `${paragraphs.length} paragraph(s), ${totalRuns} run(s), ${totalChars} chars`;
      item.appendChild(detail);

      // Show each paragraph
      for (let pi = 0; pi < paragraphs.length; pi++) {
        const para = paragraphs[pi];
        const sub = document.createElement('div');
        sub.className = 'tree-sub-item';

        const label = document.createElement('span');
        label.className = 'sub-label';
        label.textContent = `P${pi + 1}`;

        const styleRef = document.createElement('span');
        styleRef.className = 'item-detail';
        styleRef.textContent = ` [${para.styleRef || 'none'}] `;

        const preview = document.createElement('span');
        preview.className = 'item-label';
        const fullText = (para.runs || []).map(r => r.text).join('');
        preview.textContent = fullText.length > 80 ? fullText.slice(0, 80) + '...' : fullText;

        sub.appendChild(label);
        sub.appendChild(styleRef);
        sub.appendChild(preview);
        item.appendChild(sub);
      }

      container.appendChild(item);
    }

    return container;
  }

  _renderStyles(styleMap) {
    const container = document.createElement('div');
    const entries = Object.entries(styleMap);

    if (entries.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'item-detail';
      empty.textContent = 'No styles defined.';
      container.appendChild(empty);
      return container;
    }

    for (const [id, style] of entries) {
      const item = document.createElement('div');
      item.className = 'tree-item';
      item.dataset.styleId = id;

      const idSpan = document.createElement('span');
      idSpan.className = 'item-id';
      idSpan.textContent = id;
      item.appendChild(idSpan);

      // Key-value pairs
      for (const [key, value] of Object.entries(style)) {
        if (key === 'id') continue;
        const kv = document.createElement('div');
        kv.className = 'key-value';
        kv.innerHTML = `<span class="key">${key}</span><span class="value">${JSON.stringify(value)}</span>`;
        item.appendChild(kv);
      }

      container.appendChild(item);
    }

    return container;
  }

  _renderAssets(assetFolders) {
    const container = document.createElement('div');

    if (assetFolders.size === 0) {
      const empty = document.createElement('div');
      empty.className = 'item-detail';
      empty.textContent = 'No assets.';
      container.appendChild(empty);
      return container;
    }

    for (const [folder, files] of assetFolders) {
      const item = document.createElement('div');
      item.className = 'tree-item';
      item.dataset.assetId = folder;

      const idSpan = document.createElement('span');
      idSpan.className = 'item-id';
      idSpan.textContent = folder;
      item.appendChild(idSpan);

      const detail = document.createElement('div');
      detail.className = 'item-detail';
      detail.textContent = files.join(', ');
      item.appendChild(detail);

      container.appendChild(item);
    }

    return container;
  }

  _renderFileList(files) {
    const container = document.createElement('div');
    const pre = document.createElement('div');
    pre.className = 'raw-json';
    pre.textContent = files.join('\n');
    container.appendChild(pre);
    return container;
  }

  _renderNoDoc() {
    this._workspace.innerHTML = '';
    const noDoc = document.createElement('div');
    noDoc.className = 'no-doc';
    noDoc.id = 'no-doc';
    noDoc.innerHTML = `
      <h2 style="color: var(--text-main); margin-bottom: 1rem;">Document Inspector</h2>
      <p>No document specified.</p>
      <p style="margin-top: 1rem;">Add a <code>?doc=user/docname</code> parameter to the URL.</p>
      <p style="margin-top: 0.5rem;">Example: <code>?doc=demo/typography-sampler</code></p>
    `;
    this._workspace.appendChild(noDoc);
  }

  _makeItem(label, detail) {
    const item = document.createElement('div');
    item.className = 'tree-item';
    const l = document.createElement('span');
    l.className = 'item-label';
    l.textContent = label;
    item.appendChild(l);
    if (detail) {
      const d = document.createElement('span');
      d.className = 'item-detail';
      d.textContent = ` ${detail}`;
      item.appendChild(d);
    }
    return item;
  }

  _setStatus(text, type) {
    if (!this._status) return;
    this._status.setText(text, type);
  }

  getRibbonSections() {
    return [];
  }
}

shell.registerPlugin(new DocumentInspectorPlugin());
