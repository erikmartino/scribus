# App Launcher Dropdown

**Date:** 2026-04-26
**Status:** In progress

## Goal

Replace the large pill-shaped "Document Browser" link in the app-shell ribbon
with a compact icon-only app launcher button (3x3 grid icon). Clicking the
button opens a dropdown listing available applications. Currently the only
entry is "Document Browser".

## Changes

### 1. app-shell-element.js

- Remove the `<a class="global-nav-link">` element and its CSS.
- Add a small app launcher button with a 3x3 grid SVG icon.
- Add a dropdown panel that appears on click, listing app links.
- Close dropdown on click-outside or Escape.

### 2. Update E2E tests

- Update `document-browser-navigation.spec.js` to click the launcher button,
  then click the Document Browser entry in the dropdown.

## Files

- `app-shell/lib/components/app-shell-element.js` (modified)
- `app-shell/test/document-browser-navigation.spec.js` (modified)
