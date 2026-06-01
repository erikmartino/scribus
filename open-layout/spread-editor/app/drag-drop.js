import { loadAssets } from '../../document-store/lib/document-store.js';
import { blobToDataUrl, prepareImageAsset } from './clipboard.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

/** Set up HTML5 drag-and-drop for image files and document assets on the container. */
export function initDragDrop(app) {
  const container = app.container;
  let dragCounter = 0;  // Track nested dragenter/dragleave

  const isAcceptableDrag = (e) => {
    return e.dataTransfer?.types?.includes('Files') || e.dataTransfer?.types?.includes('application/x-scribus-asset');
  };

  container.addEventListener('dragover', (e) => {
    if (!isAcceptableDrag(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  });

  container.addEventListener('dragenter', (e) => {
    if (!isAcceptableDrag(e)) return;
    e.preventDefault();
    dragCounter++;
    if (dragCounter === 1) {
      showDropHighlight(app);
    }
  });

  container.addEventListener('dragleave', (e) => {
    if (!isAcceptableDrag(e)) return;
    dragCounter--;
    if (dragCounter <= 0) {
      dragCounter = 0;
      hideDropHighlight(app);
    }
  });

  container.addEventListener('drop', async (e) => {
    e.preventDefault();
    dragCounter = 0;
    hideDropHighlight(app);

    // Convert drop point to content-space coordinates
    const svg = app._svg;
    if (!svg) return;
    const ctm = svg.getScreenCTM();
    if (!ctm) return;
    const contentPt = new DOMPoint(e.clientX, e.clientY)
      .matrixTransform(ctm.inverse());

    // 1. Check for custom document asset drag & drop
    if (e.dataTransfer?.types?.includes('application/x-scribus-asset')) {
      const dataStr = e.dataTransfer.getData('application/x-scribus-asset');
      if (dataStr) {
        try {
          const assetData = JSON.parse(dataStr);
          const assetRef = assetData.assetRef;
          const ext = assetData.ext || 'jpg';

          // Check if dropped on an existing image frame
          const hitImageBox = app.imageBoxes.find(b =>
            contentPt.x >= b.x && contentPt.x <= b.x + b.width &&
            contentPt.y >= b.y && contentPt.y <= b.y + b.height
          );

          if (hitImageBox) {
            const meta = app._assets?.[assetRef] || {};
            const preview = meta.preview || `${assetRef}.${ext}`;
            const imageUrl = `/store/${app._docPath}/assets/${assetRef}/${preview}`;
            app.submitAction('Replace Image in Frame', () => {
              hitImageBox.imageUrl = imageUrl;
              hitImageBox.assetRef = assetRef;
              hitImageBox.assetExt = ext;
            });
          } else {
            await placeAssetBoxAt(app, assetRef, ext, contentPt.x, contentPt.y);
          }
        } catch (err) {
          console.error('Error parsing asset drop data:', err);
        }
      }
      return;
    }

    // 2. Fallback to external files drag & drop
    const files = e.dataTransfer?.files;
    if (!files || files.length === 0) return;

    // Process each image file
    for (const file of files) {
      if (!file.type.startsWith('image/')) continue;
      if (app.mode === 'text') {
        // Insert inline image at cursor position
        const dataUrl = await blobToDataUrl(file);
        app.submitAction('Drop Inline Image', () => {
          const run = {
            text: '\uFFFC',
            style: { bold: false, italic: false, inlineImage: dataUrl },
          };
          app.editor.insertStory([[run]]);
        });
      } else {
        // Place image box at drop coordinates (upload as asset if possible)
        await placeImageBoxAt(app, file, file.name, contentPt.x, contentPt.y);
      }
    }
  });
}

/** Show a drop-zone highlight in the overlay SVG. */
export function showDropHighlight(app) {
  if (!app._overlaySvg || !app._svg) return;
  // Remove any existing highlight
  hideDropHighlight(app);

  const overlay = app._overlaySvg;
  const vw = parseFloat(overlay.getAttribute('width') || '0');
  const vh = parseFloat(overlay.getAttribute('height') || '0');
  if (!vw || !vh) return;

  const rect = document.createElementNS(SVG_NS, 'rect');
  rect.setAttribute('x', '0');
  rect.setAttribute('y', '0');
  rect.setAttribute('width', String(vw));
  rect.setAttribute('height', String(vh));
  rect.setAttribute('fill', 'rgba(47, 110, 164, 0.08)');
  rect.setAttribute('stroke', '#2f6ea4');
  rect.setAttribute('stroke-width', '2');
  rect.setAttribute('stroke-dasharray', '8 4');
  rect.setAttribute('rx', '4');
  rect.setAttribute('data-drop-highlight', 'true');
  rect.style.pointerEvents = 'none';
  overlay.appendChild(rect);
}

/** Remove the drop-zone highlight from the overlay SVG. */
export function hideDropHighlight(app) {
  if (!app._overlaySvg) return;
  const el = app._overlaySvg.querySelector('[data-drop-highlight]');
  if (el) el.remove();
}

/**
 * Place an image box at a specific content-space position.
 * Used by drag-and-drop to place images where the user drops them.
 */
export async function placeImageBoxAt(app, blob, filename, cx, cy) {
  if (!app.currentSpread) return;
  const asset = await prepareImageAsset(app, blob, filename);

  const maxW = 300;
  const scale = Math.min(1, maxW / asset.width);
  const w = asset.width * scale;
  const h = asset.height * scale;

  const x = cx - w / 2;
  const y = cy - h / 2;

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

  app.submitAction('Drop Image', () => {
    app.imageBoxes = [...app.imageBoxes, imageBox];
    app.selectedBoxId = boxId;
  });
}

export async function placeAssetBoxAt(app, assetRef, ext, cx, cy) {
  if (!app.currentSpread) return;

  const meta = app._assets?.[assetRef] || {};
  const width = meta.width || 300;
  const height = meta.height || 200;
  const preview = meta.preview || `${assetRef}.${ext}`;
  const imageUrl = `/store/${app._docPath}/assets/${assetRef}/${preview}`;

  const maxW = 300;
  const scale = Math.min(1, maxW / width);
  const w = width * scale;
  const h = height * scale;

  const x = cx - w / 2;
  const y = cy - h / 2;

  const boxId = `image-${++app._imageBoxCounter}`;
  const imageBox = {
    id: boxId,
    x, y, width: w, height: h,
    minWidth: 20, minHeight: 20,
    imageUrl,
    imgWidth: width,
    imgHeight: height,
    placement: { fitMode: 'cover', alignH: 'center', alignV: 'center' },
    ...(assetRef ? { assetRef, assetExt: ext } : {}),
  };

  app.submitAction('Drop Asset', () => {
    app.imageBoxes = [...app.imageBoxes, imageBox];
    app.selectedBoxId = boxId;
  });
}
