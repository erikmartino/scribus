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
 * @param {ReadableStream<Uint8Array> | ArrayBuffer} source
 * @param {TiffCallbacks} callbacks
 * @param {{ onProgress?: (bytes: number) => void }} [opts]
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
          removeOPFSFile(opfsFileName);
          resolve();
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
    const vipsUrl = 'https://cdn.jsdelivr.net/npm/wasm-vips@0.0.17/lib/vips-es6.js';
    const Vips = (await import(vipsUrl)).default;

    const workerCode = `import "${vipsUrl}";`;
    const blob = new Blob([workerCode], { type: 'application/javascript' });
    const blobUrl = URL.createObjectURL(blob);

    vips = await Vips({
      mainScriptUrlOrBlob: blobUrl,
      locateFile: (fileName) =>
        `https://cdn.jsdelivr.net/npm/wasm-vips@0.0.17/lib/${fileName}`,
    });

    URL.revokeObjectURL(blobUrl);
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
  const utifModule = await import('https://esm.sh/utif2@4.1.0');
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
 */
export async function decodeTiff(source, callbacks, opts = {}) {
  if (canUseStreamingDecode()) {
    return decodeTiffStreaming(source, callbacks, opts);
  }

  // Buffer path: need an ArrayBuffer
  const buffer = source instanceof ArrayBuffer
    ? source
    : await streamToBuffer(source, opts.onProgress);

  return decodeTiffBuffer(buffer, callbacks);
}

// Eagerly construct the Worker so wasm-vips starts downloading immediately
// when the page loads, rather than waiting for the first decode request.
warmUpWorker();
