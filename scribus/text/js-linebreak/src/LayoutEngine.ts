import {
    GlyphCluster,
    LineSpec,
    ColumnSpec,
    ParagraphStyle,
    CharStyle,
    Alignment,
    LayoutFlags,
    hasFlag,
    setFlag,
    defaultParagraphStyle,
    defaultCharStyle,
} from './types';
import { LineControl } from './LineControl';
import { TextShaper } from './TextShaper';

/**
 * Result of the layout process
 */
export interface LayoutResult {
    lines: LineSpec[];
    overflow: boolean;        // True if text didn't fit
    lastCharIndex: number;    // Index of last laid-out character
}

/**
 * Result of multi-column layout
 */
export interface MultiColumnResult {
    columns: ColumnSpec[];
    overflow: boolean;        // True if text didn't fit in all columns
    lastCharIndex: number;    // Index of last laid-out character
}

/**
 * LayoutEngine performs the main line-breaking algorithm.
 * This is a port of the Scribus PageItem_TextFrame::layout() logic.
 */
export class LayoutEngine {
    private shaper: TextShaper;
    private paragraphStyle: ParagraphStyle;
    private charStyle: CharStyle;

    constructor(
        paragraphStyle: ParagraphStyle = defaultParagraphStyle,
        charStyle: CharStyle = defaultCharStyle
    ) {
        this.paragraphStyle = paragraphStyle;
        this.charStyle = charStyle;
        this.shaper = new TextShaper(charStyle);
    }

    /**
     * Set paragraph style
     */
    setParagraphStyle(style: ParagraphStyle): void {
        this.paragraphStyle = style;
    }

    /**
     * Set character style
     */
    setCharStyle(style: CharStyle): void {
        this.charStyle = style;
        this.shaper.setStyle(style);
    }

    /**
     * Layout text within given width and optional height constraints.
     */
    layout(text: string, width: number, maxHeight?: number): LayoutResult {
        const lines: LineSpec[] = [];
        let overflow = false;

        // Shape text into clusters
        const clusters = this.shaper.shape(text);

        if (clusters.length === 0) {
            return { lines, overflow: false, lastCharIndex: 0 };
        }

        // Add hyphenation if enabled
        if (this.paragraphStyle.hyphenate) {
            this.shaper.addHyphenation(clusters);
        }

        // Initialize line control
        const lineControl = new LineControl(width, 0, this.paragraphStyle);

        // Calculate line height
        const lineHeight = this.charStyle.fontSize * this.paragraphStyle.lineSpacing;

        // Start first line
        let isFirstLine = true;
        lineControl.startLine(0, isFirstLine);
        lineControl.yPos = clusters[0].ascent; // Start at first line baseline

        let lastBreakIndex = -1;
        let consecutiveHyphens = 0;

        // Main layout loop
        for (let i = 0; i < clusters.length; i++) {
            const cluster = clusters[i];
            const isNewline = cluster.text === '\n';

            // Handle explicit line breaks
            if (isNewline) {
                if (!lineControl.isEmpty) {
                    lineControl.breakLine(i - 1 >= 0 ? i - 1 : 0);
                    this.finalizeAndAddLine(lineControl, lines, isFirstLine);
                    isFirstLine = false;
                }

                // Start new line
                lineControl.nextLine(lineHeight);
                lineControl.startLine(i + 1, false);

                // Check height overflow
                if (maxHeight && lineControl.yPos > maxHeight) {
                    overflow = true;
                    return { lines, overflow, lastCharIndex: i };
                }

                continue;
            }

            // Check for break opportunities BEFORE adding cluster
            const canBreak = hasFlag(cluster, LayoutFlags.LineBoundary);
            const canHyphenate = hasFlag(cluster, LayoutFlags.HyphenationPossible);
            const hyphWidth = canHyphenate ? this.getHyphenWidth() : 0;

            // Calculate what xPos would be after adding this cluster
            const projectedXPos = lineControl.xPos + cluster.width;

            // Check if adding this cluster would exceed line width
            if (!lineControl.isEmpty && lineControl.breakIndex >= 0) {
                const effectiveRight = lineControl.colRight - lineControl.style.rightMargin;
                const wouldOverflow = projectedXPos - lineControl.maxShrink >= effectiveRight;

                if (wouldOverflow) {
                    // Use the remembered break point
                    const breakCluster = clusters[lineControl.breakIndex];

                    // Check hyphenation
                    if (hasFlag(breakCluster, LayoutFlags.HyphenationPossible) &&
                        consecutiveHyphens < this.paragraphStyle.hyphenConsecutiveLimit) {
                        setFlag(breakCluster, LayoutFlags.SoftHyphenVisible);
                        consecutiveHyphens++;
                    } else if (hasFlag(breakCluster, LayoutFlags.LineBoundary)) {
                        consecutiveHyphens = 0;
                    }

                    // Suppress trailing spaces (use relative index within clusters array)
                    const relativeBreakIndex = lineControl.breakIndex - lineControl.lineData.firstCluster;
                    this.suppressTrailingSpaces(lineControl.clusters, relativeBreakIndex);

                    // Finalize line
                    this.finalizeAndAddLine(lineControl, lines, isFirstLine);
                    isFirstLine = false;

                    // Start new line after the break
                    lineControl.nextLine(lineHeight);
                    lineControl.startLine(lineControl.breakIndex + 1, false);

                    // Check height overflow
                    if (maxHeight && lineControl.yPos > maxHeight) {
                        overflow = true;
                        return { lines, overflow, lastCharIndex: lineControl.breakIndex };
                    }

                    // Re-process from the cluster after the break
                    // Decrement i so the loop will process clusters from breakIndex+1
                    i = lineControl.lineData.firstCluster - 1;
                    continue;
                }
            }

            // Add cluster to line (after overflow check)
            lineControl.addCluster(cluster);
            lineControl.xPos = projectedXPos;

            // Remember break opportunities for future use
            // Both word breaks and hyphenation breaks are considered and compete via badness
            if (canBreak) {
                lineControl.rememberBreak(i, lineControl.xPos, false);  // Word break (no penalty)
            }
            if (canHyphenate) {
                lineControl.rememberBreak(i, lineControl.xPos + hyphWidth, true);  // Hyphenation (with penalty)
            }

            // Handle forced break when line is overflowing with no break point
            if (lineControl.isEndOfLine(0) && lineControl.breakIndex < 0) {
                // No break point found - force break at current position
                lineControl.breakLine(i);
                this.finalizeAndAddLine(lineControl, lines, isFirstLine);
                isFirstLine = false;

                lineControl.nextLine(lineHeight);
                lineControl.startLine(i + 1, false);

                // Check height overflow
                if (maxHeight && lineControl.yPos > maxHeight) {
                    overflow = true;
                    return { lines, overflow, lastCharIndex: i };
                }
            }
        }

        // Handle remaining text (last line)
        if (!lineControl.isEmpty) {
            lineControl.breakLine(clusters.length - 1);

            // Don't justify the last line of a paragraph
            const savedAlignment = lineControl.style.alignment;
            if (lineControl.style.alignment === Alignment.Justified) {
                lineControl.style.alignment = Alignment.Left;
            }

            this.finalizeAndAddLine(lineControl, lines, isFirstLine);
            lineControl.style.alignment = savedAlignment;
        }

        return {
            lines,
            overflow,
            lastCharIndex: clusters.length - 1,
        };
    }

    /**
     * Finalize and add a line to the result
     */
    private finalizeAndAddLine(
        lineControl: LineControl,
        lines: LineSpec[],
        isFirstLine: boolean
    ): void {
        const endX = lineControl.colRight - lineControl.style.rightMargin;
        lineControl.finishLine(endX);

        // Apply justification or alignment
        if (lineControl.style.alignment === Alignment.Justified) {
            lineControl.justifyLine();
        } else {
            lineControl.alignLine();
        }

        lines.push(lineControl.createLineSpec());
    }

    /**
     * Mark trailing spaces as suppressed
     * @param clusters - The clusters array for the current line
     * @param lastIndex - The last index in clusters array to check (0-based within line)
     */
    private suppressTrailingSpaces(clusters: GlyphCluster[], lastIndex: number): void {
        // Iterate backwards from the last cluster
        for (let i = Math.min(lastIndex, clusters.length - 1); i >= 0; i--) {
            const cluster = clusters[i];
            if (!cluster) break;
            if (hasFlag(cluster, LayoutFlags.ExpandingSpace)) {
                setFlag(cluster, LayoutFlags.SuppressSpace);
            } else {
                break;
            }
        }
    }

    /**
     * Get hyphen width (approximate)
     */
    private getHyphenWidth(): number {
        return this.charStyle.fontSize * 0.3;
    }

    /**
     * Layout text into multiple columns with text flowing between them.
     * @param text - The text to layout
     * @param columnCount - Number of columns
     * @param totalWidth - Total width available for all columns
     * @param columnHeight - Height of each column
     * @param columnGap - Gap between columns
     */
    layoutColumns(
        text: string,
        columnCount: number,
        totalWidth: number,
        columnHeight: number,
        columnGap: number = 20
    ): MultiColumnResult {
        const columns: ColumnSpec[] = [];
        let overflow = false;
        let lastCharIndex = 0;

        // Calculate column width
        const totalGaps = (columnCount - 1) * columnGap;
        const columnWidth = (totalWidth - totalGaps) / columnCount;

        // Shape text into clusters once
        const clusters = this.shaper.shape(text);

        if (clusters.length === 0) {
            // Return empty columns
            for (let c = 0; c < columnCount; c++) {
                columns.push({
                    x: c * (columnWidth + columnGap),
                    y: 0,
                    width: columnWidth,
                    height: columnHeight,
                    lines: [],
                });
            }
            return { columns, overflow: false, lastCharIndex: 0 };
        }

        // Add hyphenation if enabled
        if (this.paragraphStyle.hyphenate) {
            this.shaper.addHyphenation(clusters);
        }

        const lineHeight = this.charStyle.fontSize * this.paragraphStyle.lineSpacing;
        let currentClusterIndex = 0;
        let isFirstLine = true;

        // Layout each column
        for (let colIndex = 0; colIndex < columnCount && currentClusterIndex < clusters.length; colIndex++) {
            const colX = colIndex * (columnWidth + columnGap);
            const columnLines: LineSpec[] = [];

            // Initialize line control for this column
            const lineControl = new LineControl(columnWidth, colX, this.paragraphStyle);
            lineControl.yPos = clusters[currentClusterIndex]?.ascent || lineHeight;
            lineControl.startLine(currentClusterIndex, isFirstLine);

            let consecutiveHyphens = 0;

            // Fill this column with lines
            while (currentClusterIndex < clusters.length) {
                const cluster = clusters[currentClusterIndex];
                const isNewline = cluster.text === '\n';

                // Handle explicit line breaks
                if (isNewline) {
                    if (!lineControl.isEmpty) {
                        lineControl.breakLine(currentClusterIndex - 1);
                        this.finalizeColumnLine(lineControl, columnLines, colIndex);
                        isFirstLine = false;
                    }

                    lineControl.nextLine(lineHeight);

                    // Check if we've exceeded column height
                    if (lineControl.yPos + lineHeight > columnHeight) {
                        currentClusterIndex++;
                        break; // Move to next column
                    }

                    currentClusterIndex++;
                    lineControl.startLine(currentClusterIndex, false);
                    continue;
                }

                // Check for break opportunities BEFORE adding cluster
                const canBreak = hasFlag(cluster, LayoutFlags.LineBoundary);
                const canHyphenate = hasFlag(cluster, LayoutFlags.HyphenationPossible);
                const hyphWidth = canHyphenate ? this.getHyphenWidth() : 0;

                const projectedXPos = lineControl.xPos + cluster.width;
                const effectiveRight = lineControl.colRight - lineControl.style.rightMargin;
                const wouldOverflow = projectedXPos - lineControl.maxShrink >= effectiveRight;

                // Check if we need to break line
                if (!lineControl.isEmpty && lineControl.breakIndex >= 0 && wouldOverflow) {
                    const breakCluster = clusters[lineControl.breakIndex];

                    if (hasFlag(breakCluster, LayoutFlags.HyphenationPossible) &&
                        consecutiveHyphens < this.paragraphStyle.hyphenConsecutiveLimit) {
                        setFlag(breakCluster, LayoutFlags.SoftHyphenVisible);
                        consecutiveHyphens++;
                    } else if (hasFlag(breakCluster, LayoutFlags.LineBoundary)) {
                        consecutiveHyphens = 0;
                    }

                    const relativeBreakIndex = lineControl.breakIndex - lineControl.lineData.firstCluster;
                    this.suppressTrailingSpaces(lineControl.clusters, relativeBreakIndex);

                    this.finalizeColumnLine(lineControl, columnLines, colIndex);
                    isFirstLine = false;

                    lineControl.nextLine(lineHeight);

                    // Check if we've exceeded column height
                    if (lineControl.yPos + lineHeight > columnHeight) {
                        currentClusterIndex = lineControl.breakIndex + 1;
                        break; // Move to next column
                    }

                    lineControl.startLine(lineControl.breakIndex + 1, false);
                    currentClusterIndex = lineControl.breakIndex + 1;
                    continue;
                }

                // Add cluster to line
                lineControl.addCluster(cluster);
                lineControl.xPos = projectedXPos;

                // Remember break opportunities
                if (canBreak) {
                    lineControl.rememberBreak(currentClusterIndex, lineControl.xPos, false);
                }
                if (canHyphenate) {
                    lineControl.rememberBreak(currentClusterIndex, lineControl.xPos + hyphWidth, true);
                }

                // Handle forced break when overflowing with no break point
                if (lineControl.isEndOfLine(0) && lineControl.breakIndex < 0) {
                    lineControl.breakLine(currentClusterIndex);
                    this.finalizeColumnLine(lineControl, columnLines, colIndex);
                    isFirstLine = false;

                    lineControl.nextLine(lineHeight);

                    if (lineControl.yPos + lineHeight > columnHeight) {
                        currentClusterIndex++;
                        break;
                    }

                    currentClusterIndex++;
                    lineControl.startLine(currentClusterIndex, false);
                    continue;
                }

                currentClusterIndex++;
            }

            // Handle remaining text in this column (last line)
            if (!lineControl.isEmpty && currentClusterIndex <= clusters.length) {
                lineControl.breakLine(currentClusterIndex - 1);

                const savedAlignment = lineControl.style.alignment;
                if (lineControl.style.alignment === Alignment.Justified) {
                    lineControl.style.alignment = Alignment.Left;
                }

                this.finalizeColumnLine(lineControl, columnLines, colIndex);
                lineControl.style.alignment = savedAlignment;
            }

            columns.push({
                x: colX,
                y: 0,
                width: columnWidth,
                height: columnHeight,
                lines: columnLines,
            });

            lastCharIndex = currentClusterIndex - 1;
        }

        // Check if there's overflow (text didn't fit in all columns)
        overflow = currentClusterIndex < clusters.length;

        // Add empty columns if we ran out of text
        for (let c = columns.length; c < columnCount; c++) {
            columns.push({
                x: c * (columnWidth + columnGap),
                y: 0,
                width: columnWidth,
                height: columnHeight,
                lines: [],
            });
        }

        return { columns, overflow, lastCharIndex };
    }

    /**
     * Finalize and add a line to a column
     */
    private finalizeColumnLine(
        lineControl: LineControl,
        lines: LineSpec[],
        columnIndex: number
    ): void {
        const endX = lineControl.colRight - lineControl.style.rightMargin;
        lineControl.finishLine(endX);

        if (lineControl.style.alignment === Alignment.Justified) {
            lineControl.justifyLine();
        } else {
            lineControl.alignLine();
        }

        const lineSpec = lineControl.createLineSpec();
        lineSpec.column = columnIndex;
        lines.push(lineSpec);
    }
}
