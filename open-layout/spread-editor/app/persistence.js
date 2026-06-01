import {
  serializeStory,
  putJson,
  updateDocTimestamp,
  loadSpread,
  loadParagraphStyles,
  loadStoryFromStore,
  loadAssets,
} from '../../document-store/lib/document-store.js';
import {
  EditorState,
  cloneStyle,
  cloneParagraphStyle,
} from '../lib/story-editor-core.js';

/** Generate a simple SVG data URL as a placeholder for empty image frames. */
export function emptyImagePlaceholder() {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="150" viewBox="0 0 200 150">
      <rect width="200" height="150" fill="#e0ddd5" stroke="#b0ab9f" stroke-width="1"/>
      <line x1="0" y1="0" x2="200" y2="150" stroke="#b0ab9f" stroke-width="0.5"/>
      <line x1="200" y1="0" x2="0" y2="150" stroke="#b0ab9f" stroke-width="0.5"/>
      <text x="100" y="80" text-anchor="middle" fill="#8a857a" font-size="14" font-family="sans-serif">Image</text>
    </svg>`;
  return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
}

export async function loadAllSpreadsMetadata(app) {
  if (!app._spreadsList || app._spreadsList.length === 0) return;
  
  app._spreadsMetadata = {};
  const promises = app._spreadsList.map(async (spreadId) => {
    try {
      const spreadJson = await loadSpread(app._docPath, spreadId);
      app._spreadsMetadata[spreadId] = {
        pages: spreadJson.pages || []
      };
    } catch (err) {
      console.warn(`Failed to load metadata for spread ${spreadId}:`, err);
      app._spreadsMetadata[spreadId] = { pages: [] };
    }
  });
  await Promise.all(promises);
}

export async function loadFromStore(app) {
  app.setStatus('Loading document from store...');

  // Clear existing spread-specific data to prevent accumulation when switching
  app.boxes = [];
  app.imageBoxes = [];
  app._stories = [];
  app._activeStory = null;
  app._imageBoxCounter = 0;
  app._storyCounter = 0;
  app._loadedFromStore = false;

  // Discover spreads dynamically if not already done
  if (!app._spreadsList) {
    try {
      const response = await fetch(`/store/${app._docPath}`);
      if (response.ok) {
        const files = await response.json();
        const spreadFiles = files.filter(f => f.startsWith('spreads/') && f.endsWith('.json'));
        app._spreadsList = spreadFiles.map(f => {
          const parts = f.split('/');
          const filename = parts[parts.length - 1];
          return filename.replace('.json', '');
        });
        // Sort spreads list numerically if possible
        app._spreadsList.sort((a, b) => {
          const numA = parseInt(a.replace(/[^\d]/g, ''), 10);
          const numB = parseInt(b.replace(/[^\d]/g, ''), 10);
          if (!isNaN(numA) && !isNaN(numB)) return numA - numB;
          return a.localeCompare(b);
        });
        
        await app._loadAllSpreadsMetadata();
      }
    } catch (err) {
      console.warn('Failed to list spreads from store:', err);
    }
  }

  if (!app._spreadsList || app._spreadsList.length === 0) {
    app._spreadsList = ['spread-1'];
    app._spreadsMetadata['spread-1'] = {
      pages: [{ index: 0, label: '1' }, { index: 1, label: '2' }]
    };
  }

  if (!app._activeSpreadId) {
    app._activeSpreadId = app._spreadsList[0] || 'spread-1';
  }

  // 1. Load the spread definition
  const spreadJson = await loadSpread(app._docPath, app._activeSpreadId);
  
  // Save pages configuration for serialization
  app._activeSpreadPages = spreadJson.pages || [
    { index: 0, label: '1' },
    { index: 1, label: '2' }
  ];

  // 2. Load paragraph style definitions (for resolving styleRef)
  const styleMap = await loadParagraphStyles(app._docPath);

  // 3. Parse frames into boxes and collect storyRefs to load
  const storyRefsToLoad = new Set();
  // Map from storyRef -> ordered list of box IDs in that story chain
  const storyBoxMap = new Map();

  // Pre-load asset metadata so we can resolve assetRefs to URLs
  const assetMeta = await loadAssets(app._docPath);
  app._assets = assetMeta;

  for (const frame of spreadJson.frames || []) {
    if (frame.type === 'image') {
      let imageUrl;
      let assetRef;
      let assetExt;
      let imgWidth = null;
      let imgHeight = null;

      if (frame.assetRef) {
        // Resolve assetRef to a URL using metadata or fallback
        assetRef = frame.assetRef;
        const meta = assetMeta[assetRef];
        if (meta) {
          imgWidth = meta.width;
          imgHeight = meta.height;
          if (meta.preview) {
            imageUrl = `/store/${app._docPath}/assets/${assetRef}/${meta.preview}`;
            assetExt = 'jpg';
          } else {
            imageUrl = app._emptyImagePlaceholder();
            assetExt = 'jpg';
          }
        } else {
          imageUrl = app._emptyImagePlaceholder();
          assetExt = 'jpg';
        }
      } else {
        imageUrl = frame.imageUrl || app._emptyImagePlaceholder();
      }

      app.imageBoxes.push({
        id: frame.id,
        x: frame.x,
        y: frame.y,
        width: frame.width,
        height: frame.height,
        minWidth: 20,
        minHeight: 20,
        imageUrl,
        imgWidth,
        imgHeight,
        placement: frame.placement,
        ...(assetRef ? { assetRef, assetExt } : {}),
      });
      app._imageBoxCounter++;
    } else {
      // Text frame
      app.boxes.push({
        id: frame.id,
        x: frame.x,
        y: frame.y,
        width: frame.width,
        height: frame.height,
        minWidth: 80,
        minHeight: 60,
      });
      if (frame.storyRef) {
        storyRefsToLoad.add(frame.storyRef);
        if (!storyBoxMap.has(frame.storyRef)) {
          storyBoxMap.set(frame.storyRef, []);
        }
        storyBoxMap.get(frame.storyRef).push(frame.id);
      }
    }
  }

  // 4. Load each referenced story
  const storyPromises = [...storyRefsToLoad].map(async (storyRef) => {
    try {
      const { story, paragraphStyles } = await loadStoryFromStore(
        app._docPath,
        storyRef,
        { baseFontSize: app._fontSize, styleMap }
      );

      // Ensure at least one paragraph
      if (story.length === 0) {
        story.push([{ text: '', style: cloneStyle() }]);
        paragraphStyles.push(cloneParagraphStyle({ fontSize: app._fontSize }));
      }

      return {
        storyRef,
        id: storyRef,
        story,
        paragraphStyles,
        boxIds: storyBoxMap.get(storyRef) || [],
      };
    } catch (err) {
      console.warn(`Failed to load story ${storyRef}:`, err);
      return null;
    }
  });

  const loadedStories = (await Promise.all(storyPromises)).filter(Boolean);

  // 5. Build story entries
  app._stories = [];
  for (const loaded of loadedStories) {
    const storyEntry = {
      id: loaded.id,
      editor: new EditorState(loaded.story, loaded.paragraphStyles),
      boxIds: loaded.boxIds,
      lineMap: [],
    };
    app._stories.push(storyEntry);
    app._storyCounter++;
  }

  // If no stories were loaded, create an empty fallback
  if (app._stories.length === 0) {
    const emptyStory = [[{ text: '', style: cloneStyle() }]];
    const emptyStyles = [cloneParagraphStyle({ fontSize: app._fontSize })];
    app._stories.push({
      id: `story-${app._storyCounter++}`,
      editor: new EditorState(emptyStory, emptyStyles),
      boxIds: app.boxes.map(b => b.id),
      lineMap: [],
    });
  }

  app._activeStory = app._stories[0];
  // Mark boxes as loaded so update() won't overwrite with defaults
  app._loadedFromStore = true;
  app.selectedBoxId = app.boxes[0]?.id || app.imageBoxes[0]?.id || null;

  // Kick off browser-based preview generation for any image boxes that
  // are still showing the empty placeholder (no preview in meta.json yet).
  const placeholder = app._emptyImagePlaceholder();
  const needsPreview = app.imageBoxes.some(b => b.imageUrl === placeholder);
  if (needsPreview) {
    app._startPreviewWorker();
  }
}

export async function saveSpread(app) {
  if (!app._docPath || app._saving) return;

  app._saving = true;
  app.shell?.requestUpdate();
  app.setStatus('Saving...');

  try {
    const puts = [];

    // Spread definition (using custom serializer)
    puts.push(
      putJson(`/store/${app._docPath}/spreads/${app._activeSpreadId}.json`, app._serializeSpread())
    );

    // Stories (using shared serializer)
    for (const storyEntry of app._stories) {
      const json = serializeStory(storyEntry.id, storyEntry.editor);
      puts.push(
        putJson(`/store/${app._docPath}/stories/${storyEntry.id}.json`, json)
      );
    }

    // document.json timestamp
    puts.push(updateDocTimestamp(app._docPath));

    const results = await Promise.all(puts);
    // updateDocTimestamp returns void, so filter only Response objects
    const failed = results.filter(r => r && typeof r.ok === 'boolean' && !r.ok);
    if (failed.length > 0) {
      throw new Error(`${failed.length} file(s) failed to save`);
    }

    app.setStatus('Saved.', 'ok');
  } catch (err) {
    app.setStatus(`Save failed: ${err.message}`, 'error');
    console.error('Save failed:', err);
  } finally {
    app._saving = false;
    app.shell?.requestUpdate();
  }
}

export function serializeSpread(app) {
  const frames = [];

  // Text frames: each box references its story via storyRef
  for (const box of app.boxes) {
    const story = app._findStoryForBox(box.id);
    const frame = {
      id: box.id,
      type: 'text',
      x: Math.round(box.x * 100) / 100,
      y: Math.round(box.y * 100) / 100,
      width: Math.round(box.width * 100) / 100,
      height: Math.round(box.height * 100) / 100,
    };
    if (story) frame.storyRef = story.id;
    frames.push(frame);
  }

  // Image frames — prefer assetRef (spec convention) over inline imageUrl
  for (const box of app.imageBoxes) {
    const frame = {
      id: box.id,
      type: 'image',
      x: Math.round(box.x * 100) / 100,
      y: Math.round(box.y * 100) / 100,
      width: Math.round(box.width * 100) / 100,
      height: Math.round(box.height * 100) / 100,
    };
    if (box.placement) {
      frame.placement = box.placement;
    }
    if (box.assetRef) {
      frame.assetRef = box.assetRef;
    } else {
      frame.imageUrl = box.imageUrl;
    }
    frames.push(frame);
  }

  return {
    id: app._activeSpreadId,
    pages: app._activeSpreadPages || [
      { index: 0, label: '1' },
      { index: 1, label: '2' },
    ],
    frames,
  };
}

export async function refreshPlaceholderBoxes(app) {
  const placeholder = app._emptyImagePlaceholder();
  const stale = app.imageBoxes.filter(b => b.imageUrl === placeholder && b.assetRef);
  if (stale.length === 0) return;

  let changed = false;
  await Promise.all(stale.map(async (box) => {
    try {
      const metaUrl = `/store/${app._docPath}/assets/${box.assetRef}/meta.json`;
      const res = await fetch(metaUrl);
      if (!res.ok) return;
      const meta = await res.json();
      if (meta.preview) {
        box.imageUrl = `/store/${app._docPath}/assets/${box.assetRef}/${meta.preview}?t=${Date.now()}`;
        changed = true;
      }
    } catch { /* ignore */ }
  }));

  if (changed) await app.update();
}
