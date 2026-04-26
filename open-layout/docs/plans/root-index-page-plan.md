# Root Index Page

**Date:** 2026-04-26
**Status:** In progress

## Goal

Add a root `index.html` so that visiting `http://localhost:8000/` shows a
landing page with a prominent button linking to the document browser, plus the
full directory listing that the server previously generated automatically.

## Changes

### 1. Add `?ls` JSON directory listing to server

Add support for a `?ls` query parameter on any directory URL. Returns a JSON
array of `{ name, isDir }` entries, sorted directories-first. This lets the
root `index.html` fetch and render the real directory contents dynamically.

### 2. Create `index.html` at the project root

- Styled consistently with the app-shell dark theme (reuses CSS variables
  from `app-shell/css/shell.css`).
- Prominent "Open Document Browser" button at the top.
- Dynamic directory listing fetched via `/?ls` and rendered as links.

### 3. E2E test

- Playwright test verifying the page loads, the button is visible and links
  to `/document-browser/`, clicking it navigates correctly, and the dynamic
  directory listing contains expected entries.

## Files

- `server.js` (modified -- `?ls` support)
- `index.html` (new)
- `test/root-index.spec.js` (new)
