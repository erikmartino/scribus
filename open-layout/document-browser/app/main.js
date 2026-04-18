import shell from '../../app-shell/lib/shell-core.js';

const TEMPLATE_NAMESPACE = 'demo';
const DEFAULT_USER = 'alice';

class DocumentBrowserPlugin {
  init(shellInstance) {
    this.shell = shellInstance;
    this._workspace = document.getElementById('workspace');
    this._status = document.getElementById('status');
    this._load();
  }

  async _load() {
    try {
      const [templates, userDocs] = await Promise.all([
        this._listDocuments(TEMPLATE_NAMESPACE),
        this._listDocuments(DEFAULT_USER),
      ]);
      this._render(templates, userDocs);
      this._setStatus('Ready', 'ok');
    } catch (err) {
      this._setStatus(`Error: ${err.message}`, 'error');
    }
  }

  /**
   * List documents under a namespace by fetching the recursive file list
   * and finding paths that contain document.json.
   * For each document, fetch its document.json metadata.
   */
  async _listDocuments(namespace) {
    const res = await fetch(`/store/${namespace}`);
    if (!res.ok) {
      if (res.status === 404) return [];
      throw new Error(`Failed to list ${namespace}: ${res.status}`);
    }
    const files = await res.json();

    // Find distinct document directories by looking for document.json entries
    const docDirs = new Set();
    for (const filePath of files) {
      const idx = filePath.indexOf('/document.json');
      if (idx !== -1) {
        docDirs.add(filePath.slice(0, idx));
      } else if (filePath === 'document.json') {
        // namespace itself is a document
        docDirs.add('');
      }
    }

    // Fetch metadata for each document
    const docs = [];
    for (const dir of docDirs) {
      const docPath = dir ? `${namespace}/${dir}` : namespace;
      const slug = dir || namespace;
      try {
        const metaRes = await fetch(`/store/${docPath}/document.json`);
        if (metaRes.ok) {
          const meta = await metaRes.json();
          // Count stories and spreads from the file list
          const prefix = dir ? `${dir}/` : '';
          const storyCount = files.filter(
            f => f.startsWith(`${prefix}stories/`) && f.endsWith('.json')
          ).length;
          const spreadCount = files.filter(
            f => f.startsWith(`${prefix}spreads/`) && f.endsWith('.json')
          ).length;

          docs.push({
            slug,
            path: docPath,
            namespace,
            title: meta.title || slug,
            pageSize: meta.pageSize,
            created: meta.created,
            modified: meta.modified,
            storyCount,
            spreadCount,
          });
        }
      } catch {
        // Skip documents with unreadable metadata
      }
    }

    return docs;
  }

  _render(templates, userDocs) {
    this._workspace.innerHTML = '';

    // Templates section
    const tplHeading = document.createElement('h2');
    tplHeading.textContent = 'Templates';
    this._workspace.appendChild(tplHeading);

    if (templates.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'empty-state';
      empty.textContent = 'No templates found.';
      this._workspace.appendChild(empty);
    } else {
      const tplGrid = document.createElement('div');
      tplGrid.className = 'doc-grid';
      tplGrid.id = 'template-grid';
      for (const doc of templates) {
        tplGrid.appendChild(this._createTemplateCard(doc));
      }
      this._workspace.appendChild(tplGrid);
    }

    // User documents section
    const userHeading = document.createElement('h2');
    userHeading.textContent = `My Documents (${DEFAULT_USER})`;
    this._workspace.appendChild(userHeading);

    if (userDocs.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'empty-state';
      empty.id = 'user-docs-empty';
      empty.textContent = 'No documents yet. Create one from a template above.';
      this._workspace.appendChild(empty);
    } else {
      const userGrid = document.createElement('div');
      userGrid.className = 'doc-grid';
      userGrid.id = 'user-docs-grid';
      for (const doc of userDocs) {
        userGrid.appendChild(this._createUserDocCard(doc));
      }
      this._workspace.appendChild(userGrid);
    }
  }

  _createTemplateCard(doc) {
    const card = document.createElement('div');
    card.className = 'doc-card';
    card.dataset.docPath = doc.path;

    const title = document.createElement('div');
    title.className = 'title';
    title.textContent = doc.title;
    card.appendChild(title);

    card.appendChild(this._createMeta(doc));

    const actions = document.createElement('div');
    actions.className = 'actions';

    const useBtn = document.createElement('button');
    useBtn.className = 'primary';
    useBtn.textContent = 'Use Template';
    useBtn.addEventListener('click', () => this._showCloneDialog(doc));
    actions.appendChild(useBtn);

    card.appendChild(actions);
    return card;
  }

  _createUserDocCard(doc) {
    const card = document.createElement('div');
    card.className = 'doc-card';
    card.dataset.docPath = doc.path;

    const title = document.createElement('div');
    title.className = 'title';
    title.textContent = doc.title;
    card.appendChild(title);

    card.appendChild(this._createMeta(doc));

    const actions = document.createElement('div');
    actions.className = 'actions';

    const openBtn = document.createElement('button');
    openBtn.className = 'primary';
    openBtn.textContent = 'Open';
    openBtn.addEventListener('click', () => {
      window.location.href = `/spread-editor/index.html`;
    });
    actions.appendChild(openBtn);

    card.appendChild(actions);
    return card;
  }

  _createMeta(doc) {
    const meta = document.createElement('div');
    meta.className = 'meta';

    if (doc.pageSize) {
      const size = document.createElement('span');
      size.textContent = `${doc.pageSize.width} x ${doc.pageSize.height} mm`;
      meta.appendChild(size);
    }

    const detail = document.createElement('div');
    detail.className = 'detail';

    if (doc.spreadCount > 0) {
      const spreads = document.createElement('span');
      spreads.textContent = `${doc.spreadCount} spread${doc.spreadCount !== 1 ? 's' : ''}`;
      detail.appendChild(spreads);
    }

    if (doc.storyCount > 0) {
      const stories = document.createElement('span');
      stories.textContent = `${doc.storyCount} ${doc.storyCount !== 1 ? 'stories' : 'story'}`;
      detail.appendChild(stories);
    }

    if (doc.modified) {
      const mod = document.createElement('span');
      mod.textContent = `Modified ${this._formatDate(doc.modified)}`;
      detail.appendChild(mod);
    }

    meta.appendChild(detail);
    return meta;
  }

  _showCloneDialog(templateDoc) {
    // Generate a default slug from the template title
    const defaultSlug = templateDoc.title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');

    const overlay = document.createElement('div');
    overlay.className = 'clone-dialog-overlay';

    const dialog = document.createElement('div');
    dialog.className = 'clone-dialog';

    const heading = document.createElement('h3');
    heading.textContent = `New from "${templateDoc.title}"`;
    dialog.appendChild(heading);

    const nameLabel = document.createElement('label');
    nameLabel.textContent = 'Document name';
    nameLabel.setAttribute('for', 'clone-name-input');
    dialog.appendChild(nameLabel);

    const nameInput = document.createElement('input');
    nameInput.id = 'clone-name-input';
    nameInput.type = 'text';
    nameInput.value = defaultSlug;
    nameInput.placeholder = 'my-new-document';
    dialog.appendChild(nameInput);

    const errorMsg = document.createElement('div');
    errorMsg.style.cssText = 'color: #ff5555; font-size: 0.78rem; margin-bottom: 0.5rem; min-height: 1.2em;';
    dialog.appendChild(errorMsg);

    const btnRow = document.createElement('div');
    btnRow.className = 'dialog-actions';

    const cancelBtn = document.createElement('button');
    cancelBtn.textContent = 'Cancel';
    cancelBtn.addEventListener('click', () => overlay.remove());

    const createBtn = document.createElement('button');
    createBtn.className = 'primary';
    createBtn.textContent = 'Create';
    createBtn.addEventListener('click', async () => {
      const slug = nameInput.value.trim().replace(/[^a-z0-9_-]/gi, '-').toLowerCase();
      if (!slug) {
        errorMsg.textContent = 'Please enter a document name.';
        return;
      }
      createBtn.disabled = true;
      createBtn.textContent = 'Creating...';
      errorMsg.textContent = '';

      try {
        const res = await fetch(`/store/${DEFAULT_USER}/${slug}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ from: templateDoc.path }),
        });

        if (res.status === 409) {
          errorMsg.textContent = `"${slug}" already exists. Choose a different name.`;
          createBtn.disabled = false;
          createBtn.textContent = 'Create';
          return;
        }

        if (!res.ok) {
          const text = await res.text();
          throw new Error(text);
        }

        overlay.remove();
        this._setStatus(`Created ${DEFAULT_USER}/${slug}`, 'ok');
        // Reload the document list
        await this._load();
      } catch (err) {
        errorMsg.textContent = err.message;
        createBtn.disabled = false;
        createBtn.textContent = 'Create';
      }
    });

    btnRow.appendChild(cancelBtn);
    btnRow.appendChild(createBtn);
    dialog.appendChild(btnRow);
    overlay.appendChild(dialog);

    // Close on overlay background click
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) overlay.remove();
    });

    document.body.appendChild(overlay);
    nameInput.focus();
    nameInput.select();

    // Enter key submits
    nameInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') createBtn.click();
      if (e.key === 'Escape') overlay.remove();
    });
  }

  _formatDate(isoString) {
    try {
      const d = new Date(isoString);
      const now = new Date();
      const diffMs = now - d;
      const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

      if (diffDays === 0) return 'today';
      if (diffDays === 1) return 'yesterday';
      if (diffDays < 7) return `${diffDays} days ago`;

      return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    } catch {
      return isoString;
    }
  }

  _setStatus(text, type) {
    if (!this._status) return;
    this._status.textContent = text;
    this._status.className = 'status-bar' + (type ? ` ${type}` : '');
  }

  // Plugin interface — no ribbon or panel contributions needed
  getRibbonSections() {
    return [];
  }
}

shell.registerPlugin(new DocumentBrowserPlugin());
