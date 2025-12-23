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
        const clusters = this.shaper.shape(text);
        const { lines, overflow, lastClusterIndex } = this.layoutSegment(clusters, 0, width, 0, maxHeight || 1000000, true);

        return {
            lines,
            overflow,
            lastCharIndex: lastClusterIndex,
        };
    }

    /**
     * Internal core layout logic for a single segment (column or frame).
     */
    private layoutSegment(
        clusters: GlyphCluster[],
        startClusterIndex: number,
        width: number,
        xOffset: number,
        maxHeight: number,
        isFirstInDocument: boolean
    ): { lines: LineSpec[], overflow: boolean, lastClusterIndex: number } {
        const lines: LineSpec[] = [];
        const lineHeight = this.charStyle.fontSize * this.paragraphStyle.lineSpacing;
        const lineControl = new LineControl(width, xOffset, this.paragraphStyle);

        let currentClusterIndex = startClusterIndex;
        let isFirstLine = isFirstInDocument;
        let consecutiveHyphens = 0;

        // Initialize y position
        lineControl.yPos = clusters[startClusterIndex]?.ascent || this.charStyle.fontSize * 0.8;
        lineControl.startLine(currentClusterIndex, isFirstLine);

        while (currentClusterIndex < clusters.length) {
            const cluster = clusters[currentClusterIndex];
            const isNewline = cluster.text === '\n';

            if (isNewline) {
                if (!lineControl.isEmpty) {
                    lineControl.breakLine(currentClusterIndex - 1);
                    this.finalizeLine(lineControl, lines);
                    isFirstLine = false;
                }

                lineControl.nextLine(lineHeight);
                if (lineControl.yPos + lineHeight > maxHeight) {
                    return { lines, overflow: true, lastClusterIndex: currentClusterIndex + 1 };
                }

                currentClusterIndex++;
                lineControl.startLine(currentClusterIndex, false);
                continue;
            }

            const canBreak = hasFlag(cluster, LayoutFlags.LineBoundary);
            const canHyphenate = hasFlag(cluster, LayoutFlags.HyphenationPossible);
            const hyphWidth = canHyphenate ? this.getHyphenWidth() : 0;
            const projectedXPos = lineControl.xPos + cluster.width;
            const effectiveRight = lineControl.colRight - lineControl.style.rightMargin;
            const wouldOverflow = projectedXPos - lineControl.maxShrink >= effectiveRight;

            // Handle soft break
            if (!lineControl.isEmpty && lineControl.breakIndex >= 0 && wouldOverflow) {
                this.finalizeLine(lineControl, lines);
                isFirstLine = false;

                const nextLineStart = lineControl.breakIndex + 1;
                lineControl.nextLine(lineHeight);

                if (lineControl.yPos + lineHeight > maxHeight) {
                    return { lines, overflow: true, lastClusterIndex: nextLineStart };
                }

                lineControl.startLine(nextLineStart, false);
                // Rewind to the cluster after the break
                currentClusterIndex = nextLineStart;
                continue;
            }

            // Normal path: add cluster
            lineControl.addCluster(cluster);
            lineControl.xPos = projectedXPos;

            if (canBreak) {
                lineControl.rememberBreak(currentClusterIndex, lineControl.xPos, false);
            }
            if (canHyphenate) {
                lineControl.rememberBreak(currentClusterIndex, lineControl.xPos + hyphWidth, true);
            }

            // Forced break (no break opportunity found but line is full)
            if (lineControl.isEndOfLine(0) && lineControl.breakIndex < 0) {
                lineControl.breakLine(currentClusterIndex);
                this.finalizeLine(lineControl, lines);
                isFirstLine = false;

                const nextLineStart = currentClusterIndex + 1;
                lineControl.nextLine(lineHeight);

                if (lineControl.yPos + lineHeight > maxHeight) {
                    return { lines, overflow: true, lastClusterIndex: nextLineStart };
                }

                lineControl.startLine(nextLineStart, false);
                currentClusterIndex = nextLineStart;
                continue;
            }

            currentClusterIndex++;
        }

        // Final line
        if (!lineControl.isEmpty) {
            lineControl.breakLine(clusters.length - 1);
            const savedAlignment = lineControl.style.alignment;
            if (lineControl.style.alignment === Alignment.Justified) {
                lineControl.style.alignment = Alignment.Left;
            }
            this.finalizeLine(lineControl, lines);
            lineControl.style.alignment = savedAlignment;
        }

        return { lines, overflow: false, lastClusterIndex: clusters.length };
    }

    private finalizeLine(lineControl: LineControl, lines: LineSpec[]): void {
        const endX = lineControl.colRight - lineControl.style.rightMargin;
        lineControl.finishLine(endX);

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
     */
    layoutColumns(
        text: string,
        columnCount: number,
        totalWidth: number,
        columnHeight: number,
        columnGap: number = 20
    ): MultiColumnResult {
        const columns: ColumnSpec[] = [];
        const totalGaps = (columnCount - 1) * columnGap;
        const columnWidth = (totalWidth - totalGaps) / columnCount;

        const clusters = this.shaper.shape(text);
        if (clusters.length === 0) {
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

        if (this.paragraphStyle.hyphenate) {
            this.shaper.addHyphenation(clusters);
        }

        let currentClusterIndex = 0;
        for (let colIndex = 0; colIndex < columnCount && currentClusterIndex < clusters.length; colIndex++) {
            const colX = colIndex * (columnWidth + columnGap);
            const { lines, overflow: colOverflow, lastClusterIndex } = this.layoutSegment(
                clusters,
                currentClusterIndex,
                columnWidth,
                colX,
                columnHeight,
                currentClusterIndex === 0
            );

            columns.push({
                x: colX,
                y: 0,
                width: columnWidth,
                height: columnHeight,
                lines: lines,
            });

            currentClusterIndex = lastClusterIndex;
        }

        const overflow = currentClusterIndex < clusters.length;

        for (let c = columns.length; c < columnCount; c++) {
            columns.push({
                x: c * (columnWidth + columnGap),
                y: 0,
                width: columnWidth,
                height: columnHeight,
                lines: [],
            });
        }

        return { columns, overflow, lastCharIndex: currentClusterIndex - 1 };
    }
}
