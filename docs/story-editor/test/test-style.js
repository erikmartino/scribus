import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { DEFAULT_STYLE, cloneStyle, styleEq } from '../lib/style.js';

describe('style helpers', () => {
  it('DEFAULT_STYLE stays plain and immutable', () => {
    assert.deepEqual(DEFAULT_STYLE, { bold: false, italic: false });
    assert.equal(Object.isFrozen(DEFAULT_STYLE), true);
  });

  it('cloneStyle applies defaults and keeps extra fields', () => {
    const out = cloneStyle({ bold: true, color: '#333' });
    assert.deepEqual(out, { bold: true, italic: false, color: '#333' });
  });

  it('styleEq compares normalized style values', () => {
    assert.equal(styleEq({ bold: true }, { bold: true, italic: false }), true);
    assert.equal(styleEq({ italic: true }, { italic: false }), false);
    assert.equal(styleEq({ tracking: 10 }, { tracking: 10, bold: false, italic: false }), true);
  });
});
