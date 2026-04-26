# Story Editor Deferred Plan (DO NOT IMPLEMENT YET)

Date: 2026-04-12

Status: Planning only. This file documents missing Story Editor work that is intentionally deferred.

## Implemented baseline (already done)

The following areas are considered complete and should not be treated as active plan work:

- Core story model and editor state architecture.
- Input loop (`beforeinput` + `keydown` fallback) and undo/redo integration.
- Selection primitives (single, double, triple click + drag selection).
- Shared ribbon wiring and paragraph/character style application.
- Clipboard integration and core Playwright coverage for cut/copy/paste flows.
- Cross-demo reuse via `story-editor-core.js`.

## Deferred scope (what is still missing)

### 1) Editing correctness and text semantics

- [ ] Grapheme-safe deletion in all edge cases (emoji ZWJ sequences, combining marks, surrogate pairs).
- [ ] Reliable cursor movement parity at grapheme boundaries across mixed scripts.
- [ ] Tab policy definition and implementation (`Tab`/`Shift+Tab` behavior in text mode vs focus traversal).
- [ ] Shift+click anchor semantics verified for all direction combinations.
- [ ] Shift+drag extension semantics aligned with desktop DTP expectations.

### 2) IME and composition reliability

- [ ] Define composition event policy (`compositionstart/update/end`) with no duplicate inserts.
- [ ] Ensure preedit text does not corrupt undo grouping.
- [ ] Validate replacement behavior when composition commits over an active selection.
- [ ] Add Playwright scenarios for representative IME flows (at minimum one CJK path).

### 3) Layout performance

- [ ] Incremental relayout strategy (paragraph and line-level invalidation) instead of full rerender per edit.
- [ ] Stable cache invalidation rules for style changes vs content edits.
- [ ] Baseline performance harness and metrics (typing latency, selection latency, rerender cost).
- [ ] Guardrail tests for no-regression in layout consistency after incremental updates.

### 4) International text support (deferred, explicit)

- [ ] BiDi behavior policy (selection direction, cursor visual order, arrow key behavior).
- [ ] Script-sensitive justification and line-break behavior requirements.
- [ ] Test corpus for mixed-direction paragraphs and script-specific punctuation.

### 5) Browser interaction and UX parity

- [ ] Cursor style parity by mode/context (`default`, move, text I-beam, resize handles).
- [ ] Focus retention rules across ribbon interactions and keyboard shortcuts.
- [ ] Deterministic mode transitions under rapid click/double-click sequences.

## Proposed phased plan (still deferred)

1. Phase A: Correctness-first hardening (grapheme delete, tab policy, shift+click/drag semantics).
2. Phase B: IME composition support and Playwright regression matrix.
3. Phase C: Incremental layout architecture and performance verification.
4. Phase D: International text features (BiDi/script behavior) with explicit acceptance tests.

## Exit criteria before implementation approval

- [ ] Product decision recorded for tab behavior and selection semantics.
- [ ] IME test matrix approved (platform/browser/language combinations).
- [ ] Performance targets defined and measurable in CI.
- [ ] Named owner and milestone assigned.

Until those criteria are satisfied, this plan remains intentionally inactive.
