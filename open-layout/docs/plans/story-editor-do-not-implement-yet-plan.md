# Story Editor Deferred Plan (DO NOT IMPLEMENT YET)

Date: 2026-04-12

Scope: Only US English text layout is a goal. UI is English-only, page defaults to US Letter, and metric/imperial toggle is out of scope (locked to standard points/inches/picas).

Status: Planning only. This file documents missing Story Editor work that is intentionally deferred.

## Deferred scope (what is still missing)

### 1) Editing correctness and text semantics

- [ ] Grapheme-safe deletion in all edge cases (emoji ZWJ sequences, combining marks, surrogate pairs).
- [ ] Reliable cursor movement parity at grapheme boundaries across mixed scripts.
- [ ] Shift+click anchor semantics verified for all direction combinations.
- [ ] Shift+drag extension semantics aligned with desktop DTP expectations.

### 2) Layout performance

- [ ] Incremental relayout strategy (paragraph and line-level invalidation) instead of full rerender per edit.
- [ ] Stable cache invalidation rules for style changes vs content edits.
- [ ] Baseline performance harness and metrics (typing latency, selection latency, rerender cost).
- [ ] Guardrail tests for no-regression in layout consistency after incremental updates.

### 3) Non-goals

- **NON-GOAL**: Custom tab behavior policy (`Tab`/`Shift+Tab` custom indentation or layout adjustments). The editor defaults to standard browser tab-focus traversal.
- **NON-GOAL**: Multi-lingual layout, bidirectional (BiDi) text, and specialized non-Latin script formatting.

## Proposed phased plan (still deferred)

1. Phase A: Correctness-first hardening (grapheme delete, shift+click/drag semantics).
2. Phase B: Incremental layout architecture and performance verification.

## Exit criteria before implementation approval

- [ ] Product decision recorded for selection semantics.
- [ ] Performance targets defined and measurable in CI.
- [ ] Named owner and milestone assigned.

Until those criteria are satisfied, this plan remains intentionally inactive.
