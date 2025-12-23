import {
    GlyphCluster,
    CharStyle,
    LayoutFlags,
    createCluster,
    setFlag,
    defaultCharStyle,
} from './types';

// We'll use dynamic import for the linebreak library
// In production, use: npm install linebreak
// For now, we implement a simple word-boundary breaker

/**
 * TextShaper converts input text into shaped glyph clusters
 * with break opportunities marked.
 */
export class TextShaper {
    private ctx: CanvasRenderingContext2D | null = null;
    private style: CharStyle;

    constructor(style: CharStyle = defaultCharStyle) {
        this.style = style;

        // Create an offscreen canvas for text measurement
        if (typeof document !== 'undefined') {
            const canvas = document.createElement('canvas');
            this.ctx = canvas.getContext('2d');
        }
    }

    /**
     * Set the character style
     */
    setStyle(style: CharStyle): void {
        this.style = style;
        if (this.ctx) {
            this.ctx.font = this.getFontString();
        }
    }

    /**
     * Get CSS font string from style
     */
    private getFontString(): string {
        return `${this.style.fontStyle} ${this.style.fontWeight} ${this.style.fontSize}px ${this.style.fontFamily}`;
    }

    /**
     * Measure text width using Canvas API
     */
    private measureText(text: string): { width: number; ascent: number; descent: number } {
        if (!this.ctx) {
            // Fallback estimation
            return {
                width: text.length * this.style.fontSize * 0.6,
                ascent: this.style.fontSize * 0.8,
                descent: this.style.fontSize * 0.2,
            };
        }

        this.ctx.font = this.getFontString();
        const metrics = this.ctx.measureText(text);

        return {
            width: metrics.width,
            ascent: metrics.actualBoundingBoxAscent || this.style.fontSize * 0.8,
            descent: metrics.actualBoundingBoxDescent || this.style.fontSize * 0.2,
        };
    }

    /**
     * Check if character is a word separator
     */
    private isWordSeparator(char: string): boolean {
        return /[\s\-–—]/.test(char);
    }

    /**
     * Check if character is whitespace
     */
    private isWhitespace(char: string): boolean {
        return /\s/.test(char);
    }

    /**
     * Check if we can break after this character (simple UAX#14 approximation)
     */
    private canBreakAfter(char: string, nextChar: string | undefined): boolean {
        // Always break after whitespace
        if (this.isWhitespace(char)) {
            return true;
        }

        // Break after hyphens and dashes
        if (/[\-–—]/.test(char)) {
            return true;
        }

        // Don't break before closing punctuation
        if (nextChar && /[)\]},.;:!?'"»›]/.test(nextChar)) {
            return false;
        }

        // Break before opening punctuation
        if (nextChar && /[(\[{'"«‹]/.test(nextChar)) {
            return true;
        }

        // CJK: can break between most CJK characters
        const isCJK = (c: string) => /[\u4e00-\u9fff\u3040-\u309f\u30a0-\u30ff]/.test(c);
        if (isCJK(char) && nextChar && !this.isCJKNoBreakBefore(nextChar)) {
            return true;
        }
        if (nextChar && isCJK(nextChar) && !this.isCJKNoBreakAfter(char)) {
            return true;
        }

        return false;
    }

    /**
     * CJK characters that cannot start a line
     */
    private isCJKNoBreakBefore(char: string): boolean {
        return /[、。，．：；！？）］｝〉》」』】〕〗〙〛'"〞)]/.test(char);
    }

    /**
     * CJK characters that cannot end a line
     */
    private isCJKNoBreakAfter(char: string): boolean {
        return /[（［｛〈《「『【〔〖〘〚'"〝(]/.test(char);
    }

    /**
     * Shape text into glyph clusters with break opportunities marked.
     * 
     * This is a simplified shaper that treats each character as a cluster.
     * A full implementation would use HarfBuzz for proper shaping.
     */
    shape(text: string): GlyphCluster[] {
        const clusters: GlyphCluster[] = [];

        for (let i = 0; i < text.length; i++) {
            const char = text[i];
            const nextChar = text[i + 1];
            const metrics = this.measureText(char);

            const cluster = createCluster(
                char,
                i,
                metrics.width,
                metrics.ascent,
                metrics.descent
            );

            // Mark whitespace as expanding space
            if (this.isWhitespace(char)) {
                setFlag(cluster, LayoutFlags.ExpandingSpace);
            }

            // Mark line break opportunities
            if (this.canBreakAfter(char, nextChar)) {
                setFlag(cluster, LayoutFlags.LineBoundary);
            }

            // Mark no-break-before/after for CJK
            if (this.isCJKNoBreakBefore(char)) {
                setFlag(cluster, LayoutFlags.NoBreakBefore);
            }
            if (this.isCJKNoBreakAfter(char)) {
                setFlag(cluster, LayoutFlags.NoBreakAfter);
            }

            clusters.push(cluster);
        }

        return clusters;
    }

    /**
     * Add hyphenation points to clusters.
     * This is a placeholder - a real implementation would use Hypher or similar.
     */
    addHyphenation(clusters: GlyphCluster[], patterns?: Map<string, number[]>): void {
        // Simple syllable-based hyphenation heuristic
        // Real implementation would use language-specific patterns

        let wordStart = 0;
        let inWord = false;

        for (let i = 0; i < clusters.length; i++) {
            const isLetter = /[a-zA-Z]/.test(clusters[i].text);

            if (isLetter && !inWord) {
                wordStart = i;
                inWord = true;
            } else if (!isLetter && inWord) {
                // End of word - add hyphenation points
                const wordLength = i - wordStart;
                if (wordLength >= 5) {
                    // Add hyphenation opportunities after every 2-3 characters
                    // This is a very naive approach
                    for (let j = wordStart + 2; j < i - 2; j += 2) {
                        setFlag(clusters[j], LayoutFlags.HyphenationPossible);
                    }
                }
                inWord = false;
            }
        }
    }
}
