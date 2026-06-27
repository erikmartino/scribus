# Internationalization (i18n) Roadmap & US-English-Only Scope

This document describes what is required for a complete Internationalization (i18n) pipeline in `open-layout`, ordered from the easiest tasks to the most complex. It concludes with an analysis of the work remaining when only US English is marked as a goal.

---

## 1. Full i18n Roadmap (Easiest to Hardest)

### Level 1: UI & General App Localization (Easy)
These requirements focus on the surrounding application interface and user settings rather than the text rendering engine.
*   **UI Translation System**: Integrating a translation framework (e.g., standard dictionary lookups or lightweight i18n libraries) to translate menus, labels, and buttons in the [app-shell](file:///home/martino/git/scribus/open-layout/app-shell/).
*   **Regional Date/Time Formatting**: Adapting file modification dates and creation timestamps in the document browser to use locale-specific orderings (e.g., `MM/DD/YYYY` in the US vs. `DD/MM/YYYY` in the UK/EU).
*   **Regional Numbers & Currencies**: Adjusting display and inputs to parse regional decimal points (e.g., `1,000.00` vs. `1.000,00` or space-separated `1 000,00`) and currency symbols.

### Level 2: Regional Unit Systems & Page Geometry (Medium)
These items bridge user preferences with the canvas geometry in the [spread-editor](file:///home/martino/git/scribus/open-layout/spread-editor/).
*   **Measurement Units Conversion**: Supporting switching the ruler and properties inputs between **Imperial** (inches, points, picas) and **Metric** (millimeters, centimeters).
*   **Page Standard Defaults**: Offering region-based document templates (e.g., ANSI Letter/Legal for North America vs. ISO A4 for the rest of the world).

### Level 3: Regional Typography & Orthography (Medium-Hard)
This involves minor logic inside the [story-editor](file:///home/martino/git/scribus/open-layout/story-editor/) layout engine.
*   **Typographic Smart Quotes**: Automatically converting straight quotes (`"`, `'`) to curly quotes (`“ ”`, `‘ ’`) based on regional habits (e.g., English curly quotes vs. German/French guillemets `« »`).
*   **Hyphenation Dictionary Resolution**: Loading separate language-specific soft-hyphen dictionaries at runtime (e.g., using different patterns for US English vs. British English vs. German).

### Level 4: Bidirectional (BiDi) Layout & Interaction (Hard - Non-Goal)
This requires significant modifications to coordinates and caret mappings.
*   **Logical-to-Visual Reordering**: Implementing the Unicode Bidirectional Algorithm (UBA) to display mixed RTL/LTR texts.
*   **Visual Caret & Selection Mapping**: Translating visually non-monotonic cursor steps to logical string indices for arrow-key movements and click-dragging.

### Level 5: Complex Script Layout & Break Policies (Very Hard - Non-Goal)
This requires deep integration with font shaping.
*   **Dictionary-Based Line Breaking**: Implementing language dictionaries for scripts without spaces (e.g., Thai, Khmer) to determine valid wrap boundaries.
*   **Vertical Text Layout**: Supporting top-to-bottom, right-to-left layout columns (e.g., Hanzi/Kanji vertical writing modes).
*   **Kashida / Script-Specific Justification**: Altering spacing rules (stretching glyph ligatures instead of word gaps) in scripts like Arabic.

---

## 2. Scope Analysis: Only US English is a Goal

With **US English as the exclusive goal** for `open-layout`, a large portion of the internationalization (i18n) roadmap is completely eliminated or replaced by hardcoded defaults. 

### A. Eliminated (Marked as Non-Goals)
*   **UI Translation Systems**: The application shell and components remain permanently in English.
*   **Metric/Imperial Conversions**: The system can be locked to standard desktop publishing unit conventions (Inches, Points, Picas) with US Letter/Legal as the template standard.
*   **Dialectal and Multi-Language Hyphenation**: Swapping hyphenation patterns is unnecessary. The engine only needs to load the US English hyphenation pattern file.
*   **Typographic Quote Variations**: The smart quote engine only needs to apply US rules (double curly quotes `“ ”` as primary, single curly quotes `‘ ’` for nested quotes).
*   **Localization of Formats**: Numbers are parsed with a period decimal separator (`.`), commas as thousands separators, and dates are formatted as `MM/DD/YYYY`.
*   **BiDi (Level 4) & Complex Scripts (Level 5)**: Completely out of scope.

### B. What is Left (Active Goals for US English)
Even in a US-English-only environment, several core Unicode, keyboard, and orthographic tasks remain:

*   **Unicode/Grapheme Correctness (Emojis & Unicode Symbols)**:
    US English writers frequently use emojis (e.g., smileys, country flags, ZWJ gendered/grouped glyphs) and copy-paste typographically rich text containing symbols like em-dashes (`—`), ellipses (`…`), or accented loan words (e.g., *résumé*, *café*). Deletion and cursor step size must still be grapheme-safe.
*   **Accents via Dead Keys & Composition (Special Handling Required)**:
    Even on standard US English layouts, users type accented characters for loan words (e.g., *résumé*, *café*) using keyboard dead keys (such as `Option+E` then `e` on macOS to produce `é`) or by holding a key to select from an OS character popup. Since `open-layout` does not use standard `<textarea>` or `contenteditable` nodes:
    *   *Direct Keydown Capture*: The editor intercepts inputs via raw [keydown](file:///home/martino/git/scribus/open-layout/story-editor/lib/text-interaction.js#L177) and [beforeinput](file:///home/martino/git/scribus/open-layout/story-editor/lib/text-interaction.js#L265) event listeners. Without composition tracking, individual dead key inputs would be processed immediately, resulting in raw modifiers (e.g. `´e`) instead of the merged character (`é`).
    *   *Preventing Double Insertion*: We must track composition state flags (`compositionstart`/`compositionend`) to pause model mutations until the OS composition is committed. This prevents both keydown and beforeinput handlers from duplicate-inserting characters.
    *   *Preedit Rendering*: The OS visualizes a temporary state (like underlined text for incomplete inputs) before characters are committed. Because the browser cannot automatically align the OS's native preedit styling with the custom SVG-based cursor, the editor must temporarily draw this visual state inside the layout at the cursor coordinates.
*   **Automatic Smart / Magic Quotes (US Rules & Special Handling)**:
    An entry-level typographic parsing engine is needed to automatically replace straight quotes (`"`, `'`) with US-style double curly quotes (`“` / `”`) and single curly quotes (`‘` / `’`) during text entry:
    *   *Context-Aware Conversion*: When a user types a quote, the editor must inspect the preceding character's index in the paragraph string to determine if it is a word start/whitespace (triggering an opening curly quote) or a letter/punctuation (triggering a closing curly quote).
    *   *Undo/Redo State Alignment*: Conversions must happen atomically within the active keyboard mutation operation so that undoing a keystroke reverts both the character and the automatic conversion together.
    *   *Paste Pipeline Conversion*: During text pasting (handled in [html-paste-parser.js](file:///home/martino/git/scribus/open-layout/story-editor/lib/html-paste-parser.js)), straight quotes must be programmatically sanitized and replaced based on paragraph context before the content is inserted into the editor model.
*   **US English Hyphenation**:
    The layout engine must still load and process the standard US English dictionary pattern file (e.g., `/vendor/hyphen/en.js`) to break text correctly on line boundaries.
