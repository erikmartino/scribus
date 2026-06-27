# Needs Clarification: Active Non-Goals

This document tracks active non-goals for `open-layout`. These items are explicitly out of scope for the prototype.

## Active Non-Goals

1.  **Tab Behavior Policy**
    *   *Decision*: Custom tab behavior (`Tab`/`Shift+Tab` custom indentation, inserting spacing, or custom tab layouts) is a non-goal. The editor relies entirely on standard browser tab-focus traversal.
2.  **Internationalization (i18n)**
    *   *Decision*: Multi-lingual UI translations, bidirectional (BiDi) text formatting, and specialized non-Latin script layouts are out of scope. The editor is permanently set to US English layout rules, US Letter page margins, and Imperial-based desktop publishing units (points/inches/picas).
    *   *Reference*: A complete description of what full i18n requires vs. this US-English constraint is documented in [i18n-requirements.md](file:///home/martino/git/scribus/open-layout/docs/i18n-requirements.md).
3.  **Keyboard Accent Compositions & IME**
    *   *Decision*: Custom handling of keyboard composition event loops (`compositionstart`/`compositionend`) and visual preedit text rendering overlays are non-goals. The editor supports only native browser-level keyboard and input events.
