export function computeSpreadLayout({
  pageWidth,
  pageHeight,
  margin,
  colsPerPage,
  colGap,
  pasteboardPad = 140,
}) {
  const textWidth = Math.max(20, pageWidth - margin * 2);
  const textHeight = Math.max(20, pageHeight - margin * 2);
  const cols = Math.max(1, colsPerPage);
  const gapTotal = (cols - 1) * colGap;
  const colWidth = Math.max(20, (textWidth - gapTotal) / cols);

  const leftPageX = 0;
  const rightPageX = pageWidth;
  const pages = [leftPageX, rightPageX];

  const boxes = [];
  const pageRects = [];

  for (const pageX of pages) {
    pageRects.push({ x: pageX, y: 0, width: pageWidth, height: pageHeight });
    for (let ci = 0; ci < cols; ci++) {
      boxes.push({
        id: `p${pageX === 0 ? 1 : 2}-c${ci + 1}`,
        x: pageX + margin + ci * (colWidth + colGap),
        y: margin,
        width: colWidth,
        height: textHeight,
        minWidth: 80,
        minHeight: 60,
      });
    }
  }

  const spreadRect = { x: 0, y: 0, width: pageWidth * 2, height: pageHeight };
  const pasteboardRect = {
    x: spreadRect.x - pasteboardPad,
    y: spreadRect.y - pasteboardPad,
    width: spreadRect.width + pasteboardPad * 2,
    height: spreadRect.height + pasteboardPad * 2,
  };

  return {
    boxes,
    pageRects,
    spreadRect,
    pasteboardRect,
    spreadWidth: spreadRect.width,
    spreadHeight: spreadRect.height,
  };
}
