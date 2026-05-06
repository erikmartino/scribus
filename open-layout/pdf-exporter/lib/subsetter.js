// subsetter.js — HarfBuzz subsetting WASM wrapper
//
// Fetches hb-subset.wasm and provides a clean API for subsetting a TrueType font.

export async function createSubsetter() {
  const wasmUrl = new URL('../../vendor/harfbuzzjs/hb-subset.wasm', import.meta.url);
  const { instance } = await WebAssembly.instantiateStreaming(fetch(wasmUrl));
  const exports = instance.exports;
  const heapu8 = new Uint8Array(exports.memory.buffer);

  return {
    /**
     * Subset a TrueType font buffer to include only the specified Unicode codepoints.
     * @param {Uint8Array} ttfBuffer - Original TTF binary
     * @param {Set<number>} unicodes - Set of Unicode codepoints to keep
     * @returns {Uint8Array} - Subbsetted TTF binary
     */
    subset(ttfBuffer, unicodes) {
      // 1. Create hb_blob and hb_face
      const blobPtr = exports.malloc(ttfBuffer.byteLength);
      heapu8.set(ttfBuffer, blobPtr);
      const HB_MEMORY_MODE_WRITABLE = 2;
      const blob = exports.hb_blob_create(blobPtr, ttfBuffer.byteLength, HB_MEMORY_MODE_WRITABLE, blobPtr, 0);
      const face = exports.hb_face_create(blob, 0);

      // 2. Create subset input
      const input = exports.hb_subset_input_create_or_fail();
      if (!input) throw new Error('hb_subset_input_create_or_fail failed');

      // 3. Add unicodes to the input's unicode set
      const unicodeSet = exports.hb_subset_input_unicode_set(input);
      for (const cp of unicodes) {
        exports.hb_set_add(unicodeSet, cp);
      }

      // 4. Perform subsetting
      const subsetFace = exports.hb_subset_or_fail(face, input);
      if (!subsetFace) throw new Error('hb_subset_or_fail failed (possibly empty subset?)');

      // 5. Extract the new font bytes
      const subsetBlob = exports.hb_face_reference_blob(subsetFace);
      const length = exports.hb_blob_get_length(subsetBlob);
      const dataPtr = exports.hb_blob_get_data(subsetBlob, 0);
      
      // Copy out the subsetted bytes
      const subsetBuffer = new Uint8Array(length);
      subsetBuffer.set(heapu8.subarray(dataPtr, dataPtr + length));

      // 6. Cleanup
      exports.hb_blob_destroy(subsetBlob);
      exports.hb_face_destroy(subsetFace);
      exports.hb_subset_input_destroy(input);
      exports.hb_face_destroy(face);
      exports.hb_blob_destroy(blob);
      
      // Free manually since we passed 0 as destroy callback
      exports.free(blobPtr);

      return subsetBuffer;
    }
  };
}
