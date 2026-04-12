const MIN_WIDTH = 80;
const MIN_HEIGHT = 50;

export function createBoxesFromDefaults(defaultBoxes) {
  return defaultBoxes.map((box, index) => ({
    id: box.id ?? `box-${index + 1}`,
    x: box.x,
    y: box.y,
    width: box.width,
    height: box.height,
    minWidth: box.minWidth ?? MIN_WIDTH,
    minHeight: box.minHeight ?? MIN_HEIGHT,
  }));
}

export function replaceBox(boxes, nextBox) {
  return boxes.map((box) => (box.id === nextBox.id ? nextBox : box));
}

export function clampBoxToBounds(box, bounds) {
  const width = Math.max(box.minWidth ?? MIN_WIDTH, Math.min(box.width, bounds.width));
  const height = Math.max(box.minHeight ?? MIN_HEIGHT, Math.min(box.height, bounds.height));

  const maxX = bounds.x + bounds.width - width;
  const maxY = bounds.y + bounds.height - height;

  return {
    ...box,
    width,
    height,
    x: Math.min(Math.max(box.x, bounds.x), maxX),
    y: Math.min(Math.max(box.y, bounds.y), maxY),
  };
}

export function clampBoxesToBounds(boxes, bounds) {
  return boxes.map((box) => clampBoxToBounds(box, bounds));
}

export function moveBox(box, dx, dy, bounds) {
  return clampBoxToBounds({
    ...box,
    x: box.x + dx,
    y: box.y + dy,
  }, bounds);
}

export function resizeBox(box, handle, dx, dy, bounds) {
  let x = box.x;
  let y = box.y;
  let width = box.width;
  let height = box.height;

  if (handle.includes('e')) {
    width += dx;
  }
  if (handle.includes('s')) {
    height += dy;
  }
  if (handle.includes('w')) {
    x += dx;
    width -= dx;
  }
  if (handle.includes('n')) {
    y += dy;
    height -= dy;
  }

  const minWidth = box.minWidth ?? MIN_WIDTH;
  const minHeight = box.minHeight ?? MIN_HEIGHT;

  if (width < minWidth) {
    if (handle.includes('w')) x -= (minWidth - width);
    width = minWidth;
  }
  if (height < minHeight) {
    if (handle.includes('n')) y -= (minHeight - height);
    height = minHeight;
  }

  return clampBoxToBounds({
    ...box,
    x,
    y,
    width,
    height,
  }, bounds);
}
