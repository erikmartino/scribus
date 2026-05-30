// @ts-check

/**
 * TIFF decoder with streaming support via OPFS + Web Worker.
 *
 * When the browser supports OPFS, the image file is streamed to disk first,
 * then a Worker decodes it using wasm-vips SourceCustom backed by a
 * synchronous access handle. This keeps peak RAM close to the output size
 * rather than the input size.
 *
 * Falls back to in-memory buffer decode when OPFS is unavailable.
 *
 * @module tiff-decoder
 */

/**
 * @typedef {Object} TiffCallbacks
 * @property {(header: { width: number, height: number, outWidth?: number, outHeight?: number }) => void} onHeader
 * @property {(rowIndex: number, rgba: Uint8Array) => void} onRow
 * @property {() => void} onEnd
 * @property {number} scale
 */

/**
 * @typedef {Object} DecodeResult
 * @property {string | null} opfsFileName - OPFS staging file name (null if buffer fallback was used).
 *   The caller is responsible for calling cleanupOPFS(opfsFileName) when the file is no longer needed.
 */

/** @type {Worker | null} */
let worker = null;

/**
 * Check whether the streaming OPFS path is available.
 * Requires: OPFS, Worker, SharedArrayBuffer (for wasm-vips threads).
 */
function canUseStreamingDecode() {
  return (
    typeof navigator !== 'undefined' &&
    typeof navigator.storage?.getDirectory === 'function' &&
    typeof Worker !== 'undefined' &&
    typeof SharedArrayBuffer !== 'undefined'
  );
}

/**
 * Pre-warm the vips Worker so wasm-vips is downloaded and compiled
 * before the first decode request. Called at module load time.
 */
function warmUpWorker() {
  if (canUseStreamingDecode()) {
    getWorker();
  }
}

/**
 * Stream a ReadableStream (from fetch or File.stream()) into an OPFS file.
 *
 * @param {ReadableStream<Uint8Array>} stream
 * @param {string} fileName
 * @param {(bytes: number) => void} [onProgress]
 * @returns {Promise<void>}
 */
async function streamToOPFS(stream, fileName, onProgress) {
  const root = await navigator.storage.getDirectory();
  const handle = await root.getFileHandle(fileName, { create: true });
  const writable = await handle.createWritable();
  const reader = stream.getReader();
  let totalBytes = 0;

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      await writable.write(value);
      totalBytes += value.byteLength;
      if (onProgress) onProgress(totalBytes);
    }
  } finally {
    await writable.close();
  }
}

/**
 * Remove an OPFS temp file (best-effort).
 * @param {string} fileName
 */
async function removeOPFSFile(fileName) {
  try {
    const root = await navigator.storage.getDirectory();
    await root.removeEntry(fileName);
  } catch { /* ignore */ }
}

/**
 * Get or create the vips Worker.
 * @returns {Worker}
 */
function getWorker() {
  if (!worker) {
    worker = new Worker(new URL('./vips-worker.js', import.meta.url), {
      type: 'module',
    });
  }
  return worker;
}

/**
 * Decode a TIFF via the streaming OPFS + Worker path.
 *
 * The OPFS staging file is NOT deleted on completion — the caller
 * can use it for subsequent export operations.  Call
 * `cleanupOPFS(result.opfsFileName)` when the file is no longer needed.
 *
 * @param {ReadableStream<Uint8Array> | ArrayBuffer} source
 * @param {TiffCallbacks} callbacks
 * @param {{ onProgress?: (bytes: number) => void }} [opts]
 * @returns {Promise<DecodeResult>}
 */
async function decodeTiffStreaming(source, callbacks, opts = {}) {
  const opfsFileName = `tiff-decode-${Date.now()}-${Math.random().toString(36).slice(2)}.tmp`;

  // Step 1: Stream source data into OPFS
  /** @type {ReadableStream<Uint8Array>} */
  let stream;
  if (source instanceof ArrayBuffer) {
    // Wrap the buffer in a stream — still avoids a second copy
    stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array(source));
        controller.close();
      },
    });
  } else {
    stream = source;
  }

  await streamToOPFS(stream, opfsFileName, opts.onProgress);

  // Step 2: Delegate decoding to the Worker
  const w = getWorker();

  return new Promise((resolve, reject) => {
    w.onmessage = (e) => {
      const msg = e.data;

      switch (msg.type) {
        case 'header':
          callbacks.onHeader({
            width: msg.srcWidth,
            height: msg.srcHeight,
            outWidth: msg.outWidth,
            outHeight: msg.outHeight,
          });
          break;

        case 'rows': {
          // Batched rows: unpack and deliver individually to the callback
          const { startRow, count, rgba } = msg;
          const rowBytes = rgba.byteLength / count;
          for (let i = 0; i < count; i++) {
            const off = i * rowBytes;
            callbacks.onRow(startRow + i, rgba.subarray(off, off + rowBytes));
          }
          break;
        }

        case 'end':
          callbacks.onEnd();
          // Keep OPFS file for export — caller must call cleanupOPFS()
          resolve({ opfsFileName });
          break;

        case 'error':
          removeOPFSFile(opfsFileName);
          reject(new Error(msg.message));
          break;

        case 'log':
          console.log('[vips-worker]', msg.message);
          break;

        case 'ready':
          // Worker finished loading wasm-vips (pre-warm complete)
          break;
      }
    };

    w.onerror = (err) => {
      removeOPFSFile(opfsFileName);
      reject(new Error(err.message || 'Worker error'));
    };

    w.postMessage({
      type: 'decode',
      opfsFileName,
      scale: callbacks.scale,
    });
  });
}

// --- Fallback: in-memory decode via wasm-vips on the main thread ---

let vips = null;

/**
 * Ensure the vips image has exactly 4 bands of uchar sRGB + alpha.
 */
function ensureRGBA(vipsModule, srcImage) {
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
 * Fallback: decode TIFF from an ArrayBuffer on the main thread.
 *
 * @param {ArrayBuffer} buffer
 * @param {TiffCallbacks} callbacks
 */
async function decodeTiffBuffer(buffer, callbacks) {
  if (!vips) {
    const vipsUrl = '/vendor/wasm-vips/vips-es6.js';
    const Vips = (await import(vipsUrl)).default;

    vips = await Vips({
      mainScriptUrlOrBlob: new URL(vipsUrl, location.href).href,
      locateFile: (fileName) => new URL(`/vendor/wasm-vips/${fileName}`, location.href).href,
    });
  }

  let image;
  try {
    image = vips.Image.newFromBuffer(buffer, '', {
      access: vips.Access.sequential,
    });
  } catch (err) {
    if (
      err.message.includes('out of range') ||
      err.message.includes('tiff2vips')
    ) {
      console.warn(
        `wasm-vips rejected TIFF (${err.message}). Falling back to utif2...`
      );
      return decodeTiffFallback(buffer, callbacks);
    }
    throw new Error('wasm-vips decode failed: ' + err.message);
  }

  const width = image.width;
  const height = image.height;

  callbacks.onHeader({ width, height });

  const rgbaImage = ensureRGBA(vips, image);

  console.log('TIFF decoded via wasm-vips (buffer):', { width, height });

  const rowBytes = width * 4;
  let y = 0;
  const leftover = new Uint8Array(rowBytes);
  let leftoverBytes = 0;

  const target = new vips.TargetCustom();
  target.onWrite = (chunk) => {
    let offset = 0;
    while (offset < chunk.length) {
      const needed = rowBytes - leftoverBytes;
      const available = chunk.length - offset;

      if (available >= needed) {
        leftover.set(chunk.subarray(offset, offset + needed), leftoverBytes);
        callbacks.onRow(y++, leftover);
        offset += needed;
        leftoverBytes = 0;
      } else {
        leftover.set(chunk.subarray(offset, chunk.length), leftoverBytes);
        leftoverBytes += available;
        break;
      }
    }
    return chunk.length;
  };

  rgbaImage.writeToTarget(target, '.raw');

  target.delete();
  if (rgbaImage !== image) rgbaImage.delete();
  image.delete();

  callbacks.onEnd();
}

/**
 * Fallback to utif2 for TIFFs that wasm-vips rejects.
 */
async function decodeTiffFallback(buffer, callbacks) {
  const utifModule = await import('/vendor/utif2/index.js');
  const UTIF = utifModule.default || utifModule;

  const ifds = UTIF.decode(buffer);
  const imageIfds = ifds.filter((f) => f.t256 && f.t257);
  if (imageIfds.length === 0)
    throw new Error('No image IFDs found in TIFF');

  const ifd = imageIfds[0];
  UTIF.decodeImage(buffer, ifd);

  const rgba8 = new Uint8Array(UTIF.toRGBA8(ifd));
  const width = ifd.t256[0];
  const height = ifd.t257[0];

  callbacks.onHeader({ width, height });

  const rowBytes = width * 4;
  for (let y = 0; y < height; y++) {
    const off = y * rowBytes;
    callbacks.onRow(y, rgba8.subarray(off, off + rowBytes));
  }

  callbacks.onEnd();
}

// --- Public API ---

/**
 * Whether the fast streaming OPFS+Worker path is available.
 * Exported so callers can branch before choosing between stageToOPFS
 * and a buffer-based fallback.
 */
export { canUseStreamingDecode };

/**
 * Stream a source (ReadableStream or ArrayBuffer) into an OPFS staging file
 * and return the file name.  The caller is responsible for calling
 * cleanupOPFS(fileName) when done.
 *
 * Throws if OPFS is not available (use canUseStreamingDecode() to check).
 *
 * @param {ReadableStream<Uint8Array> | ArrayBuffer} source
 * @param {{ onProgress?: (bytes: number) => void }} [opts]
 * @returns {Promise<string>} opfsFileName
 */
export async function stageToOPFS(source, opts = {}) {
  if (!canUseStreamingDecode()) {
    throw new Error('OPFS is not available in this context');
  }
  const opfsFileName = `stage-${Date.now()}-${Math.random().toString(36).slice(2)}.tmp`;
  let stream;
  if (source instanceof ArrayBuffer) {
    stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array(source));
        controller.close();
      },
    });
  } else {
    stream = source;
  }
  await streamToOPFS(stream, opfsFileName, opts.onProgress);
  return opfsFileName;
}

/**
 * Consume a ReadableStream into a single ArrayBuffer.
 *
 * @param {ReadableStream<Uint8Array>} stream
 * @param {(bytes: number) => void} [onProgress]
 * @returns {Promise<ArrayBuffer>}
 */
async function streamToBuffer(stream, onProgress) {
  const reader = stream.getReader();
  const chunks = [];
  let totalBytes = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    chunks.push(value);
    totalBytes += value.byteLength;
    if (onProgress) onProgress(totalBytes);
  }
  const merged = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return merged.buffer;
}

/**
 * Decode a TIFF and emit rows.
 *
 * Automatically selects the streaming OPFS path when available,
 * falling back to the in-memory buffer path otherwise.
 *
 * A ReadableStream can only be consumed once. If the streaming path
 * is selected, the stream is written to OPFS and cannot be re-read.
 * Therefore the streaming path does NOT fall back to the buffer path
 * after the stream has been consumed — any Worker-side decode error
 * propagates directly.
 *
 * @param {ArrayBuffer | ReadableStream<Uint8Array>} source
 * @param {TiffCallbacks} callbacks
 * @param {{ onProgress?: (bytes: number) => void }} [opts]
 * @returns {Promise<DecodeResult>}
 */
export async function decodeTiff(source, callbacks, opts = {}) {
  if (canUseStreamingDecode()) {
    return decodeTiffStreaming(source, callbacks, opts);
  }

  // Buffer path: need an ArrayBuffer
  const buffer = source instanceof ArrayBuffer
    ? source
    : await streamToBuffer(source, opts.onProgress);

  await decodeTiffBuffer(buffer, callbacks);
  return { opfsFileName: null };
}

/**
 * Export a downscaled image from an OPFS staging file.
 *
 * The Worker reads the OPFS file, creates a thumbnail at the given scale,
 * and writes it to the requested format. Returns a Blob ready for download
 * or upload.
 *
 * @param {string} opfsFileName - the staging file from a previous decodeTiff() call
 * @param {object} opts
 * @param {number} [opts.scale=1] - downscale factor
 * @param {number} [opts.quality=85] - JPEG quality (1-100)
 * @param {'jpeg'|'png'} [opts.format='jpeg'] - output format
 * @returns {Promise<{ blob: Blob, width: number, height: number }>}
 */
export async function exportImage(opfsFileName, opts = {}) {
  const { scale = 1, quality = 85, format = 'jpeg' } = opts;

  if (!canUseStreamingDecode()) {
    throw new Error('Export requires OPFS + Worker support');
  }

  const w = getWorker();

  return new Promise((resolve, reject) => {
    /** @param {MessageEvent} e */
    function onMessage(e) {
      const msg = e.data;
      if (msg.type === 'exported') {
        w.removeEventListener('message', onMessage);
        w.removeEventListener('error', onError);
        const blob = new Blob([msg.buffer], { type: msg.mimeType });
        resolve({ blob, width: msg.width, height: msg.height });
      } else if (msg.type === 'error') {
        w.removeEventListener('message', onMessage);
        w.removeEventListener('error', onError);
        reject(new Error(msg.message));
      } else if (msg.type === 'log') {
        console.log('[vips-worker]', msg.message);
      }
    }

    /** @param {ErrorEvent} err */
    function onError(err) {
      w.removeEventListener('message', onMessage);
      w.removeEventListener('error', onError);
      reject(new Error(err.message || 'Worker error'));
    }

    w.addEventListener('message', onMessage);
    w.addEventListener('error', onError);

    w.postMessage({ type: 'export', opfsFileName, scale, quality, format });
  });
}

/**
 * Remove an OPFS staging file. Call this when the file is no longer
 * needed (e.g. after export, or when starting a new decode).
 *
 * @param {string | null} opfsFileName
 */
export async function cleanupOPFS(opfsFileName) {
  if (opfsFileName) {
    await removeOPFSFile(opfsFileName);
  }
}

/**
 * Terminate the current vips Worker and immediately pre-warm a replacement.
 *
 * wasm linear memory is fixed-size and never shrinks. After processing a large
 * TIFF the wasm heap is nearly exhausted — a second large allocation will
 * Abort(). Terminating and recreating the Worker gives each export a fresh
 * wasm heap, at the cost of re-downloading and re-compiling wasm-vips (which
 * is cached by the browser after the first load).
 *
 * Call this in the `finally` block after each TIFF export when multiple large
 * files are processed sequentially.
 */
export function resetVipsWorker() {
  if (worker) {
    worker.terminate();
    worker = null;
  }
  // Pre-warm a replacement immediately so wasm-vips is ready for the next asset
  warmUpWorker();
}

// Eagerly construct the Worker so wasm-vips starts downloading immediately
// when the page loads, rather than waiting for the first decode request.
warmUpWorker();
