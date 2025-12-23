/**
 * Layout flags matching Scribus sctextstruct.h
 */
export enum LayoutFlags {
    None = 0,
    LineBoundary = 1 << 0,        // Valid line break opportunity
    HyphenationPossible = 1 << 1, // Hyphenation point
    ExpandingSpace = 1 << 2,      // Space that expands during justification
    FixedSpace = 1 << 3,          // Non-expanding space
    SuppressSpace = 1 << 4,       // Space suppressed at line end
    SoftHyphenVisible = 1 << 5,   // Soft hyphen is visible (at line end)
    NoBreakBefore = 1 << 6,       // Cannot break before this cluster
    NoBreakAfter = 1 << 7,        // Cannot break after this cluster
}

/**
 * Represents a single glyph with positioning information
 */
export interface GlyphLayout {
    glyph: string;      // The character or glyph
    xadvance: number;   // Horizontal advance
    yadvance: number;   // Vertical advance (usually 0 for horizontal text)
    xoffset: number;    // X offset from baseline
    yoffset: number;    // Y offset from baseline
    scaleH: number;     // Horizontal scale
    scaleV: number;     // Vertical scale
}

/**
 * A cluster of one or more glyphs representing one or more source characters.
 * This is the unit of text that the layout algorithm works with.
 */
export interface GlyphCluster {
    firstChar: number;        // Start index in source text
    lastChar: number;         // End index in source text
    text: string;             // Original text
    glyphs: GlyphLayout[];    // Shaped glyphs
    flags: LayoutFlags;       // Break/layout flags
    width: number;            // Total width
    ascent: number;           // Height above baseline
    descent: number;          // Depth below baseline
    extraWidth: number;       // Added during justification
    xoffset: number;          // X offset (for justification)
}

/**
 * Describes a laid-out line
 */
export interface LineSpec {
    x: number;              // X position of line start
    y: number;              // Y position (baseline)
    width: number;          // Available width
    naturalWidth: number;   // Actual content width
    height: number;         // Line height
    ascent: number;         // Max ascent in line
    descent: number;        // Max descent in line
    firstCluster: number;   // Index of first cluster
    lastCluster: number;    // Index of last cluster
    clusters: GlyphCluster[]; // Clusters in this line
}

/**
 * Text alignment options
 */
export enum Alignment {
    Left = 'left',
    Right = 'right',
    Center = 'center',
    Justified = 'justified',
}

/**
 * Paragraph style settings
 */
export interface ParagraphStyle {
    alignment: Alignment;
    leftMargin: number;
    rightMargin: number;
    firstLineIndent: number;
    lineSpacing: number;        // Line height multiplier
    minWordSpacing: number;     // Min space width ratio (for justification)
    maxWordSpacing: number;     // Max space width ratio
    hyphenate: boolean;
    hyphenConsecutiveLimit: number; // Max consecutive hyphenated lines
}

/**
 * Character style settings
 */
export interface CharStyle {
    fontFamily: string;
    fontSize: number;
    fontWeight: string;
    fontStyle: string;
    letterSpacing: number;
    wordSpacing: number;
}

/**
 * Default paragraph style
 */
export const defaultParagraphStyle: ParagraphStyle = {
    alignment: Alignment.Left,
    leftMargin: 0,
    rightMargin: 0,
    firstLineIndent: 0,
    lineSpacing: 1.2,
    minWordSpacing: 0.8,
    maxWordSpacing: 1.5,
    hyphenate: true,
    hyphenConsecutiveLimit: 3,
};

/**
 * Default character style
 */
export const defaultCharStyle: CharStyle = {
    fontFamily: 'serif',
    fontSize: 16,
    fontWeight: 'normal',
    fontStyle: 'normal',
    letterSpacing: 0,
    wordSpacing: 0,
};

/**
 * Helper to check if a cluster has a specific flag
 */
export function hasFlag(cluster: GlyphCluster, flag: LayoutFlags): boolean {
    return (cluster.flags & flag) !== 0;
}

/**
 * Helper to set a flag on a cluster
 */
export function setFlag(cluster: GlyphCluster, flag: LayoutFlags): void {
    cluster.flags |= flag;
}

/**
 * Helper to clear a flag on a cluster
 */
export function clearFlag(cluster: GlyphCluster, flag: LayoutFlags): void {
    cluster.flags &= ~flag;
}

/**
 * Create a new glyph cluster
 */
export function createCluster(
    text: string,
    firstChar: number,
    width: number,
    ascent: number,
    descent: number
): GlyphCluster {
    return {
        firstChar,
        lastChar: firstChar + text.length - 1,
        text,
        glyphs: [{
            glyph: text,
            xadvance: width,
            yadvance: 0,
            xoffset: 0,
            yoffset: 0,
            scaleH: 1,
            scaleV: 1,
        }],
        flags: LayoutFlags.None,
        width,
        ascent,
        descent,
        extraWidth: 0,
        xoffset: 0,
    };
}
