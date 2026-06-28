import {
  serializeStory,
  putJson,
  putAsset,
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
import { SvgRenderer, getImagePlacement, emptyImagePlaceholder } from '../../doc-renderer/lib/svg-renderer.js';
import { buildParagraphLayoutStyles } from '../../story-editor/lib/layout-engine.js';
import { sliceStory, layoutDocument } from '../../doc-renderer/lib/layout-document.js';


export async function loadAllSpreadsMetadata(app) {
  if (!app._spreadsList || app._spreadsList.length === 0) return;
  
  app._spreadsMetadata = {};
  if (!app._layoutCache) {
    app._layoutCache = {};
  }
  
  const promises = app._spreadsList.map(async (spreadId) => {
    try {
      const spreadJson = await loadSpread(app._docPath, spreadId);
      app._spreadsMetadata[spreadId] = {
        pages: spreadJson.pages || []
      };
      
      // Pre-populate layout cache with the saved flowAnchors/startOffsets
      app._layoutCache[spreadId] = {
        startOffsets: spreadJson.flowAnchors || {},
        nextOffsets: {}, // Linked in the next step
        pages: spreadJson.pages || []
      };
    } catch (err) {
      console.warn(`Failed to load metadata for spread ${spreadId}:`, err);
      app._spreadsMetadata[spreadId] = { pages: [] };
    }
  });
  await Promise.all(promises);

  // Link pre-populated nextOffsets to the next spread's startOffsets
  for (let i = 0; i < app._spreadsList.length; i++) {
    const spreadId = app._spreadsList[i];
    const nextSpreadId = i < app._spreadsList.length - 1 ? app._spreadsList[i + 1] : null;
    if (app._layoutCache[spreadId]) {
      app._layoutCache[spreadId].nextOffsets = nextSpreadId && app._layoutCache[nextSpreadId]
        ? { ...app._layoutCache[nextSpreadId].startOffsets }
        : {};
    }
  }
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

  // Check page query parameter to select correct spread initially
  const params = new URLSearchParams(window.location.search);
  const pageParam = params.get('page');
  if (!app._activeSpreadId && pageParam && app._spreadsList) {
    let globalPageIndex = 0;
    let foundSpreadId = null;
    for (const spreadId of app._spreadsList) {
      const pages = app._spreadsMetadata[spreadId]?.pages || [];
      for (const page of pages) {
        globalPageIndex++;
        if (String(globalPageIndex) === String(pageParam) || page.label === String(pageParam)) {
          foundSpreadId = spreadId;
          break;
        }
      }
      if (foundSpreadId) {
        app._activeSpreadId = foundSpreadId;
        break;
      }
    }
  }

  if (!app._activeSpreadId) {
    app._activeSpreadId = app._spreadsList[0] || 'spread-1';
  }

  // 1. Load the spread definition
  const spreadJson = await loadSpread(app._docPath, app._activeSpreadId);
  
  if (!app._layoutCache) {
    app._layoutCache = {};
  }

  if (app.engine) {
    try {
      await layoutDocument(app.engine, app._docPath, {
        activeSpreadId: app._activeSpreadId,
        layoutCache: app._layoutCache
      });
      app.flowAnchors = app._layoutCache[app._activeSpreadId]?.startOffsets || {};
    } catch (layoutErr) {
      console.warn('Failed to calculate layout offsets for loaded spread:', layoutErr);
      app.flowAnchors = spreadJson.flowAnchors || {};
    }
  } else {
    app.flowAnchors = spreadJson.flowAnchors || {};
  }

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

    // JPG preview/thumbnail of the spread without editor decoration
    if (app.engine) {
      const previewPromise = new Promise(async (resolve) => {
        try {
          const SVG_NS = 'http://www.w3.org/2000/svg';
          const pb = app.currentSpread?.pasteboardRect;
          const width = pb ? pb.width : 800;
          const height = pb ? pb.height : 600;

          // Create clean offscreen SVG
          const previewSvg = document.createElementNS(SVG_NS, 'svg');
          previewSvg.setAttribute('width', String(width));
          previewSvg.setAttribute('height', String(height));
          if (pb) {
            previewSvg.setAttribute('viewBox', `${pb.x} ${pb.y} ${pb.width} ${pb.height}`);
          } else {
            previewSvg.setAttribute('viewBox', `0 0 ${width} ${height}`);
          }
          previewSvg.setAttribute('xmlns', SVG_NS);

          // 1. Draw page backgrounds (white)
          if (app.currentSpread && app.currentSpread.pageRects) {
            for (const page of app.currentSpread.pageRects) {
              const rect = document.createElementNS(SVG_NS, 'rect');
              rect.setAttribute('x', String(page.x));
              rect.setAttribute('y', String(page.y));
              rect.setAttribute('width', String(page.width));
              rect.setAttribute('height', String(page.height));
              rect.setAttribute('fill', '#ffffff');
              previewSvg.appendChild(rect);
            }
          }

          // 2. Draw image boxes
          if (app.imageBoxes && app.imageBoxes.length > 0) {
            const g = document.createElementNS(SVG_NS, 'g');
            g.setAttribute('data-layer', 'image-boxes');
            previewSvg.appendChild(g);

            for (const box of app.imageBoxes) {
              const placement = getImagePlacement(box);
              const nested = document.createElementNS(SVG_NS, 'svg');
              nested.setAttribute('x', String(box.x));
              nested.setAttribute('y', String(box.y));
              nested.setAttribute('width', String(box.width));
              nested.setAttribute('height', String(box.height));
              nested.setAttribute('overflow', 'hidden');
              nested.setAttribute('style', 'pointer-events: none;');

              const imgEl = document.createElementNS(SVG_NS, 'image');
              imgEl.setAttribute('href', box.imageUrl);
              imgEl.setAttribute('x', String(placement.x));
              imgEl.setAttribute('y', String(placement.y));
              imgEl.setAttribute('width', String(placement.w));
              imgEl.setAttribute('height', String(placement.h));
              imgEl.setAttribute('preserveAspectRatio', 'none');
              imgEl.setAttribute('pointer-events', 'none');

              nested.appendChild(imgEl);
              g.appendChild(nested);
            }
          }

          // 3. Flow and render text outline paths (using standard text with base64 embedded fonts)
          const renderer = new SvgRenderer({
            fontFamily: app.engine.defaultFamily || 'EB Garamond',
            useOutlines: false,
          });

          for (const storyEntry of app._stories) {
            const storyBoxes = storyEntry.boxIds
              .map(id => app.boxes.find(b => b.id === id))
              .filter(Boolean);

            if (storyBoxes.length === 0) continue;

            const offset = (app.flowAnchors && app.flowAnchors[storyEntry.id]) || { paragraphIndex: 0, charOffset: 0 };
            const { slicedStory, slicedStyles } = sliceStory(
              storyEntry.editor.story,
              storyEntry.editor.paragraphStyles,
              offset.paragraphIndex,
              offset.charOffset
            );

            const paragraphLayoutStyles = buildParagraphLayoutStyles(
              app._fontSize, slicedStyles);

            const shaped = app.engine.shapeParagraphs(
              slicedStory, app._fontSize, paragraphLayoutStyles);

            const { boxResults } = app.engine.flowIntoBoxes(
              shaped, storyBoxes, app._fontSize, app._lineHeight);

            const resolvedLayout = app.engine.resolveLayout(boxResults, app._fontSize, app._lineHeight);
            const result = renderer.render(resolvedLayout);

            // Transplant all outline elements (text/images) to our preview SVG
            for (const child of Array.from(result.svg.childNodes)) {
              if (child.tagName === 'rect' && child.getAttribute('fill') === 'none') {
                continue;
              }
              previewSvg.appendChild(child.cloneNode(true));
            }
          }

          // 4. Generate and embed @font-face rules as base64 for all loaded fonts
          let fontFaceCss = `
            svg text {
              text-rendering: optimizeLegibility;
              -webkit-font-smoothing: antialiased;
            }
          `;

          function uint8ArrayToBase64(uint8) {
            let binary = '';
            const len = uint8.byteLength;
            const chunkSize = 0xffff;
            for (let i = 0; i < len; i += chunkSize) {
              const chunk = uint8.subarray(i, i + chunkSize);
              binary += String.fromCharCode.apply(null, chunk);
            }
            return btoa(binary);
          }

          const buffers = app.engine.fontBuffers;
          if (buffers) {
            for (const [key, buffer] of Object.entries(buffers)) {
              const parts = key.split(':');
              const family = parts[0];
              const variant = parts[1] || 'regular';

              let weight = 'normal';
              let style = 'normal';
              if (variant.includes('bold')) weight = 'bold';
              if (variant.includes('italic')) style = 'italic';

              try {
                const base64 = uint8ArrayToBase64(buffer);
                fontFaceCss += `
@font-face {
  font-family: '${family}';
  src: url(data:font/truetype;base64,${base64}) format('truetype');
  font-weight: ${weight};
  font-style: ${style};
}
`;
              } catch (e) {
                console.warn('Failed to embed font in preview CSS:', key, e);
              }
            }
          }

          const styleEl = document.createElementNS(SVG_NS, 'style');
          styleEl.textContent = fontFaceCss;
          previewSvg.appendChild(styleEl);

          // 5. Convert all image URLs to base64 data URLs to make SVG self-contained
          const images = Array.from(previewSvg.getElementsByTagName('image'));
          for (const imgEl of images) {
            const href = imgEl.getAttribute('href') || imgEl.getAttribute('xlink:href');
            if (href && !href.startsWith('data:')) {
              try {
                const res = await fetch(href);
                if (res.ok) {
                  const blob = await res.blob();
                  const dataUrl = await new Promise((resolveReader) => {
                    const reader = new FileReader();
                    reader.onloadend = () => resolveReader(reader.result);
                    reader.readAsDataURL(blob);
                  });
                  imgEl.setAttribute('href', dataUrl);
                  imgEl.removeAttribute('xlink:href');
                }
              } catch (imgErr) {
                console.warn('Failed to convert image to data URL for preview:', href, imgErr);
              }
            }
          }

          const svgString = new XMLSerializer().serializeToString(previewSvg);
          const svgUrl = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svgString);

          const img = new Image();
          img.onload = () => {
            try {
              const canvas = document.createElement('canvas');
              const width = pb ? pb.width : 800;
              const height = pb ? pb.height : 600;
              // Render at 2x resolution for crisp high-quality output
              const scale = 2;
              canvas.width = width * scale;
              canvas.height = height * scale;
              const ctx = canvas.getContext('2d');
              ctx.scale(scale, scale);
              
              // Fill canvas with white background
              ctx.fillStyle = '#ffffff';
              ctx.fillRect(0, 0, width, height);
              ctx.drawImage(img, 0, 0);
              canvas.toBlob(async (blob) => {
                if (blob) {
                  try {
                    const res = await putAsset(`/store/${app._docPath}/spreads/${app._activeSpreadId}.jpg`, blob, 'image/jpeg');
                    resolve(res);
                  } catch (err) {
                    console.error('Failed to upload JPG preview:', err);
                    resolve(null);
                  }
                } else {
                  resolve(null);
                }
              }, 'image/jpeg', 0.85);
            } catch (err) {
              console.error('Failed to render canvas for JPG preview:', err);
              resolve(null);
            }
          };
          img.onerror = (err) => {
            console.error('Failed to load SVG into Image for JPG preview:', err);
            resolve(null);
          };
          img.src = svgUrl;
        } catch (err) {
          console.error('Failed to setup SVG preview outlines generation:', err);
          resolve(null);
        }
      });
      puts.push(previewPromise);
    }

    const results = await Promise.all(puts);
    // updateDocTimestamp returns void, so filter only Response objects
    const failed = results.filter(r => r && typeof r.ok === 'boolean' && !r.ok);
    if (failed.length > 0) {
      throw new Error(`${failed.length} file(s) failed to save`);
    }

    if (app._layoutCache && app._activeSpreadId && app._spreadsList) {
      const activeIdx = app._spreadsList.indexOf(app._activeSpreadId);
      if (activeIdx !== -1) {
        for (let k = activeIdx; k < app._spreadsList.length; k++) {
          delete app._layoutCache[app._spreadsList[k]];
        }
      }
    }

    if (app.engine) {
      try {
        await layoutDocument(app.engine, app._docPath, {
          activeSpreadId: app._activeSpreadId,
          layoutCache: app._layoutCache
        });
      } catch (layoutErr) {
        console.warn('Failed to propagate flow offsets across spreads:', layoutErr);
      }
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
    flowAnchors: app.flowAnchors || {},
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
