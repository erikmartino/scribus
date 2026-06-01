import { EditorState } from '../lib/story-editor-core.js';
import { AppShell } from '../../app-shell/lib/shell-core.js';

export function registerCreatables(app, shell) {
  shell.registerCreatable({
    id: 'spread.textFrame',
    label: 'Text Frame',
    icon: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <rect x="3" y="3" width="18" height="18" rx="2"></rect>
      <line x1="7" y1="8" x2="17" y2="8"></line>
      <line x1="7" y1="12" x2="17" y2="12"></line>
      <line x1="7" y1="16" x2="13" y2="16"></line>
    </svg>`,
    onCreate: () => createTextFrame(app)
  });

  shell.registerCreatable({
    id: 'spread.imageFrame',
    label: 'Image Frame',
    icon: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <rect x="3" y="3" width="18" height="18" rx="2"></rect>
      <circle cx="8.5" cy="8.5" r="1.5"></circle>
      <polyline points="21 15 16 10 5 21"></polyline>
    </svg>`,
    onCreate: () => createImageFrame(app)
  });
}

export function createTextFrame(app) {
  if (!app.currentSpread) return;
  const page = app.currentSpread.pageRects[0];
  const boxId = `text-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`;
  const w = 200;
  const h = 150;
  const x = page.x + (page.width - w) / 2;
  const y = page.y + (page.height - h) / 2;

  const box = {
    id: boxId,
    x, y,
    width: w,
    height: h,
    minWidth: 80,
    minHeight: 60,
  };

  // Each new text frame gets its own independent story
  const emptyStory = [[{ text: '', style: { bold: false, italic: false } }]];
  const emptyStyles = [{ fontSize: app._fontSize }];
  const newStoryEntry = {
    id: `story-${app._storyCounter++}`,
    editor: new EditorState(emptyStory, emptyStyles),
    boxIds: [boxId],
    lineMap: [],
  };

  app.submitAction('Create Text Frame', () => {
    app.boxes = [...app.boxes, box];
    app._stories = [...app._stories, newStoryEntry];
    app.selectedBoxId = boxId;
    app._activeStory = newStoryEntry;
    // Select the new box in object mode; the user double-clicks to edit.
    app.setMode('object');
  });
}

export function createImageFrame(app) {
  if (!app.currentSpread) return;
  const page = app.currentSpread.pageRects[0];
  const boxId = `image-${++app._imageBoxCounter}`;
  const w = 200;
  const h = 150;
  const x = page.x + (page.width - w) / 2;
  const y = page.y + (page.height - h) / 2;

  const imageBox = {
    id: boxId,
    x, y,
    width: w,
    height: h,
    minWidth: 20,
    minHeight: 20,
    imageUrl: app._emptyImagePlaceholder(),
  };

  app.submitAction('Create Image Frame', () => {
    app.imageBoxes = [...app.imageBoxes, imageBox];
    app.selectedBoxId = boxId;
    app.setMode('object');
  });
}

/**
 * Delete the currently selected box (text or image).
 * For text boxes: removes the box from its story chain. If the box is the
 * only member of the story, the entire story is removed. If the box is
 * part of a multi-box chain, it is spliced out and the remaining boxes
 * stay linked.
 */
export function deleteSelectedBox(app) {
  if (app.mode !== 'object' || !app.selectedBoxId) return;

  const boxId = app.selectedBoxId;
  const isImage = app.imageBoxes.some(b => b.id === boxId);

  app.submitAction('Delete Frame', () => {
    if (isImage) {
      app.imageBoxes = app.imageBoxes.filter(b => b.id !== boxId);
    } else {
      // Remove from the story chain
      const story = app._findStoryForBox(boxId);
      if (story) {
        story.boxIds = story.boxIds.filter(id => id !== boxId);
        // If no boxes remain, remove the story entirely
        if (story.boxIds.length === 0) {
          app._stories = app._stories.filter(s => s !== story);
          if (app._activeStory === story) {
            app._activeStory = app._stories[0] || null;
          }
        }
      }
      app.boxes = app.boxes.filter(b => b.id !== boxId);
    }
    app.selectedBoxId = null;
  });
}
