import { describe, it, beforeEach } from 'node:test';
import { strict as assert } from 'node:assert';
import { ClipboardService } from '../lib/clipboard-service.js';

// Simple Browser Mocks
global.window = { location: { origin: 'http://localhost' }, addEventListener: () => {} };
global.document = { activeElement: { tagName: 'BODY' }, execCommand: () => {} };
global.localStorage = {
  store: {},
  getItem(key) { return this.store[key] || null; },
  setItem(key, val) { this.store[key] = String(val); }
};

describe('ClipboardService', () => {
  let shell;
  let clipboard;
  let lastDispatchedEvent = null;

  beforeEach(() => {
    lastDispatchedEvent = null;
    shell = {
      dispatchEvent: (event) => { lastDispatchedEvent = event; },
      addEventListener: () => {}
    };
    clipboard = new ClipboardService(shell);
    global.localStorage.store = {};
  });

  it('handles rich paste from localStorage', async () => {
    const payload = { version: 1, items: [{ id: '1', type: 'story' }] };
    global.localStorage.setItem('scribus_local_clipboard', JSON.stringify(payload));

    const mockEvent = {
        clipboardData: {
            types: [],
            getData: () => null
        },
        preventDefault: () => {}
    };

    await clipboard._handlePaste(mockEvent);
    
    assert.notEqual(lastDispatchedEvent, null);
    assert.equal(lastDispatchedEvent.type, 'paste-received');
    assert.deepEqual(lastDispatchedEvent.detail, payload);
  });

  it('handles plain text fallback when no rich data is available', async () => {
    const mockEvent = {
        clipboardData: {
            types: ['text/plain'],
            getData: (type) => type === 'text/plain' ? 'Hello World' : null,
            files: []
        },
        preventDefault: () => {}
    };

    await clipboard._handlePaste(mockEvent);
    
    assert.notEqual(lastDispatchedEvent, null);
    assert.equal(lastDispatchedEvent.detail.items[0].type, 'plain-text');
    assert.equal(lastDispatchedEvent.detail.items[0].data, 'Hello World');
  });
});
