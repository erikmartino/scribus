import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { DEFAULT_STYLE, cloneStyle, styleEq } from '../lib/style.js';

describe('style helpers', () => {
  it('DEFAULT_STYLE stays plain and immutable', () => {
    assert.deepEqual(DEFAULT_STYLE, { bold: false, italic: false, fontFamily: '' });
  });

  it('cloneStyle applies defaults and keeps extra fields', () => {
    const s = cloneStyle({ bold: true, color: '#333' });
    assert.deepEqual(s, { bold: true, italic: false, fontFamily: '', color: '#333' });
  });

  it('styleEq compares normalized style values', () => {
    const a = { bold: true };
    const b = { bold: true, italic: false, fontFamily: '' };
    assert.ok(styleEq(a, b));
    assert.ok(!styleEq(a, { bold: false }));
    assert.ok(!styleEq(a, { bold: true, italic: true }));
    assert.ok(!styleEq(a, { bold: true, fontFamily: 'serif' }));
  });
});
