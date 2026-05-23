// @ts-check

/**
 * Web Worker that runs wasm-vips with streaming I/O via OPFS.
 *
 * Protocol (postMessage):
 *   Main -> Worker:
 *     { type: 'decode',  opfsFileName: string, scale: number }
 *     { type: 'export',  opfsFileName: string, scale: number, quality?: number, format?: string }
 *
 *   Worker -> Main:
 *     { type: 'header',  srcWidth, srcHeight, outWidth, outHeight }
 *     { type: 'rows',    startRow, count, rgba: Uint8Array }  (transferable, batched)
 *     { type: 'end' }
 *     { type: 'exported', buffer: ArrayBuffer, mimeType: string, width, height }
 *     { type: 'error',   message: string }
 *     { type: 'log',     message: string }
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
 * Read an entire OPFS file into a Uint8Array in one shot.
 * Much faster than thousands of small SourceCustom onRead callbacks.
 *
 * @param {string} opfsFileName
 * @returns {Promise<Uint8Array>}
 */
async function readOPFSFile(opfsFileName) {
  const root = await navigator.storage.getDirectory();
  const fileHandle = await root.getFileHandle(opfsFileName);
  const accessHandle = await fileHandle.createSyncAccessHandle();
  try {
    const fileSize = accessHandle.getSize();
    const buffer = new Uint8Array(fileSize);
    accessHandle.read(buffer, { at: 0 });
    return buffer;
  } finally {
    accessHandle.close();
  }
}

/**
 * Decode a TIFF from an OPFS file and emit rows for canvas rendering.
 *
 * Reads the file in bulk into memory, then uses thumbnailBuffer (scale > 1)
 * or newFromBuffer (scale = 1). This avoids the overhead of thousands of
 * SourceCustom callbacks while still using OPFS as the staging layer.
 *
 * thumbnailBuffer is pyramid-aware: for pyramidal TIFFs it reads an
 * appropriate sub-IFD level directly instead of decoding the full image.
 *
 * @param {string} opfsFileName
 * @param {number} scale - downscale factor (1 = no downscaling)
 */
async function decodeFromOPFS(opfsFileName, scale) {
  await initPromise;

  const fileData = await readOPFSFile(opfsFileName);
  const fileSizeMB = (fileData.byteLength / 1048576).toFixed(1);

  // Get source dimensions from header (lazy, fast)
  const headerImg = vips.Image.newFromBuffer(fileData);
  const srcWidth = headerImg.width;
  const srcHeight = headerImg.height;
  headerImg.delete();

  let outputImage;
  if (scale > 1) {
    const targetWidth = Math.max(1, Math.floor(srcWidth / scale));
    outputImage = vips.Image.thumbnailBuffer(fileData, targetWidth, {
      size: vips.Size.down,
    });
  } else {
    const image = vips.Image.newFromBuffer(fileData, '', {
      access: vips.Access.sequential,
    });
    outputImage = ensureRGBA(image);
    if (outputImage !== image) image.delete();
  }

  // thumbnailBuffer handles colorspace, but ensure 4-band uchar RGBA
  if (scale > 1) {
    const tmp = outputImage;
    outputImage = ensureRGBA(tmp);
    if (outputImage !== tmp) tmp.delete();
  }

  const outWidth = outputImage.width;
  const outHeight = outputImage.height;

  self.postMessage({ type: 'header', srcWidth, srcHeight, outWidth, outHeight });
  self.postMessage({
    type: 'log',
    message: scale > 1
      ? `TIFF thumbnail: ${srcWidth}x${srcHeight} → ${outWidth}x${outHeight}, scale=${scale}, file=${fileSizeMB}MB`
      : `TIFF decode: ${srcWidth}x${srcHeight}, file=${fileSizeMB}MB`,
  });

  emitRows(outputImage, outWidth, outHeight);
  outputImage.delete();

  self.postMessage({ type: 'end' });
}

/**
 * Export a downscaled JPEG (or PNG) from an OPFS file.
 *
 * Reads the file in bulk, creates a thumbnail, and writes to the
 * requested format. The compressed buffer is sent back via postMessage
 * with transfer (zero-copy).
 *
 * @param {string} opfsFileName
 * @param {number} scale
 * @param {number} quality - JPEG quality 1-100
 * @param {string} format - 'jpeg' or 'png'
 */
async function exportFromOPFS(opfsFileName, scale, quality, format) {
  await initPromise;

  const fileData = await readOPFSFile(opfsFileName);

  let image;
  if (scale > 1) {
    const headerImg = vips.Image.newFromBuffer(fileData);
    const targetWidth = Math.max(1, Math.floor(headerImg.width / scale));
    headerImg.delete();

    image = vips.Image.thumbnailBuffer(fileData, targetWidth, {
      size: vips.Size.down,
    });
  } else {
    image = vips.Image.newFromBuffer(fileData);
  }

  // Ensure correct band count for output
  let outputImage = ensureRGBA(image);

  const outWidth = outputImage.width;
  const outHeight = outputImage.height;

  let outBuffer, mimeType, suffix;
  if (format === 'png') {
    outBuffer = outputImage.writeToBuffer('.png');
    mimeType = 'image/png';
    suffix = '.png';
  } else {
    // For JPEG: drop alpha channel (JPEG doesn't support it)
    let jpegImage = outputImage;
    if (outputImage.bands === 4) {
      jpegImage = outputImage.flatten({ background: [255, 255, 255] });
    }
    outBuffer = jpegImage.writeToBuffer('.jpg', { Q: quality });
    mimeType = 'image/jpeg';
    suffix = '.jpg';
    if (jpegImage !== outputImage) jpegImage.delete();
  }

  if (outputImage !== image) outputImage.delete();
  image.delete();

  // Transfer the buffer (zero-copy) to the main thread
  const ab = outBuffer.buffer.slice(
    outBuffer.byteOffset,
    outBuffer.byteOffset + outBuffer.byteLength,
  );

  self.postMessage(
    { type: 'exported', buffer: ab, mimeType, width: outWidth, height: outHeight },
    [ab],
  );
}

// --- Worker message handler ---
self.onmessage = async (e) => {
  const msg = e.data;

  try {
    switch (msg.type) {
      case 'decode':
        await decodeFromOPFS(msg.opfsFileName, msg.scale);
        break;

      case 'export':
        await exportFromOPFS(
          msg.opfsFileName,
          msg.scale,
          msg.quality ?? 85,
          msg.format ?? 'jpeg',
        );
        break;
    }
  } catch (err) {
    self.postMessage({ type: 'error', message: err.message || String(err) });
  }
};
