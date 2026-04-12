import {
  LayoutEngine,
  extractParagraphs,
  TextCursor,
  EditorState,
} from '../../lib/story-editor-core.js';

const statusEl = document.getElementById('status');
const container = document.getElementById('svg-container');
const sampleEl = document.getElementById('sample-text');
const hasBeforeInput = 'onbeforeinput' in document;

function setStatus(msg, cls = '') {
  statusEl.textContent = msg;
  statusEl.className = cls;
}

function boxes() {
  return [{ x: 0, y: 0, width: 760, height: 520 }];
}

async function main() {
  let engine;
  let cursor = null;

  try {
    setStatus('Loading HarfBuzz, fonts, and hyphenation...');
    engine = await LayoutEngine.create({
      hbWasmUrl: '/vendor/harfbuzzjs/hb.wasm',
      hbJsUrl: '/vendor/harfbuzzjs/hbjs.js',
      hyphenUrl: '/vendor/hyphen/en.js',
      fontUrl: '/vendor/fonts/EBGaramond.ttf',
      fontItalicUrl: '/vendor/fonts/EBGaramond-Italic.ttf',
      fontFamily: 'EB Garamond',
    });
    setStatus('Ready - core component running.', 'ok');
  } catch (err) {
    setStatus(`Error: ${err.message}`, 'error');
    throw err;
  }

  const editor = new EditorState(extractParagraphs(sampleEl));

  function update() {
    const { svg, lineMap } = engine.renderToContainer(container, editor.story, boxes(), 21, 140);
    if (cursor) {
      cursor.setStory(editor.story);
      cursor.updateLayout(svg, lineMap, 21);
      cursor.moveTo(editor.cursor);
      cursor.setVisible(!editor.hasSelection());
    } else {
      cursor = new TextCursor(svg, editor.story, lineMap, 21);
      cursor.moveTo(editor.cursor);
      cursor.setVisible(!editor.hasSelection());
    }
  }

  container.addEventListener('click', (e) => {
    if (!cursor) return;
    container.focus();
    cursor.handleClick(e);
    const pos = cursor.getPosition();
    if (!pos) return;
    editor.moveCursor(pos, e.shiftKey);
    update();
  });

  container.addEventListener('keydown', (e) => {
    if (!cursor) return;
    if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) {
      cursor.handleKeydown(e);
      const pos = cursor.getPosition();
      if (pos) editor.moveCursor(pos, e.shiftKey);
      update();
      return;
    }
    if (hasBeforeInput) return;
    if (editor.handleKeydown(e)) {
      e.preventDefault();
      update();
    }
  });

  container.addEventListener('beforeinput', (e) => {
    if (!cursor) return;
    if (!editor.handleBeforeInput(e)) return;
    e.preventDefault();
    update();
  });

  container.addEventListener('paste', (e) => {
    if (!e.clipboardData) return;
    const text = e.clipboardData.getData('text/plain');
    if (typeof text !== 'string') return;
    e.preventDefault();
    if (editor.hasSelection()) editor.replaceSelectionWithText(text);
    else editor.applyOperation('insertText', { text });
    update();
  });

  window.addEventListener('beforeunload', () => {
    if (cursor) cursor.destroy();
  });

  update();
}

main().catch((err) => {
  console.error(err);
});
