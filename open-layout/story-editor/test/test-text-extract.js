import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { extractRuns, extractParagraphs } from '../lib/text-extract.js';

if (!globalThis.Node) {
  globalThis.Node = { TEXT_NODE: 3, ELEMENT_NODE: 1 };
}

function textNode(text) {
  return { nodeType: Node.TEXT_NODE, textContent: text };
}

function el(tag, ...childNodes) {
  const children = childNodes.filter((n) => n.nodeType === Node.ELEMENT_NODE);
  return {
    nodeType: Node.ELEMENT_NODE,
    tagName: tag.toUpperCase(),
    childNodes,
    children,
  };
}

describe('extractRuns', () => {
  it('handles nested style tags and ignores inter-tag whitespace', () => {
    const p = el(
      'p',
      textNode('  '),
      el('n', textNode('plain ')),
      textNode('\n'),
      el('b', textNode('bold '), el('i', textNode('italic')), textNode(' end')),
      textNode('  '),
      el('em', textNode('emph')),
    );

    const runs = extractRuns(p);
    assert.deepEqual(runs, [
      { text: 'plain ', style: { bold: false, italic: false, fontFamily: '' } },
      { text: 'bold ', style: { bold: true, italic: false, fontFamily: '' } },
      { text: 'italic', style: { bold: false, italic: true, fontFamily: '' } },
      { text: ' end', style: { bold: true, italic: false, fontFamily: '' } },
      { text: 'emph', style: { bold: false, italic: true, fontFamily: '' } },
    ]);
  });

  it('maps style aliases and ignores unknown tags', () => {
    const p = el(
      'p',
      el('strong', textNode('S')),
      el('span', textNode('ignored')),
      el('bi', textNode('BI')),
      el('n', textNode('N')),
      el('em', textNode('E')),
    );

    const runs = extractRuns(p);
    assert.deepEqual(runs, [
      { text: 'S', style: { bold: true, italic: false, fontFamily: '' } },
      { text: 'BI', style: { bold: true, italic: true, fontFamily: '' } },
      { text: 'N', style: { bold: false, italic: false, fontFamily: '' } },
      { text: 'E', style: { bold: false, italic: true, fontFamily: '' } },
    ]);
  });
});

describe('extractParagraphs', () => {
  it('returns only direct p children in order', () => {
    const p1 = el('p', el('n', textNode('one')));
    const nestedP = el('p', el('n', textNode('nested')));
    const div = el('div', nestedP);
    const p2 = el('p', el('b', textNode('two')));
    const root = el('div', p1, div, p2);

    const story = extractParagraphs(root);
    assert.equal(story.length, 2);
    assert.equal(story[0][0].text, 'one');
    assert.equal(story[1][0].text, 'two');
    assert.deepEqual(story[1][0].style, { bold: true, italic: false, fontFamily: '' });
  });
});
