# Implementation Plan - Fixing Streaming Downscale E2E Tests

The `streaming-downscale-demo` E2E tests were flaky when run in parallel. This was due to multiple workers sharing the same fixture filenames in a common directory, leading to race conditions where one worker's cleanup would delete files still in use by another worker.

## Status: Completed

All 11 tests now pass consistently even with high parallelism and repetitions.

## Proposed Changes

### streaming-downscale-demo

#### [MODIFY] [streaming-downscale.spec.js](file:///home/martino/git/scribus/open-layout/streaming-downscale-demo/test/streaming-downscale.spec.js)
- Use `process.env.TEST_WORKER_INDEX` to make fixture filenames unique per worker.
- Update `RED_4x4` and `CHECKER_8x8` constants to include the worker index.
- Update the `PNG fetch via URL path works` test to use a unique `test-serve-${workerIndex}.png` filename.

## Verification Plan

### Automated Tests
- Run Playwright tests with multiple workers and repetitions:
  `npx playwright test streaming-downscale-demo/test/streaming-downscale.spec.js --repeat-each 10`
- Confirm all 110 tests (11 tests * 10 repetitions) pass consistently.

### Manual Verification
- Checked browser console logs for any unexpected 404s or errors during test execution.
- Verified that individual worker cleanups (unlinking fixtures) no longer interfere with other workers.
