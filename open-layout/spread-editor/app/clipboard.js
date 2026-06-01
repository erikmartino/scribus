import { AbstractItem } from '../../app-shell/lib/document-model.js';
import { parseHtmlToStory } from '../lib/story-editor-core.js';
import { uploadImageAsset, loadAssets, assetNameFromFilename } from '../../document-store/lib/document-store.js';

export function initClipboard(app, shell) {
  const storyItem = new AbstractItem('spread-story', 'story');
  storyItem.serialize = () => {
    if (app.mode !== 'text' && !app.selectedBoxId) return null;
    const selectedText = app.editor.getSelectedText();
    const range = app.editor.getSelectionRange();
    if (selectedText && range) {
      return {
        type: 'story',
        data: selectedText,
        story: app.editor.getRichSelection(),
        paragraphStyles: app.editor.paragraphStyles.slice(range.start.paraIndex, range.end.paraIndex + 1).map(s => ({...s}))
      };
    }
    return null;
  };
  shell.doc.registerItem(storyItem);
  app.storyItem = storyItem;

  initSelectionSync(app, shell);

  shell.addEventListener('paste-received', (e) => app.handlePaste(e.detail));

  shell.addEventListener('cut-executed', () => {
    if (app.mode !== 'text' || !app.editor.hasSelection()) return;
    app.submitAction('Cut', () => {
      app.editor.replaceSelectionWithText('');
    });
  });
}

export function initSelectionSync(app, shell) {
  shell.selection.addEventListener('selectionchange', (e) => {
    const primary = e.detail.primary;
    if (primary && primary.id && primary.id !== app.selectedBoxId) {
      // If it's a known box id in this app, select it
      const isBox = app.boxes.some(b => b.id === primary.id) || 
                    app.imageBoxes.some(b => b.id === primary.id);
      if (isBox) {
        app.selectedBoxId = primary.id;
        app.update({ full: false });
      }
    }
  });
}

export async function handlePaste(app, payload) {
  if (!payload || !payload.items) return;

  // 1. Image paste
  const imageItem = payload.items.find(it => it && it.type === 'image');
  if (imageItem) {
    if (app.mode === 'text') {
      // Insert inline image placeholder in text flow
      const dataUrl = await blobToDataUrl(imageItem.data);
      app.submitAction('Paste Inline Image', () => {
        const run = { text: '\uFFFC', style: { bold: false, italic: false, inlineImage: dataUrl } };
        app.editor.insertStory([[run]]);
      });
    } else {
      // Object mode: place image box on the pasteboard (upload as asset if possible)
      await placeImageBox(app, imageItem.data, imageItem.data.name || 'pasted-image');
    }
    return;
  }

  if (app.mode !== 'text') return;

  // 2. Native Story Data (preferred)
  const storyItem = payload.items.find(it => it && it.type === 'story');
  if (storyItem && storyItem.story) {
    app.submitAction('Paste Story', () => {
      app.editor.insertStory(storyItem.story, storyItem.paragraphStyles);
    });
    return;
  }

  // 3. Rich text (HTML from external sources)
  const htmlItem = payload.items.find(it => it && it.type === 'text/html');
  if (htmlItem) {
    const story = parseHtmlToStory(htmlItem.data);
    if (story.length > 0) {
      app.submitAction('Paste Rich Text', () => {
        app.editor.insertStory(story);
      });
      return;
    }
  }

  // 4. Plain Text fallback
  const textItem = payload.items.find(it => it && (it.type === 'plain-text' || it.type === 'rich-text-fragment'));
  if (textItem) {
    app.submitAction('Paste Text', () => {
      const raw = textItem.data;
      const text = textItem.type === 'rich-text-fragment' 
        ? raw.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ') 
        : raw;
      
      if (app.editor.hasSelection()) {
        app.editor.replaceSelectionWithText(text);
      } else {
        app.editor.applyOperation('insertText', { text });
      }
    });
  }
}

/** Convert a Blob or File to a data URL string. */
export function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

/**
 * Load an image blob to get its natural dimensions.
 * @param {Blob} blob
 * @returns {Promise<{ width: number, height: number, dataUrl: string }>}
 */
export function loadImageBlob(blob) {
  if (blob.type === 'image/tiff' || blob.name?.endsWith('.tiff') || blob.name?.endsWith('.tif')) {
    return new Promise(async (resolve, reject) => {
      try {
        const buffer = await blob.arrayBuffer();
        const utifModule = await import('https://esm.sh/utif2@4.1.0');
        const UTIF = utifModule.default || utifModule;
        const ifds = UTIF.decode(buffer);
        if (ifds.length === 0 || !ifds[0].t256 || !ifds[0].t257) {
          throw new Error('Invalid TIFF dimensions');
        }
        const width = ifds[0].t256[0];
        const height = ifds[0].t257[0];
        resolve({ width, height, dataUrl: '' });
      } catch (err) {
        resolve({ width: 120, height: 90, dataUrl: '' });
      }
    });
  }

  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = () => {
      const dataUrl = reader.result;
      const img = new Image();
      img.onload = () => resolve({ width: img.width, height: img.height, dataUrl });
      img.onerror = () => reject(new Error('Failed to decode image'));
      img.src = dataUrl;
    };
    reader.readAsDataURL(blob);
  });
}

/**
 * Prepare an image for placement: upload as an asset if the editor is
 * connected to a document store, otherwise keep as a data URL.
 *
 * @param {SpreadEditorApp} app
 * @param {Blob} blob - Image data
 * @param {string} filename - Original filename (e.g. "photo.png")
 * @returns {Promise<{ imageUrl: string, assetRef?: string, assetExt?: string, width: number, height: number }>}
 */
export async function prepareImageAsset(app, blob, filename) {
  const { width, height, dataUrl } = await loadImageBlob(blob);
  const mime = blob.type || 'image/png';

  if (app._docPath) {
    try {
      const name = assetNameFromFilename(filename || 'image');
      const { assetRef, ext } = await uploadImageAsset(
        app._docPath, name, blob, { mime, width, height },
      );
      // Build the URL to the uploaded file for rendering
      const imageUrl = `/store/${app._docPath}/assets/${assetRef}/${assetRef}.${ext}`;
      app._assets = await loadAssets(app._docPath);
      app.shell?.updatePanels();
      return { imageUrl, assetRef, assetExt: ext, width, height };
    } catch (err) {
      console.warn('Asset upload failed, falling back to data URL:', err);
    }
  }

  return { imageUrl: dataUrl, width, height };
}

/** Place an image box on the pasteboard centered in the current view. */
export async function placeImageBox(app, blob, filename) {
  if (!app.currentSpread) return;
  const asset = await prepareImageAsset(app, blob, filename);

  const maxW = 300;
  const scale = Math.min(1, maxW / asset.width);
  const w = asset.width * scale;
  const h = asset.height * scale;

  const page = app.currentSpread.pageRects[0];
  const x = page.x + (page.width - w) / 2;
  const y = page.y + (page.height - h) / 2;

  const boxId = `image-${++app._imageBoxCounter}`;
  const imageBox = {
    id: boxId,
    x, y, width: w, height: h,
    minWidth: 20, minHeight: 20,
    imageUrl: asset.imageUrl,
    imgWidth: asset.width,
    imgHeight: asset.height,
    ...(asset.assetRef ? { assetRef: asset.assetRef, assetExt: asset.assetExt } : {}),
  };

  app.submitAction('Paste Image Box', () => {
    app.imageBoxes = [...app.imageBoxes, imageBox];
    app.selectedBoxId = boxId;
  });
}
