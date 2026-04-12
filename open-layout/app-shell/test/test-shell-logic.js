import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { DocumentModel, AbstractItem } from '../lib/document-model.js';
import { SelectionService } from '../lib/selection-service.js';

describe('DocumentModel & AbstractItem', () => {
  it('registers and retrieves items', () => {
    const doc = new DocumentModel();
    const item = new AbstractItem('id1', 'type1');
    doc.registerItem(item);
    
    assert.equal(doc.get('id1'), item);
    assert.equal(doc.getAll().length, 1);
  });

  it('serializes to JSON structure', () => {
    const doc = new DocumentModel();
    const item = new AbstractItem('id1', 'type1');
    item.data = { foo: 'bar' };
    doc.registerItem(item);
    
    const json = doc.serialize();
    assert.equal(json.items.length, 1);
    assert.equal(json.items[0].id, 'id1');
    assert.deepEqual(json.items[0].data, { foo: 'bar' });
  });

  it('removes items', () => {
    const doc = new DocumentModel();
    doc.registerItem(new AbstractItem('id1', 'type1'));
    doc.removeItem('id1');
    assert.equal(doc.getAll().length, 0);
  });
});

describe('SelectionService', () => {
  it('handles single selection', () => {
    const sel = new SelectionService();
    const item = { id: '1' };
    sel.select(item);
    
    assert.equal(sel.current, item);
    assert.deepEqual(sel.all, [item]);
  });

  it('handles multi-selection addition', () => {
    const sel = new SelectionService();
    const item1 = { id: '1' };
    const item2 = { id: '2' };
    
    sel.add(item1);
    sel.add(item2);
    
    assert.equal(sel.all.length, 2);
    assert.equal(sel._primary, item2); // Last added is primary
  });

  it('toggles selection state', () => {
    const sel = new SelectionService();
    const item = { id: '1' };
    
    sel.toggle(item);
    assert.equal(sel.all.length, 1);
    
    sel.toggle(item);
    assert.equal(sel.all.length, 0);
  });

  it('clears selection', () => {
    const sel = new SelectionService();
    sel.add({ id: '1' });
    sel.clear();
    assert.equal(sel.all.length, 0);
    assert.equal(sel.current, null);
  });
});
