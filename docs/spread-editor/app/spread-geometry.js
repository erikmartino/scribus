export function computeSpreadLayout({
  pageWidth,
  pageHeight,
  margin,
  gutter,
  colsPerPage,
  colGap,
}) {
  const textWidth = Math.max(20, pageWidth - margin * 2);
  const textHeight = Math.max(20, pageHeight - margin * 2);
  const cols = Math.max(1, colsPerPage);
  const gapTotal = (cols - 1) * colGap;
  const colWidth = Math.max(20, (textWidth - gapTotal) / cols);

  const leftPageX = 0;
  const rightPageX = pageWidth + gutter;
  const pages = [leftPageX, rightPageX];

  const boxes = [];
  const pageRects = [];

  for (const pageX of pages) {
    pageRects.push({ x: pageX, y: 0, width: pageWidth, height: pageHeight });
    for (let ci = 0; ci < cols; ci++) {
      boxes.push({
        x: pageX + margin + ci * (colWidth + colGap),
        y: margin,
        width: colWidth,
        height: textHeight,
      });
    }
  }

  return {
    boxes,
    pageRects,
    spreadWidth: pageWidth * 2 + gutter,
    spreadHeight: pageHeight,
  };
}
