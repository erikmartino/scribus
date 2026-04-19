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
 * Decode a TIFF from an OPFS file using SourceCustom for streaming I/O.
 * The file is read via a synchronous access handle (only available in Workers).
 *
 * When scale > 1, vips resizes the image before writing raw output,
 * so only the downscaled pixels cross the IPC boundary.
 *
 * @param {string} opfsFileName
 * @param {number} scale - downscale factor (1 = no downscaling)
 */
async function decodeFromOPFS(opfsFileName, scale) {
  await initPromise;

  const root = await navigator.storage.getDirectory();
  const fileHandle = await root.getFileHandle(opfsFileName);
  const accessHandle = await fileHandle.createSyncAccessHandle();

  let position = 0;
  const fileSize = accessHandle.getSize();

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

  let image;
  try {
    image = vips.Image.newFromSource(source, '', {
      access: vips.Access.sequential,
    });
  } catch (err) {
    accessHandle.close();
    source.delete();
    throw new Error('vips decode failed: ' + err.message);
  }

  const srcWidth = image.width;
  const srcHeight = image.height;

  // Colour-space + band normalization before resize so vips can
  // operate on a consistent 4-band sRGB uchar image.
  let rgbaImage = ensureRGBA(image);

  // --- Downscale via vips shrink (box averaging) ---
  // shrink() uses simple box averaging which only needs `scale` rows buffered,
  // making it compatible with sequential access.  resize() uses Lanczos3
  // which needs a large vertical context window and defeats sequential mode.
  let outputImage = rgbaImage;
  if (scale > 1) {
    const shrunk = rgbaImage.shrink(scale, scale);
    if (shrunk !== rgbaImage) {
      if (rgbaImage !== image) rgbaImage.delete();
      outputImage = shrunk;
    }
  }

  const outWidth = outputImage.width;
  const outHeight = outputImage.height;

  self.postMessage({ type: 'header', srcWidth, srcHeight, outWidth, outHeight });
  self.postMessage({ type: 'log', message: `TIFF decode: ${srcWidth}x${srcHeight} → ${outWidth}x${outHeight}, file=${(fileSize / 1048576).toFixed(1)}MB` });

  // --- Emit downscaled rows via TargetCustom ---
  const rowBytes = outWidth * 4;
  let y = 0;

  // Accumulate up to ROW_BATCH_SIZE rows before sending a single
  // postMessage with a transferred buffer.
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
  if (outputImage !== image) outputImage.delete();
  if (rgbaImage !== image && rgbaImage !== outputImage) rgbaImage.delete();
  image.delete();
  source.delete();
  accessHandle.close();

  self.postMessage({ type: 'end' });
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
