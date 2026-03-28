import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';

function applyLeadFirstLineMetrics({
  baseFontSize,
  firstLineScale,
  firstLineFragments,
  lineYs,
}) {
  const scaledFontSize = baseFontSize * firstLineScale;
  const anchorX = firstLineFragments[0]?.x ?? 0;

  const scaledFragments = firstLineFragments.map((frag) => ({
    ...frag,
    x: anchorX + (frag.x - anchorX) * firstLineScale,
    width: frag.width * firstLineScale,
  }));

  const deltaY = baseFontSize * (firstLineScale - 1);
  const shiftedLineYs = lineYs.map((y, i) => (i === 0 ? y : y + deltaY));

  return { scaledFontSize, scaledFragments, shiftedLineYs, deltaY };
}

function epsEq(a, b, eps = 1e-9) {
  return Math.abs(a - b) <= eps;
}

describe('paragraph style first-line math', () => {
  it('makes first line bigger than base size', () => {
    const out = applyLeadFirstLineMetrics({
      baseFontSize: 22,
      firstLineScale: 1.34,
      firstLineFragments: [
        { text: 'Story', x: 20, width: 48 },
        { text: 'Editor', x: 76, width: 52 },
        { text: 'Prototype', x: 136, width: 74 },
      ],
      lineYs: [60, 90],
    });

    assert.ok(out.scaledFontSize > 22);
    assert.equal(out.scaledFontSize, 22 * 1.34);
  });

  it('preserves non-overlap between words after scaling', () => {
    const out = applyLeadFirstLineMetrics({
      baseFontSize: 22,
      firstLineScale: 1.34,
      firstLineFragments: [
        { text: 'Story', x: 20, width: 48 },
        { text: 'Editor', x: 76, width: 52 },
        { text: 'Prototype', x: 136, width: 74 },
      ],
      lineYs: [60, 90],
    });

    for (let i = 0; i < out.scaledFragments.length - 1; i++) {
      const a = out.scaledFragments[i];
      const b = out.scaledFragments[i + 1];
      assert.ok(a.x + a.width <= b.x, `${a.text} overlaps ${b.text}`);
    }
  });

  it('shifts subsequent lines down by expected delta', () => {
    const out = applyLeadFirstLineMetrics({
      baseFontSize: 22,
      firstLineScale: 1.34,
      firstLineFragments: [
        { text: 'Story', x: 20, width: 48 },
      ],
      lineYs: [60, 90, 120],
    });

    assert.ok(epsEq(out.deltaY, 22 * 0.34));
    assert.equal(out.shiftedLineYs[0], 60);
    assert.ok(epsEq(out.shiftedLineYs[1], 90 + out.deltaY));
    assert.ok(epsEq(out.shiftedLineYs[2], 120 + out.deltaY));
  });
});
