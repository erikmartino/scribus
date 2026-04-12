// @ts-check

/**
 * TIFF decoder using wasm-vips
 *
 * @module tiff-decoder
 */

/**
 * @typedef {Object} TiffCallbacks
 * @property {(header: { width: number, height: number, tiled: boolean }) => void} onHeader
 * @property {(rowIndex: number, rgba: Uint8Array) => void} onRow
 * @property {(tileX: number, tileY: number, rgba: Uint8Array, tileW: number, tileH: number) => void} [onTile]
 * @property {() => void} onEnd
 * @property {number} scale
 */

let vips = null;

/**
 * Decode a TIFF file and emit rows or tiles.
 *
 * @param {ArrayBuffer} buffer
 * @param {TiffCallbacks} callbacks
 */
export async function decodeTiff(buffer, callbacks) {
  if (!vips) {
    const vipsUrl = 'https://cdn.jsdelivr.net/npm/wasm-vips@0.0.17/lib/vips-es6.js';
    const Vips = (await import(vipsUrl)).default;

    // Cross-origin Module Workers are blocked by default. 
    // We create a local Blob URL to bootstrap the worker on the same origin.
    const workerCode = `import "${vipsUrl}";`;
    const blob = new Blob([workerCode], { type: 'application/javascript' });
    const blobUrl = URL.createObjectURL(blob);

    vips = await Vips({
      mainScriptUrlOrBlob: blobUrl,
      locateFile: (fileName) => `https://cdn.jsdelivr.net/npm/wasm-vips@0.0.17/lib/${fileName}`
    });
    
    URL.revokeObjectURL(blobUrl);
  }

  let image;
  try {
    image = vips.Image.newFromBuffer(buffer, "", { access: vips.Access.sequential });
  } catch (err) {
    if (err.message.includes('out of range') || err.message.includes('tiff2vips')) {
      console.warn(`wasm-vips rejected TIFF (${err.message}). Falling back to utif2 parser...`);
      return decodeTiffFallback(buffer, callbacks);
    }
    throw new Error('wasm-vips decode failed: ' + err.message);
  }

  const width = image.width;
  const height = image.height;

  // For wasm-vips, we extract the image linearly for the box filter downscaler
  callbacks.onHeader({ width, height, tiled: false });

  let rgbaImage = image;

  // Convert to sRGB
  if (rgbaImage.interpretation !== 'srgb') {
    let t = rgbaImage.colourspace('srgb');
    if (rgbaImage !== image) rgbaImage.delete();
    rgbaImage = t;
  }

  // Ensure it has an alpha channel
  if (!rgbaImage.hasAlpha()) {
    let t = rgbaImage.bandjoin(255);
    if (rgbaImage !== image) rgbaImage.delete();
    rgbaImage = t;
  }

  // Ensure uchar format
  if (rgbaImage.format !== 'uchar') {
    let t = rgbaImage.cast('uchar');
    if (rgbaImage !== image) rgbaImage.delete();
    rgbaImage = t;
  }

  // Ensure exactly 4 bands
  if (rgbaImage.bands > 4) {
    let t = rgbaImage.extract_band(0, { n: 4 });
    if (rgbaImage !== image) rgbaImage.delete();
    rgbaImage = t;
  } else if (rgbaImage.bands < 4) {
    let t = rgbaImage.bandjoin(255);
    if (rgbaImage !== image) rgbaImage.delete();
    rgbaImage = t;
  }

  console.log('TIFF decoded via wasm-vips pipeline created:', { width, height });

  const rowBytes = width * 4;
  let y = 0;
  let leftover = new Uint8Array(rowBytes);
  let leftoverBytes = 0;

  const target = new vips.TargetCustom();
  target.onWrite = (chunk) => {
    let offset = 0;
    while (offset < chunk.length) {
      const needed = rowBytes - leftoverBytes;
      const available = chunk.length - offset;
      
      if (available >= needed) {
        // Complete row
        leftover.set(chunk.subarray(offset, offset + needed), leftoverBytes);
        callbacks.onRow(y++, leftover);
        offset += needed;
        leftoverBytes = 0;
      } else {
        // Buffer partial row
        leftover.set(chunk.subarray(offset, chunk.length), leftoverBytes);
        leftoverBytes += available;
        break;
      }
    }
    return chunk.length; // Bytes written
  };

  // Excute the pipeline EXACTLY ONCE, streaming linearly to the target
  rgbaImage.writeToTarget(target, '.raw');

  target.delete(); // Free the target handler

// Free buffers
  if (rgbaImage !== image) {
    rgbaImage.delete();
  }
  image.delete();

  callbacks.onEnd();
}

/**
 * Fallback to pure JavaScript parser for TIFF parameters libvips rejects 
 * (such as 64-bit IEEE floating-point or esoteric color depths).
 */
async function decodeTiffFallback(buffer, callbacks) {
  const utifModule = await import('https://esm.sh/utif2@4.1.0');
  const UTIF = utifModule.default || utifModule;
  
  const ifds = UTIF.decode(buffer);
  const imageIfds = ifds.filter(f => f.t256 && f.t257); // Must have width/height tags
  if (imageIfds.length === 0) throw new Error('No image IFDs found in TIFF');
  
  const ifd = imageIfds[0];
  UTIF.decodeImage(buffer, ifd);
  
  const rgba8 = new Uint8Array(UTIF.toRGBA8(ifd));
  const width = ifd.t256[0];
  const height = ifd.t257[0];
  
  callbacks.onHeader({ width, height, tiled: false });

  const rowBytes = width * 4;
  for (let y = 0; y < height; y++) {
    const off = y * rowBytes;
    callbacks.onRow(y, rgba8.subarray(off, off + rowBytes));
  }
  
  callbacks.onEnd();
}
