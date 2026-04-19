// @ts-check

/**
 * Web Worker that runs wasm-vips with streaming I/O via OPFS.
 *
 * Protocol (postMessage):
 *   Main -> Worker:
 *     { type: 'decode', opfsFileName: string, scale: number }
 *
 *   Worker -> Main:
 *     { type: 'header', srcWidth, srcHeight, outWidth, outHeight }
 *     { type: 'rows',   startRow, count, rgba: Uint8Array }  (transferable, batched)
 *     { type: 'end' }
 *     { type: 'error',  message: string }
 *     { type: 'log',    message: string }
 *     { type: 'ready' }
 *
 * The caller is responsible for writing the image data to OPFS before
 * sending the 'decode' message, and for cleaning up the OPFS file after
 * 'end' or 'error'.
 *
 * @module vips-worker
 */

const VIPS_CDN = 'https://cdn.jsdelivr.net/npm/wasm-vips@0.0.17/lib/vips-es6.js';

/** How many rows to batch into a single postMessage. */
const ROW_BATCH_SIZE = 32;

let vips = null;

/** @type {Promise<void>} */
let initPromise;

/**
 * Initialize wasm-vips (once).
 *
 * wasm-vips uses `mainScriptUrlOrBlob` to spawn internal threading Workers.
 * A cross-origin CDN URL would be rejected by the browser, so we wrap it
 * in a same-origin blob URL that simply re-exports the CDN module.
 */
async function initVips() {
  if (vips) return;

  const Vips = (await import(VIPS_CDN)).default;

  const workerCode = `import "${VIPS_CDN}";`;
  const blob = new Blob([workerCode], { type: 'application/javascript' });
  const blobUrl = URL.createObjectURL(blob);

  vips = await Vips({
    mainScriptUrlOrBlob: blobUrl,
    locateFile: (fileName) =>
      `https://cdn.jsdelivr.net/npm/wasm-vips@0.0.17/lib/${fileName}`,
  });

  URL.revokeObjectURL(blobUrl);
  self.postMessage({ type: 'ready' });
}

// Start loading wasm-vips immediately when the Worker is constructed,
// not on the first decode request.
initPromise = initVips().catch((err) => {
  self.postMessage({ type: 'error', message: 'vips init failed: ' + err.message });
});

/**
 * Ensure the vips image has exactly 4 bands of uchar sRGB + alpha.
 * Handles 1–N band images correctly.
 */
function ensureRGBA(srcImage) {
  let img = srcImage;
  const intermediates = [];

  function advance(next) {
    if (next !== srcImage) intermediates.push(next);
    img = next;
  }

  try {
    if (img.interpretation !== 'srgb' && img.interpretation !== 'b-w') {
      advance(img.colourspace('srgb'));
    }

    if (img.format !== 'uchar') {
      advance(img.cast('uchar'));
    }

    if (img.bands === 1) {
      const rgb = img.bandjoin([img, img]);
      advance(rgb);
      advance(img.bandjoin(255));
    } else if (img.bands === 2) {
      const grey = img.extract_band(0);
      const alpha = img.extract_band(1);
      const rgb = grey.bandjoin([grey, grey]);
      const rgba = rgb.bandjoin(alpha);
      grey.delete();
      alpha.delete();
      rgb.delete();
      advance(rgba);
    } else if (img.bands === 3) {
      advance(img.bandjoin(255));
    } else if (img.bands > 4) {
      advance(img.extract_band(0, { n: 4 }));
    }

    const result = img;
    for (const tmp of intermediates) {
      if (tmp !== result) tmp.delete();
    }
    return result;
  } catch (err) {
    for (const tmp of intermediates) {
      try { tmp.delete(); } catch { /* ignore */ }
    }
    throw err;
  }
}

/**
 * Create a SourceCustom backed by an OPFS sync access handle.
 *
 * @param {FileSystemSyncAccessHandle} accessHandle
 * @param {number} fileSize
 * @returns {{ source: InstanceType<typeof vips.SourceCustom>, getPosition: () => number, resetPosition: () => void }}
 */
function createOPFSSource(accessHandle, fileSize) {
  let position = 0;

  const source = new vips.SourceCustom();

  source.onRead = (length) => {
    if (position >= fileSize) return undefined;
    const toRead = Math.min(length, fileSize - position);
    const buf = new Uint8Array(toRead);
    const nRead = accessHandle.read(buf, { at: position });
    position += nRead;
    if (nRead === 0) return undefined;
    return buf.subarray(0, nRead);
  };

  source.onSeek = (offset, whence) => {
    if (whence === 0) {        // SEEK_SET
      position = offset;
    } else if (whence === 1) { // SEEK_CUR
      position += offset;
    } else if (whence === 2) { // SEEK_END
      position = fileSize + offset;
    }
    return position;
  };

  return {
    source,
    getPosition: () => position,
    resetPosition: () => { position = 0; },
  };
}

/**
 * Emit an RGBA image as batched rows via postMessage.
 *
 * @param {InstanceType<typeof vips.Image>} outputImage - must be 4-band uchar sRGB
 * @param {number} outWidth
 * @param {number} outHeight
 */
function emitRows(outputImage, outWidth, outHeight) {
  const rowBytes = outWidth * 4;
  let y = 0;

  const batchBytes = rowBytes * ROW_BATCH_SIZE;
  let batch = new Uint8Array(batchBytes);
  let batchStart = 0;
  let batchCount = 0;

  function flushBatch() {
    if (batchCount === 0) return;
    const payload = batch.slice(0, batchCount * rowBytes);
    self.postMessage(
      { type: 'rows', startRow: batchStart, count: batchCount, rgba: payload },
      [payload.buffer]
    );
    batch = new Uint8Array(batchBytes);
    batchCount = 0;
  }

  let leftoverBytes = 0;
  const leftover = new Uint8Array(rowBytes);

  const target = new vips.TargetCustom();
  target.onWrite = (chunk) => {
    let offset = 0;
    while (offset < chunk.length) {
      const needed = rowBytes - leftoverBytes;
      const available = chunk.length - offset;

      if (available >= needed) {
        if (leftoverBytes > 0) {
          leftover.set(chunk.subarray(offset, offset + needed), leftoverBytes);
          batch.set(leftover, batchCount * rowBytes);
        } else {
          batch.set(chunk.subarray(offset, offset + needed), batchCount * rowBytes);
        }

        if (batchCount === 0) batchStart = y;
        batchCount++;
        y++;
        offset += needed;
        leftoverBytes = 0;

        if (batchCount === ROW_BATCH_SIZE) {
          flushBatch();
        }
      } else {
        leftover.set(chunk.subarray(offset, chunk.length), leftoverBytes);
        leftoverBytes += available;
        break;
      }
    }
    return chunk.length;
  };

  outputImage.writeToTarget(target, '.raw');
  flushBatch();
  target.delete();
}

/**
 * Decode a TIFF from an OPFS file using SourceCustom for streaming I/O.
 * The file is read via a synchronous access handle (only available in Workers).
 *
 * When scale > 1, uses thumbnailSource() which is pyramid-aware:
 * for pyramidal TIFFs it reads an appropriate sub-IFD level directly
 * instead of decoding the full-resolution image, then shrinks to target.
 *
 * @param {string} opfsFileName
 * @param {number} scale - downscale factor (1 = no downscaling)
 */
async function decodeFromOPFS(opfsFileName, scale) {
  await initPromise;

  const root = await navigator.storage.getDirectory();
  const fileHandle = await root.getFileHandle(opfsFileName);
  const accessHandle = await fileHandle.createSyncAccessHandle();
  const fileSize = accessHandle.getSize();

  try {
    if (scale > 1) {
      await decodeWithThumbnail(accessHandle, fileSize, scale);
    } else {
      await decodeFullResolution(accessHandle, fileSize);
    }
  } finally {
    accessHandle.close();
  }

  self.postMessage({ type: 'end' });
}

/**
 * Pyramid-aware decode + downscale using thumbnailSource().
 *
 * thumbnailSource picks the best pyramid level automatically, then
 * shrinks to the target width. This avoids decoding the full-resolution
 * image for pyramidal TIFFs.
 *
 * We first do a quick header-only open to get source dimensions (lazy,
 * reads only the IFD), then seek back and call thumbnailSource with
 * the computed target width.
 */
async function decodeWithThumbnail(accessHandle, fileSize, scale) {
  // --- Step 1: header-only open to get source dimensions ---
  // newFromSource is lazy — it only reads the IFD header, not pixel data.
  const { source: headerSource } = createOPFSSource(accessHandle, fileSize);

  let srcWidth, srcHeight;
  try {
    const headerImg = vips.Image.newFromSource(headerSource, '');
    srcWidth = headerImg.width;
    srcHeight = headerImg.height;
    headerImg.delete();
  } finally {
    headerSource.delete();
  }

  // --- Step 2: fresh source (position=0) for thumbnailSource ---
  const { source } = createOPFSSource(accessHandle, fileSize);

  const targetWidth = Math.max(1, Math.floor(srcWidth / scale));

  let image;
  try {
    image = vips.Image.thumbnailSource(source, targetWidth, {
      // size: 'down' means only downsize, never upsize
      size: vips.Size.down,
    });
  } catch (err) {
    source.delete();
    throw new Error('vips thumbnail failed: ' + err.message);
  }

  // thumbnailSource returns sRGB, but we need to ensure 4-band uchar RGBA
  let outputImage = ensureRGBA(image);

  const outWidth = outputImage.width;
  const outHeight = outputImage.height;

  self.postMessage({ type: 'header', srcWidth, srcHeight, outWidth, outHeight });
  self.postMessage({
    type: 'log',
    message: `TIFF thumbnail: ${srcWidth}x${srcHeight} → ${outWidth}x${outHeight}, ` +
      `scale=${scale}, file=${(fileSize / 1048576).toFixed(1)}MB`,
  });

  emitRows(outputImage, outWidth, outHeight);

  if (outputImage !== image) outputImage.delete();
  image.delete();
  source.delete();
}

/**
 * Full-resolution decode (scale=1). Uses sequential access.
 */
async function decodeFullResolution(accessHandle, fileSize) {
  const { source } = createOPFSSource(accessHandle, fileSize);

  let image;
  try {
    image = vips.Image.newFromSource(source, '', {
      access: vips.Access.sequential,
    });
  } catch (err) {
    source.delete();
    throw new Error('vips decode failed: ' + err.message);
  }

  const srcWidth = image.width;
  const srcHeight = image.height;
  let outputImage = ensureRGBA(image);

  const outWidth = outputImage.width;
  const outHeight = outputImage.height;

  self.postMessage({ type: 'header', srcWidth, srcHeight, outWidth, outHeight });
  self.postMessage({
    type: 'log',
    message: `TIFF decode: ${srcWidth}x${srcHeight}, file=${(fileSize / 1048576).toFixed(1)}MB`,
  });

  emitRows(outputImage, outWidth, outHeight);

  if (outputImage !== image) outputImage.delete();
  image.delete();
  source.delete();
}

// --- Worker message handler ---
self.onmessage = async (e) => {
  const msg = e.data;

  if (msg.type === 'decode') {
    try {
      await decodeFromOPFS(msg.opfsFileName, msg.scale);
    } catch (err) {
      self.postMessage({ type: 'error', message: err.message || String(err) });
    }
  }
};
