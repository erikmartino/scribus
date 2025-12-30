import {
    GlyphCluster,
    LineSpec,
    ParagraphStyle,
    Alignment,
    hasFlag,
    setFlag,
    LayoutFlags,
} from './types';

/**
 * LineControl manages the state of the current line being laid out.
 * This is a direct port of Scribus's LineControl struct.
 */
export class LineControl {
    // Line data
    lineData: LineSpec;
    clusters: GlyphCluster[] = [];
    isEmpty = true;
    hyphenCount = 0;

    // Column boundaries
    colWidth: number;
    colLeft: number;
    colRight: number;

    // Break tracking
    breakIndex = -1;
    breakXPos = 0;
    breakPenalty = 0;           // Penalty applied to current break (for hyphenation)
    breakIsHyphenation = false; // Whether current break is a hyphenation

    // Position tracking
    xPos = 0;
    yPos = 0;

    // Justification limits
    maxShrink = 0;
    maxStretch = 0;

    // Style
    style: ParagraphStyle;

    constructor(
        colWidth: number,
        colLeft: number,
        style: ParagraphStyle
    ) {
        this.colWidth = colWidth;
        this.colLeft = colLeft;
        this.colRight = colLeft + colWidth; // colRight is the absolute right edge
        this.style = style;
        this.xPos = colLeft + style.leftMargin;
        this.yPos = 0;

        this.lineData = {
            x: this.xPos,
            y: 0,
            width: 0,
            naturalWidth: 0,
            height: 0,
            ascent: 0,
            descent: 0,
            firstCluster: 0,
            lastCluster: 0,
            clusters: [],
            column: 0,
        };
    }

    /**
     * Initialize fields for a new line at current position
     */
    startLine(firstCluster: number, isFirstLine: boolean = false): void {
        this.clusters = [];
        this.isEmpty = true;

        // Apply first line indent
        const indent = isFirstLine ? this.style.firstLineIndent : 0;
        this.xPos = this.colLeft + this.style.leftMargin + indent;

        this.lineData = {
            x: this.xPos,
            y: this.yPos,
            width: 0,
            naturalWidth: 0,
            height: 0,
            ascent: 0,
            descent: 0,
            firstCluster: firstCluster,
            lastCluster: 0,
            clusters: [],
            column: 0,
        };

        this.breakIndex = -1;
        this.breakXPos = 0;
        this.breakPenalty = 0;
        this.breakIsHyphenation = false;
        this.maxShrink = 0;
        this.maxStretch = 0;
    }

    /**
     * Add a cluster to the current line
     */
    addCluster(cluster: GlyphCluster): void {
        this.clusters.push(cluster);
        this.isEmpty = false;

        // Update line metrics
        this.lineData.ascent = Math.max(this.lineData.ascent, cluster.ascent);
        this.lineData.descent = Math.max(this.lineData.descent, cluster.descent);

        // Track shrink/stretch for justification
        if (hasFlag(cluster, LayoutFlags.ExpandingSpace)) {
            this.maxShrink += cluster.width * (1 - this.style.minWordSpacing);
            this.maxStretch += cluster.width * (this.style.maxWordSpacing - 1);
        }
    }

    /**
     * Called when a possible break is passed.
     * Records the break opportunity, preferring breaks closer to the right margin
     * but penalizing hyphenation breaks to prefer word breaks when available.
     * @param isHyphenation - If true, applies hyphenation penalty to disfavor this break
     */
    rememberBreak(index: number, xPos: number, isHyphenation: boolean = false): void {
        const effectiveRight = this.colRight - this.style.rightMargin;

        // Apply hyphenation penalty: higher penalty = more "looseness" added
        // This makes hyphenation breaks less desirable compared to word breaks
        // Penalty of 100 means add 100 units of "looseness" (pixels)
        // This means hyphenation must be 100px closer to edge than a word break to win
        const penalty = isHyphenation ? (this.style.hyphenPenalty / 100) * 100 : 0;

        // If we already have a break, compare quality
        // Check if this is an expanding space (hanging)
        let isHangingSpace = false;
        if (this.lineData.clusters.length > 0) {
            // Accessing global index is hard, but we can check the recently added cluster
            // which is the last one in this.clusters
            // Wait, 'index' passed here is global. 
            // Logic in LayoutEngine calls this immediately after adding.
            // So this.clusters[this.clusters.length - 1] is the current cluster?
            // No, LayoutEngine adds THEN calls rememberBreak.
            // So yes, key is last cluster.
            const lastCluster = this.clusters[this.clusters.length - 1];
            if (lastCluster && hasFlag(lastCluster, LayoutFlags.ExpandingSpace)) {
                isHangingSpace = true;
            }
        }

        // If we already have a break
        if (this.breakIndex >= 0) {
            // Special handling for hanging leading/trailing spaces:
            // If the new break is a space, and we are at or past the margin (hanging),
            // and the previous break was also a space (or not), we generally want to extend the hang
            // to capture as many spaces as possible.
            // Or simpler: If we are hanging (xPos > effectiveRight) and this is a space, ALWAYS update.
            // This ensures we eat all trailing spaces.

            if (isHangingSpace && xPos >= effectiveRight) {
                // Always take it
            } else {
                // Calculate "badness" for each break
                // Lower badness = better break
                // Badness = distance from ideal right edge + penalty
                const oldBadness = Math.abs(effectiveRight - this.breakXPos) + this.breakPenalty;
                const newBadness = Math.abs(effectiveRight - xPos) + penalty;

                // Keep the old break if it's better (lower badness)
                if (oldBadness <= newBadness) {
                    return;
                }
            }
        }

        this.breakXPos = xPos;
        this.breakIndex = index;
        this.breakPenalty = penalty;
        this.breakIsHyphenation = isHyphenation;
    }

    /**
     * Called when a mandatory break is found (e.g., newline, end of text).
     * Commits the line break at the given position.
     */
    breakLine(lastIndex: number): void {
        this.breakIndex = lastIndex;
        this.breakXPos = this.lineData.x;

        // Calculate width up to break point
        for (let i = 0; i <= lastIndex - this.lineData.firstCluster; i++) {
            if (i < this.clusters.length) {
                this.breakXPos += this.clusters[i].width + this.clusters[i].extraWidth;
            }
        }

        this.updateHeightMetrics();
    }

    /**
     * Update line height metrics from clusters
     */
    private updateHeightMetrics(): void {
        this.lineData.ascent = 0;
        this.lineData.descent = 0;

        for (const cluster of this.clusters) {
            this.lineData.ascent = Math.max(this.lineData.ascent, cluster.ascent);
            this.lineData.descent = Math.max(this.lineData.descent, cluster.descent);
        }

        this.lineData.height = this.lineData.ascent + this.lineData.descent;
    }

    /**
     * Finalize line metrics after break position is determined
     */
    finishLine(endX: number): void {
        this.lineData.lastCluster = this.breakIndex;
        // this.lineData.naturalWidth = this.breakXPos - this.lineData.x;
        this.lineData.width = endX - this.lineData.x;

        // Calculate how many clusters to include (bounded by actual array length)
        const clusterCount = Math.min(
            this.breakIndex - this.lineData.firstCluster + 1,
            this.clusters.length
        );
        this.lineData.clusters = this.clusters.slice(0, Math.max(0, clusterCount));

        // Recalculate natural width excluding suppressed spaces
        this.lineData.naturalWidth = 0;
        for (const cluster of this.lineData.clusters) {
            if (!hasFlag(cluster, LayoutFlags.SuppressSpace)) {
                this.lineData.naturalWidth += cluster.width;
            } else {
                // For suppressed spaces, we don't add their width to naturalWidth
            }
            // Add extraWidth if it's not suppressed? 
            // Usually suppressed spaces have width but no extraWidth yet (justification hasn't happened).
            // But we should track naturalWidth as sum of visible widths.
        }

        // Wait, breakXPos included all widths up to the break.
        // If we simply subtract suppressed widths from breakXPos - startX?
        // But breakXPos acts as if spaces are there.
        // Let's rely on summing implementation which is safer.
        // Also need to account for implicit breaks or anything? No, clusters array is fine.

        this.maxShrink = 0;
        this.maxStretch = 0;
    }

    /**
     * Check if current x position exceeds line width
     */
    isEndOfLine(extraSpace: number = 0): boolean {
        const effectiveRight = this.colRight - this.style.rightMargin;
        return this.xPos + extraSpace - this.maxShrink >= effectiveRight;
    }

    /**
     * Get available line width
     */
    getAvailableWidth(): number {
        return this.colRight - this.style.rightMargin - this.lineData.x;
    }

    /**
     * Justify the current line by distributing extra space
     */
    justifyLine(): void {
        if (this.lineData.width <= 0 || this.clusters.length === 0) {
            return;
        }

        const lineWidth = this.getAvailableWidth();
        const naturalWidth = this.lineData.naturalWidth;
        const extraSpace = lineWidth - naturalWidth;

        if (extraSpace <= 0) {
            return; // Line is already full or overfull
        }

        // Count expanding spaces
        let spaceCount = 0;
        let spaceWidth = 0;

        for (const cluster of this.lineData.clusters) {
            if (hasFlag(cluster, LayoutFlags.ExpandingSpace) &&
                !hasFlag(cluster, LayoutFlags.SuppressSpace)) {
                spaceCount++;
                spaceWidth += cluster.width;
            }
        }

        if (spaceCount === 0) {
            return; // No spaces to expand
        }

        // Calculate space extension
        const spaceExtension = extraSpace / spaceCount;

        // Apply extension to each space
        for (const cluster of this.lineData.clusters) {
            if (hasFlag(cluster, LayoutFlags.ExpandingSpace) &&
                !hasFlag(cluster, LayoutFlags.SuppressSpace)) {
                cluster.extraWidth = spaceExtension;
            }
        }

        // Update natural width
        this.lineData.naturalWidth = lineWidth;
    }

    /**
     * Apply alignment offset to the line
     */
    alignLine(): void {
        const lineWidth = this.getAvailableWidth();
        const naturalWidth = this.lineData.naturalWidth;
        let offset = 0;

        switch (this.style.alignment) {
            case Alignment.Right:
                offset = lineWidth - naturalWidth;
                break;
            case Alignment.Center:
                offset = (lineWidth - naturalWidth) / 2;
                break;
            case Alignment.Justified:
                // Handled by justifyLine()
                break;
            case Alignment.Left:
            default:
                offset = 0;
        }

        if (offset > 0) {
            this.lineData.x += offset;
        }
    }

    /**
     * Create the final LineSpec for this line
     */
    createLineSpec(): LineSpec {
        return { ...this.lineData };
    }

    /**
     * Move to next line
     */
    nextLine(lineHeight: number): void {
        this.yPos += lineHeight;
    }
}
