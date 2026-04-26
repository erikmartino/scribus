import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { getTextPropertyDescriptors } from '../lib/text-property-descriptors.js';

describe('text-property-descriptors', () => {

  const mockEditor = {
    story: [ { text: 'Para 1' } ],
    cursor: { paraIndex: 0 },
    paragraphStyles: [ { fontSize: 24 } ],
    getTypingStyle: () => ({
      fontFamily: 'Roboto',
      bold: true,
      italic: false
    })
  };

  const mockShell = {
    commands: {
      execute: (id, args) => {
        mockShell.lastExecuted = { id, args };
      }
    }
  };

  it('returns Typography and Paragraph groups', () => {
    const groups = getTextPropertyDescriptors(mockShell, mockEditor);
    assert.equal(groups.length, 2);
    assert.equal(groups[0].label, 'Typography');
    assert.equal(groups[1].label, 'Paragraph');
  });

  it('extracts values from editor state', () => {
    const groups = getTextPropertyDescriptors(mockShell, mockEditor);
    const typography = groups[0].properties;
    
    const fontProp = typography.find(p => p.key === 'font-family');
    assert.equal(fontProp.value, 'Roboto');

    const boldProp = typography.find(p => p.key === 'bold');
    assert.equal(boldProp.value, 'Yes');

    const paragraph = groups[1].properties;
    const sizeProp = paragraph.find(p => p.key === 'font-size');
    assert.equal(sizeProp.value, 24);
  });

  it('executes commands on change', () => {
    const groups = getTextPropertyDescriptors(mockShell, mockEditor);
    const sizeProp = groups[1].properties.find(p => p.key === 'font-size');
    
    sizeProp.onChange(32);
    assert.equal(mockShell.lastExecuted.id, 'text.font-size');
    assert.equal(mockShell.lastExecuted.args.fontSize, 32);
  });
});
