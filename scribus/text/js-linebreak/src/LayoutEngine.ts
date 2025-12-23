import {
    GlyphCluster,
    LineSpec,
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

            // Remember break opportunity for future use
            if (canBreak) {
                lineControl.rememberBreak(i, lineControl.xPos);
            } else if (canHyphenate) {
                lineControl.rememberBreak(i, lineControl.xPos + hyphWidth);
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
}
