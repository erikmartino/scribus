import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { Shaper } from '../lib/shaper.js';

describe('Shaper', () => {
  it('shapes runs using character-level fontSize when specified', () => {
    const mockRegistry = {
      variantForStyle() { return 'regular'; },
      getFont() { return null; } // triggers fallback placeholder advances (fontSize * 0.5)
    };
    
    const shaper = new Shaper({}, mockRegistry);
    const runs = [
      { text: 'ab', style: { bold: false, italic: false, fontFamily: '', fontSize: 40 } },
      { text: 'cd', style: { bold: false, italic: false, fontFamily: '' } } // falls back to paragraph fontSize
    ];

    const { glyphs } = shaper.shapeParagraph(runs, 20);

    assert.equal(glyphs.length, 4);
    // Runs with character-level fontSize: 40 should have ax: 20 (40 * 0.5)
    assert.equal(glyphs[0].ax, 20);
    assert.equal(glyphs[1].ax, 20);
    // Runs with fallback paragraph fontSize: 20 should have ax: 10 (20 * 0.5)
    assert.equal(glyphs[2].ax, 10);
    assert.equal(glyphs[3].ax, 10);
  });
});
