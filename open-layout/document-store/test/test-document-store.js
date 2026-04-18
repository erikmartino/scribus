import { describe, it, beforeEach, afterEach } from 'node:test';
import { strict as assert } from 'node:assert';

// ---------------------------------------------------------------------------
// Minimal fetch mock — installed before importing the module under test.
// Each test sets up `fetchMock.responses` to control what fetch returns.
// ---------------------------------------------------------------------------

const fetchMock = {
  responses: [],
  calls: [],
  /**
   * Register a canned response.  Responses are matched by URL substring.
   * @param {string} urlMatch - substring that must appear in the URL
   * @param {{ ok: boolean, status?: number, json?: object, text?: string }} resp
   */
  on(urlMatch, resp) {
    this.responses.push({ urlMatch, resp });
  },
  reset() {
    this.responses = [];
    this.calls = [];
  },
};

globalThis.fetch = async (url, opts) => {
  fetchMock.calls.push({ url, opts });
  // Match longest urlMatch first so more-specific patterns win.
  const candidates = fetchMock.responses.filter(r => url.includes(r.urlMatch));
  candidates.sort((a, b) => b.urlMatch.length - a.urlMatch.length);
  const match = candidates[0];
  if (!match) {
    return {
      ok: false,
      status: 404,
      json: async () => { throw new Error('Not Found'); },
      text: async () => 'Not Found',
    };
  }
  const r = match.resp;
  return {
    ok: r.ok !== false,
    status: r.status ?? (r.ok === false ? 500 : 200),
    json: async () => {
      if (r.json !== undefined) return JSON.parse(JSON.stringify(r.json));
      throw new Error('no json');
    },
    text: async () => r.text ?? JSON.stringify(r.json),
  };
};

const {
  serializeStory,
  putJson,
  updateDocTimestamp,
  loadDocument,
  loadParagraphStyles,
  loadCharacterStyles,
  loadSpread,
  loadStoryFromStore,
  loadStoryRaw,
} = await import('../lib/document-store.js');

// ---------------------------------------------------------------------------
// serializeStory  (pure — no fetch)
// ---------------------------------------------------------------------------

describe('serializeStory', () => {
  it('converts a single-paragraph story with plain text', () => {
    const editor = {
      story: [
        [{ text: 'Hello world', style: { bold: false, italic: false, fontFamily: '' } }],
      ],
    };
    const result = serializeStory('story-1', editor);
    assert.equal(result.id, 'story-1');
    assert.equal(result.paragraphs.length, 1);
    assert.equal(result.paragraphs[0].styleRef, 'body');
    assert.equal(result.paragraphs[0].runs.length, 1);
    assert.equal(result.paragraphs[0].runs[0].text, 'Hello world');
    // Plain style should produce an empty style object (no bold/italic keys)
    assert.deepEqual(result.paragraphs[0].runs[0].style, {});
  });

  it('includes bold flag when true', () => {
    const editor = {
      story: [
        [{ text: 'Bold', style: { bold: true, italic: false, fontFamily: '' } }],
      ],
    };
    const result = serializeStory('s', editor);
    assert.deepEqual(result.paragraphs[0].runs[0].style, { bold: true });
  });

  it('includes italic flag when true', () => {
    const editor = {
      story: [
        [{ text: 'Ital', style: { bold: false, italic: true, fontFamily: '' } }],
      ],
    };
    const result = serializeStory('s', editor);
    assert.deepEqual(result.paragraphs[0].runs[0].style, { italic: true });
  });

  it('includes fontFamily when non-empty', () => {
    const editor = {
      story: [
        [{ text: 'Font', style: { bold: false, italic: false, fontFamily: 'Arial' } }],
      ],
    };
    const result = serializeStory('s', editor);
    assert.deepEqual(result.paragraphs[0].runs[0].style, { fontFamily: 'Arial' });
  });

  it('handles bold + italic + fontFamily together', () => {
    const editor = {
      story: [
        [{ text: 'All', style: { bold: true, italic: true, fontFamily: 'Roboto' } }],
      ],
    };
    const result = serializeStory('s', editor);
    assert.deepEqual(result.paragraphs[0].runs[0].style, {
      bold: true,
      italic: true,
      fontFamily: 'Roboto',
    });
  });

  it('handles multiple paragraphs with multiple runs', () => {
    const editor = {
      story: [
        [
          { text: 'Hello ', style: { bold: false, italic: false, fontFamily: '' } },
          { text: 'world', style: { bold: true, italic: false, fontFamily: '' } },
        ],
        [
          { text: 'Second para', style: { bold: false, italic: true, fontFamily: '' } },
        ],
      ],
    };
    const result = serializeStory('multi', editor);
    assert.equal(result.id, 'multi');
    assert.equal(result.paragraphs.length, 2);
    assert.equal(result.paragraphs[0].runs.length, 2);
    assert.equal(result.paragraphs[0].runs[0].text, 'Hello ');
    assert.deepEqual(result.paragraphs[0].runs[0].style, {});
    assert.equal(result.paragraphs[0].runs[1].text, 'world');
    assert.deepEqual(result.paragraphs[0].runs[1].style, { bold: true });
    assert.equal(result.paragraphs[1].runs[0].text, 'Second para');
    assert.deepEqual(result.paragraphs[1].runs[0].style, { italic: true });
  });

  it('handles empty story (zero paragraphs)', () => {
    const editor = { story: [] };
    const result = serializeStory('empty', editor);
    assert.equal(result.id, 'empty');
    assert.equal(result.paragraphs.length, 0);
  });

  it('handles paragraph with empty run text', () => {
    const editor = {
      story: [
        [{ text: '', style: { bold: false, italic: false, fontFamily: '' } }],
      ],
    };
    const result = serializeStory('blank', editor);
    assert.equal(result.paragraphs[0].runs[0].text, '');
  });
});

// ---------------------------------------------------------------------------
// putJson
// ---------------------------------------------------------------------------

describe('putJson', () => {
  beforeEach(() => fetchMock.reset());

  it('sends PUT with correct headers and JSON body', async () => {
    fetchMock.on('/store/test', { ok: true, status: 200, json: {} });
    const data = { id: 'story-1', paragraphs: [] };
    const res = await putJson('/store/test', data);

    assert.ok(res.ok);
    assert.equal(fetchMock.calls.length, 1);
    const call = fetchMock.calls[0];
    assert.equal(call.url, '/store/test');
    assert.equal(call.opts.method, 'PUT');
    assert.equal(call.opts.headers['Content-Type'], 'application/json');

    // Body should be pretty-printed JSON
    const parsed = JSON.parse(call.opts.body);
    assert.deepEqual(parsed, data);
  });

  it('returns the response object', async () => {
    fetchMock.on('/store/x', { ok: false, status: 500 });
    const res = await putJson('/store/x', {});
    assert.equal(res.ok, false);
    assert.equal(res.status, 500);
  });
});

// ---------------------------------------------------------------------------
// updateDocTimestamp
// ---------------------------------------------------------------------------

describe('updateDocTimestamp', () => {
  beforeEach(() => fetchMock.reset());

  it('reads document.json, patches modified, and PUTs it back', async () => {
    const original = {
      format: 'open-layout/v1',
      title: 'Test',
      created: '2026-01-01T00:00:00Z',
      modified: '2026-01-01T00:00:00Z',
    };
    fetchMock.on('document.json', { ok: true, json: original });

    const before = Date.now();
    await updateDocTimestamp('alice/doc');
    const after = Date.now();

    // Should have made two fetch calls: GET + PUT
    assert.equal(fetchMock.calls.length, 2);
    assert.equal(fetchMock.calls[0].url, '/store/alice/doc/document.json');
    assert.equal(fetchMock.calls[1].url, '/store/alice/doc/document.json');
    assert.equal(fetchMock.calls[1].opts.method, 'PUT');

    // The PUT body should have an updated modified timestamp
    const putBody = JSON.parse(fetchMock.calls[1].opts.body);
    assert.equal(putBody.format, 'open-layout/v1');
    assert.equal(putBody.title, 'Test');
    const modifiedMs = new Date(putBody.modified).getTime();
    assert.ok(modifiedMs >= before, 'modified should be at or after test start');
    assert.ok(modifiedMs <= after + 1000, 'modified should be near current time');
  });

  it('silently does nothing when document.json is missing', async () => {
    // No response registered => 404
    await updateDocTimestamp('nobody/nothing');
    // Should not throw
    assert.equal(fetchMock.calls.length, 1);
  });

  it('silently does nothing when fetch throws', async () => {
    // Override fetch to throw
    const origFetch = globalThis.fetch;
    globalThis.fetch = async () => { throw new Error('network error'); };
    await updateDocTimestamp('alice/broken');
    globalThis.fetch = origFetch;
  });
});

// ---------------------------------------------------------------------------
// loadDocument
// ---------------------------------------------------------------------------

describe('loadDocument', () => {
  beforeEach(() => fetchMock.reset());

  it('returns meta and files from the store', async () => {
    const meta = { format: 'open-layout/v1', title: 'My Doc' };
    const files = ['document.json', 'spreads/spread-1.json', 'stories/story-main.json'];
    // Use the full path for document.json so it wins over the listing match.
    fetchMock.on('/store/alice/mydoc/document.json', { ok: true, json: meta });
    fetchMock.on('/store/alice/mydoc', { ok: true, json: files });

    const result = await loadDocument('alice/mydoc');
    assert.deepEqual(result.meta, meta);
    assert.deepEqual(result.files, files);
  });

  it('throws when document.json fails', async () => {
    // The document.json match is longer than the listing match,
    // so it wins for the metadata fetch.
    fetchMock.on('/store/alice/nodoc/document.json', { ok: false, status: 404 });
    fetchMock.on('/store/alice/nodoc', { ok: true, json: [] });

    await assert.rejects(
      () => loadDocument('alice/nodoc'),
      { message: /Failed to load document.json/ }
    );
  });

  it('throws when listing fails', async () => {
    fetchMock.on('document.json', { ok: true, json: {} });
    // /store/alice/missing will return 404 from default mock

    await assert.rejects(
      () => loadDocument('alice/missing'),
      { message: /Failed to list document/ }
    );
  });
});

// ---------------------------------------------------------------------------
// loadParagraphStyles
// ---------------------------------------------------------------------------

describe('loadParagraphStyles', () => {
  beforeEach(() => fetchMock.reset());

  it('returns a map from style id to style object', async () => {
    const styles = [
      { id: 'body', fontSize: 12, fontFamily: 'Garamond' },
      { id: 'lead', fontSize: 30, fontFamily: 'Garamond' },
    ];
    fetchMock.on('paragraph.aggregate.json', { ok: true, json: styles });

    const map = await loadParagraphStyles('alice/doc');
    assert.equal(Object.keys(map).length, 2);
    assert.equal(map.body.fontSize, 12);
    assert.equal(map.lead.fontSize, 30);
  });

  it('returns empty map when endpoint fails', async () => {
    // No response => 404
    const map = await loadParagraphStyles('nobody/nothing');
    assert.deepEqual(map, {});
  });

  it('returns empty map when fetch throws', async () => {
    const origFetch = globalThis.fetch;
    globalThis.fetch = async () => { throw new Error('fail'); };
    const map = await loadParagraphStyles('alice/err');
    globalThis.fetch = origFetch;
    assert.deepEqual(map, {});
  });
});

// ---------------------------------------------------------------------------
// loadCharacterStyles
// ---------------------------------------------------------------------------

describe('loadCharacterStyles', () => {
  beforeEach(() => fetchMock.reset());

  it('returns a map from style id to style object', async () => {
    const styles = [
      { id: 'emphasis', italic: true },
      { id: 'strong', bold: true },
    ];
    fetchMock.on('character.aggregate.json', { ok: true, json: styles });

    const map = await loadCharacterStyles('alice/doc');
    assert.equal(Object.keys(map).length, 2);
    assert.equal(map.emphasis.italic, true);
    assert.equal(map.strong.bold, true);
  });

  it('returns empty map when endpoint fails', async () => {
    const map = await loadCharacterStyles('nobody/nothing');
    assert.deepEqual(map, {});
  });
});

// ---------------------------------------------------------------------------
// loadSpread
// ---------------------------------------------------------------------------

describe('loadSpread', () => {
  beforeEach(() => fetchMock.reset());

  it('returns the spread JSON', async () => {
    const spread = {
      id: 'spread-1',
      pages: [{ index: 0, label: '1' }],
      frames: [{ id: 'frame-a', type: 'text', x: 10, y: 20, width: 100, height: 200, storyRef: 'story-main' }],
    };
    fetchMock.on('spread-1.json', { ok: true, json: spread });

    const result = await loadSpread('alice/doc', 'spread-1');
    assert.deepEqual(result, spread);
  });

  it('throws when spread file is missing', async () => {
    await assert.rejects(
      () => loadSpread('alice/doc', 'spread-99'),
      { message: /Failed to load spread/ }
    );
  });
});

// ---------------------------------------------------------------------------
// loadStoryRaw
// ---------------------------------------------------------------------------

describe('loadStoryRaw', () => {
  beforeEach(() => fetchMock.reset());

  it('returns raw story JSON without conversion', async () => {
    const story = {
      id: 'story-main',
      paragraphs: [
        { styleRef: 'body', runs: [{ text: 'Hello', style: { bold: true } }] },
      ],
    };
    fetchMock.on('story-main.json', { ok: true, json: story });

    const result = await loadStoryRaw('alice/doc', 'story-main');
    assert.equal(result.id, 'story-main');
    assert.equal(result.paragraphs[0].runs[0].style.bold, true);
  });

  it('throws when story file is missing', async () => {
    await assert.rejects(
      () => loadStoryRaw('alice/doc', 'story-999'),
      { message: /Failed to load story/ }
    );
  });
});

// ---------------------------------------------------------------------------
// loadStoryFromStore
// ---------------------------------------------------------------------------

describe('loadStoryFromStore', () => {
  beforeEach(() => fetchMock.reset());

  it('converts store format to editor format with default font size', async () => {
    const storyJson = {
      id: 'story-main',
      paragraphs: [
        {
          styleRef: 'body',
          runs: [
            { text: 'Hello ', style: {} },
            { text: 'world', style: { bold: true } },
          ],
        },
        {
          styleRef: 'lead',
          runs: [
            { text: 'Title', style: { italic: true } },
          ],
        },
      ],
    };
    const paraStyles = [
      { id: 'body', fontSize: 14, fontFamily: 'Roboto' },
      { id: 'lead', fontSize: 28, fontFamily: 'Arial' },
    ];
    fetchMock.on('story-main.json', { ok: true, json: storyJson });
    fetchMock.on('paragraph.aggregate.json', { ok: true, json: paraStyles });

    const result = await loadStoryFromStore('alice/doc', 'story-main');

    // story structure
    assert.equal(result.story.length, 2);
    assert.equal(result.story[0].length, 2);
    assert.equal(result.story[0][0].text, 'Hello ');
    assert.equal(result.story[0][0].style.bold, false);
    assert.equal(result.story[0][1].text, 'world');
    assert.equal(result.story[0][1].style.bold, true);
    assert.equal(result.story[1][0].text, 'Title');
    assert.equal(result.story[1][0].style.italic, true);

    // paragraph styles resolved from styleRef
    assert.equal(result.paragraphStyles.length, 2);
    assert.equal(result.paragraphStyles[0].fontSize, 14);
    assert.equal(result.paragraphStyles[0].fontFamily, 'Roboto');
    assert.equal(result.paragraphStyles[1].fontSize, 28);
    assert.equal(result.paragraphStyles[1].fontFamily, 'Arial');
  });

  it('uses custom baseFontSize when provided', async () => {
    const storyJson = {
      id: 'story-1',
      paragraphs: [
        { styleRef: 'unknown', runs: [{ text: 'Test', style: {} }] },
      ],
    };
    fetchMock.on('story-1.json', { ok: true, json: storyJson });
    fetchMock.on('paragraph.aggregate.json', { ok: true, json: [] });

    const result = await loadStoryFromStore('alice/doc', 'story-1', {
      baseFontSize: 16,
    });

    // unknown styleRef => falls back to baseFontSize
    assert.equal(result.paragraphStyles[0].fontSize, 16);
  });

  it('uses provided styleMap instead of fetching', async () => {
    const storyJson = {
      id: 'story-1',
      paragraphs: [
        { styleRef: 'heading', runs: [{ text: 'H1', style: {} }] },
      ],
    };
    fetchMock.on('story-1.json', { ok: true, json: storyJson });

    const styleMap = { heading: { fontSize: 36, fontFamily: 'Georgia' } };
    const result = await loadStoryFromStore('alice/doc', 'story-1', { styleMap });

    // Should NOT have fetched paragraph.aggregate.json
    const aggregateCalls = fetchMock.calls.filter(c => c.url.includes('aggregate'));
    assert.equal(aggregateCalls.length, 0);

    assert.equal(result.paragraphStyles[0].fontSize, 36);
    assert.equal(result.paragraphStyles[0].fontFamily, 'Georgia');
  });

  it('falls back to defaults when styleRef is not in styleMap', async () => {
    const storyJson = {
      id: 'story-1',
      paragraphs: [
        { styleRef: 'nonexistent', runs: [{ text: 'X', style: {} }] },
      ],
    };
    fetchMock.on('story-1.json', { ok: true, json: storyJson });
    fetchMock.on('paragraph.aggregate.json', { ok: true, json: [] });

    const result = await loadStoryFromStore('alice/doc', 'story-1');
    // Default baseFontSize is 22, default fontFamily is 'EB Garamond'
    assert.equal(result.paragraphStyles[0].fontSize, 22);
    assert.equal(result.paragraphStyles[0].fontFamily, 'EB Garamond');
  });

  it('handles runs with empty style object', async () => {
    const storyJson = {
      id: 'story-1',
      paragraphs: [
        { styleRef: 'body', runs: [{ text: 'Plain', style: {} }] },
      ],
    };
    fetchMock.on('story-1.json', { ok: true, json: storyJson });
    fetchMock.on('paragraph.aggregate.json', { ok: true, json: [] });

    const result = await loadStoryFromStore('alice/doc', 'story-1');
    // cloneStyle should set defaults
    assert.equal(result.story[0][0].style.bold, false);
    assert.equal(result.story[0][0].style.italic, false);
  });

  it('handles paragraph with no runs', async () => {
    const storyJson = {
      id: 'story-1',
      paragraphs: [
        { styleRef: 'body' },
      ],
    };
    fetchMock.on('story-1.json', { ok: true, json: storyJson });
    fetchMock.on('paragraph.aggregate.json', { ok: true, json: [] });

    const result = await loadStoryFromStore('alice/doc', 'story-1');
    assert.equal(result.story[0].length, 0);
  });

  it('throws when story file fails to load', async () => {
    fetchMock.on('paragraph.aggregate.json', { ok: true, json: [] });

    await assert.rejects(
      () => loadStoryFromStore('alice/doc', 'story-missing'),
      { message: /Failed to load story/ }
    );
  });
});
