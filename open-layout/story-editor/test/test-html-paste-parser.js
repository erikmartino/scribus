import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseHtmlElementToStory } from '../lib/html-paste-parser.js';

if (!globalThis.Node) {
  globalThis.Node = { TEXT_NODE: 3, ELEMENT_NODE: 1 };
}

// --- Minimal mock DOM helpers ---

function textNode(text) {
  return { nodeType: Node.TEXT_NODE, textContent: text };
}

function el(tag, attrs, ...children) {
  if (Array.isArray(attrs) || (attrs && attrs.nodeType)) {
    // Shorthand: el('b', child1, child2) without attrs
    children = [attrs, ...children];
    attrs = {};
  }
  attrs = attrs || {};
  const tagLower = tag.toLowerCase();
  const style = {};
  if (attrs.style) {
    // Parse inline style string into an object
    for (const decl of attrs.style.split(';')) {
      const [prop, val] = decl.split(':').map(s => s.trim());
      if (prop && val) {
        // Convert CSS property to camelCase
        const camel = prop.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
        style[camel] = val;
      }
    }
  }
  return {
    nodeType: Node.ELEMENT_NODE,
    tagName: tag.toUpperCase(),
    childNodes: children,
    children: children.filter(c => c.nodeType === Node.ELEMENT_NODE),
    style,
    hasChildNodes() { return children.length > 0; },
  };
}

describe('parseHtmlElementToStory', () => {
  it('parses plain text without tags', () => {
    const root = el('div', textNode('Hello world'));
    const result = parseHtmlElementToStory(root);
    assert.equal(result.length, 1);
    assert.equal(result[0][0].text, 'Hello world');
    assert.equal(result[0][0].style.bold, false);
    assert.equal(result[0][0].style.italic, false);
  });

  it('parses <b> and <strong> as bold', () => {
    const root = el('div',
      el('b', textNode('bold')),
      textNode(' and '),
      el('strong', textNode('strong'))
    );
    const result = parseHtmlElementToStory(root);
    assert.equal(result.length, 1);
    const allText = result[0].map(r => r.text).join('');
    assert.ok(allText.includes('bold'));
    assert.ok(allText.includes('strong'));
    const boldRun = result[0].find(r => r.text.includes('bold'));
    assert.equal(boldRun.style.bold, true);
    const strongRun = result[0].find(r => r.text.includes('strong'));
    assert.equal(strongRun.style.bold, true);
  });

  it('parses <i> and <em> as italic', () => {
    const root = el('div',
      el('i', textNode('italic')),
      textNode(' and '),
      el('em', textNode('emphasis'))
    );
    const result = parseHtmlElementToStory(root);
    assert.equal(result.length, 1);
    const italicRun = result[0].find(r => r.text.includes('italic'));
    assert.equal(italicRun.style.italic, true);
    const emRun = result[0].find(r => r.text.includes('emphasis'));
    assert.equal(emRun.style.italic, true);
  });

  it('parses nested bold+italic', () => {
    const root = el('div', el('b', el('i', textNode('bold italic'))));
    const result = parseHtmlElementToStory(root);
    assert.equal(result.length, 1);
    assert.equal(result[0][0].text, 'bold italic');
    assert.equal(result[0][0].style.bold, true);
    assert.equal(result[0][0].style.italic, true);
  });

  it('splits paragraphs on <p> tags', () => {
    const root = el('div',
      el('p', textNode('First')),
      el('p', textNode('Second'))
    );
    const result = parseHtmlElementToStory(root);
    assert.equal(result.length, 2);
    assert.equal(result[0][0].text, 'First');
    assert.equal(result[1][0].text, 'Second');
  });

  it('splits paragraphs on <div> tags', () => {
    const root = el('body',
      el('div', textNode('One')),
      el('div', textNode('Two'))
    );
    const result = parseHtmlElementToStory(root);
    assert.equal(result.length, 2);
    assert.equal(result[0][0].text, 'One');
    assert.equal(result[1][0].text, 'Two');
  });

  it('splits paragraphs on <br> tags', () => {
    const root = el('div',
      textNode('Line one'),
      el('br'),
      textNode('Line two')
    );
    const result = parseHtmlElementToStory(root);
    assert.equal(result.length, 2);
    assert.equal(result[0][0].text, 'Line one');
    assert.equal(result[1][0].text, 'Line two');
  });

  it('handles inline CSS font-weight:bold', () => {
    const root = el('div',
      el('span', { style: 'font-weight:bold' }, textNode('bold via css'))
    );
    const result = parseHtmlElementToStory(root);
    assert.equal(result.length, 1);
    assert.equal(result[0][0].text, 'bold via css');
    assert.equal(result[0][0].style.bold, true);
  });

  it('handles inline CSS font-weight:700', () => {
    const root = el('div',
      el('span', { style: 'font-weight:700' }, textNode('bold 700'))
    );
    const result = parseHtmlElementToStory(root);
    assert.equal(result.length, 1);
    assert.equal(result[0][0].text, 'bold 700');
    assert.equal(result[0][0].style.bold, true);
  });

  it('handles inline CSS font-style:italic', () => {
    const root = el('div',
      el('span', { style: 'font-style:italic' }, textNode('italic via css'))
    );
    const result = parseHtmlElementToStory(root);
    assert.equal(result.length, 1);
    assert.equal(result[0][0].text, 'italic via css');
    assert.equal(result[0][0].style.italic, true);
  });

  it('merges adjacent runs with identical styles', () => {
    const root = el('div',
      el('b', textNode('hello')),
      el('b', textNode(' world'))
    );
    const result = parseHtmlElementToStory(root);
    assert.equal(result.length, 1);
    assert.equal(result[0].length, 1);
    assert.equal(result[0][0].text, 'hello world');
    assert.equal(result[0][0].style.bold, true);
  });

  it('returns empty paragraph for null root', () => {
    const result = parseHtmlElementToStory(null);
    assert.equal(result.length, 1);
    assert.equal(result[0].length, 1);
    assert.equal(result[0][0].text, '');
  });

  it('handles Google Docs style nested spans', () => {
    const root = el('div',
      el('p',
        el('span', { style: 'font-weight:700' }, textNode('Bold text')),
        el('span', {}, textNode(' and ')),
        el('span', { style: 'font-style:italic' }, textNode('italic text'))
      )
    );
    const result = parseHtmlElementToStory(root);
    assert.equal(result.length, 1);
    const boldRun = result[0].find(r => r.text.includes('Bold'));
    assert.equal(boldRun.style.bold, true);
    assert.equal(boldRun.style.italic, false);
    const italicRun = result[0].find(r => r.text.includes('italic'));
    assert.equal(italicRun.style.italic, true);
    assert.equal(italicRun.style.bold, false);
  });

  it('handles headings as paragraph breaks', () => {
    const root = el('div',
      el('h1', textNode('Title')),
      el('p', textNode('Body'))
    );
    const result = parseHtmlElementToStory(root);
    assert.equal(result.length, 2);
    assert.equal(result[0][0].text, 'Title');
    assert.equal(result[1][0].text, 'Body');
  });

  it('preserves mixed bold and plain in one paragraph', () => {
    const root = el('div',
      el('p',
        textNode('Hello '),
        el('b', textNode('bold')),
        textNode(' world')
      )
    );
    const result = parseHtmlElementToStory(root);
    assert.equal(result.length, 1);
    assert.ok(result[0].length >= 3);
    assert.equal(result[0][0].text, 'Hello ');
    assert.equal(result[0][0].style.bold, false);
    assert.equal(result[0][1].text, 'bold');
    assert.equal(result[0][1].style.bold, true);
    assert.equal(result[0][2].text, ' world');
    assert.equal(result[0][2].style.bold, false);
  });
});
