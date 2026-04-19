// @ts-check

/**
 * Web Worker that runs wasm-vips with streaming I/O via OPFS.
 *
 * Protocol (postMessage):
 *   Main -> Worker:
 *     { type: 'decode', opfsFileName: string, scale: number }
 *
 *   Worker -> Main:
 *     { type: 'header', width, height }
 *     { type: 'row',    rowIndex, rgba: Uint8Array }  (transferable)
 *     { type: 'end' }
 *     { type: 'error',  message: string }
 *     { type: 'log',    message: string }
 *
 * The caller is responsible for writing the image data to OPFS before
 * sending the 'decode' message, and for cleaning up the OPFS file after
 * 'end' or 'error'.
 *
 * @module vips-worker
 */

const VIPS_CDN = 'https://cdn.jsdelivr.net/npm/wasm-vips@0.0.17/lib/vips-es6.js';

let vips = null;

/**
 * Initialize wasm-vips (once).
 */
async function initVips() {
  if (vips) return;

  const Vips = (await import(VIPS_CDN)).default;
  vips = await Vips({
    mainScriptUrlOrBlob: VIPS_CDN,
    locateFile: (fileName) =>
      `https://cdn.jsdelivr.net/npm/wasm-vips@0.0.17/lib/${fileName}`,
  });
}

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
 * @param {string} opfsFileName
 * @param {number} _scale - unused here but forwarded for future tile support
 */
async function decodeFromOPFS(opfsFileName, _scale) {
  await initVips();

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

  const width = image.width;
  const height = image.height;

  self.postMessage({ type: 'header', width, height });
  self.postMessage({ type: 'log', message: `TIFF streaming decode: ${width}x${height}, file=${(fileSize / 1048576).toFixed(1)}MB` });

  const rgbaImage = ensureRGBA(image);

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
        // Transfer a copy so the main thread owns the buffer
        const rowCopy = new Uint8Array(leftover);
        self.postMessage(
          { type: 'row', rowIndex: y, rgba: rowCopy },
          [rowCopy.buffer]
        );
        y++;
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
