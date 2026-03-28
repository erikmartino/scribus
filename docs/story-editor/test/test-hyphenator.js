import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { Hyphenator } from '../lib/hyphenator.js';

describe('Hyphenator', () => {
  it('hyphenates text and preserves style references', () => {
    const calls = [];
    const hyphenateSync = (text) => {
      calls.push(text);
      return `${text}\u00AD`;
    };

    const style1 = { bold: false, italic: false };
    const style2 = { bold: true, italic: false };
    const runs = [
      { text: 'alpha', style: style1 },
      { text: 'beta', style: style2 },
    ];

    const hyphenator = new Hyphenator(hyphenateSync);
    const out = hyphenator.hyphenateRuns(runs);

    assert.deepEqual(calls, ['alpha', 'beta']);
    assert.equal(out[0].text, 'alpha\u00AD');
    assert.equal(out[1].text, 'beta\u00AD');
    assert.equal(out[0].style, style1);
    assert.equal(out[1].style, style2);
  });
});
