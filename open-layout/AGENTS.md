# AGENTS.md

This file defines working rules for AI coding assistants in the `docs/` tree.

It is written to be followed by Codex, Claude, and Gemini style agents.

## Scope

- Applies to everything under `docs/`.
- If a deeper `AGENTS.md` exists in a subfolder, the deeper file overrides this one for that subtree.
- If platform/system/developer instructions conflict with this file, higher-priority instructions win.

## Project Context

- `docs/` contains demos, prototypes, and design notes used to explore Scribus text layout/editing behavior.
- Favor clarity and correctness over framework-heavy solutions.
- Keep demos easy to run locally with minimal setup.

## Required Behavior

1. Make focused changes only.
   - Do not refactor unrelated files.
   - Do not rename/move files unless required for the task.

2. Preserve existing conventions.
   - Use plain JavaScript modules where existing code uses them.
   - Keep comments brief and only where logic is non-obvious.
   - Default to ASCII unless the file already requires Unicode.

3. Verify code changes.
   - **Unit tests first, then E2E.** When implementing new features, always
     start by writing and running unit tests (`npm test`) against the module's
     `lib/` code. Only after unit tests are green, write Playwright E2E tests
     that exercise the module's `index.html` in a real browser. This order
     catches logic bugs early and keeps the feedback loop fast.
   - **Unit tests:** Run `npm test` from the project root. This auto-discovers
     all unit test files matching `*/test/test-*.js` across every module
     (app-shell, document-store, font-manager, spread-editor, story-editor).
     New modules must follow the same convention (`{module}/test/test-*.js`)
     to be picked up automatically.
   - **E2E tests:** Run `npm run test:e2e` (or `npx playwright test`) for
     Playwright browser tests.
   - If changes are docs-only, tests are optional.

4. Be safe with git.
   - Never use destructive commands (`reset --hard`, `checkout --`, force push) unless explicitly asked.
   - Do not commit or push unless explicitly asked.

5. Report clearly.
   - Summarize what changed and why.
   - List modified file paths.
   - List verification commands run (or why not run).

6. Use CDNs for Dependencies.
   - Always use CDN-hosted ESM versions of external libraries (e.g., via `https://cdn.jsdelivr.net/npm/.../+esm`).
   - Do not add new dependencies to `package.json`.
   - Maintain a "no build step" workflow for prototypes and demos.

7. Check Browser Logs and Verify UI via Playwright. (MANDATORY)
   - When modifying UI or browser-side logic, ALWAYS perform verification using Playwright tests (`app-shell/test/*.spec.js`) rather than manual MCP/browser subagent control.
   - Playwright tests provide the ONLY reliable way to verify cross-platform keyboard logic (e.g., Mac Command/Meta vs Ctrl). Ensure your test setup includes:
     ```javascript
     page.on('console', msg => {
         console.log(`BROWSER [${msg.type()}]: ${msg.text()}`);
     });
     page.on('pageerror', err => {
         console.error(`BROWSER [error]: ${err.message}`);
     });
     ```
   - All tests created or modified during development MUST BE KEPT in the repository to ensure continuous regression-free development.
   - Your final report for the task MUST explicitly state that Playwright tests were run, confirm that console logs were checked via terminal output, and quote any errors found (or confirm 'No console errors found').
   - **TROUBLESHOOTING**: If an initial visibility/readiness check (e.g., `toBeVisible()`) fails, search the terminal output specifically for `BROWSER [error]` or `SyntaxError`. Do not assume the issue is in the E2E test logic until browser-side crashes have been ruled out.

## Preferred Workflow

1. Read relevant files first.
2. Pick the smallest correct implementation.
3. Update/add tests when behavior changes.
4. Run verification.
5. Return a concise change summary.

## Planning Requirement

- When the user asks for implementation work, always create a plan file or update an existing relevant plan file before or during execution.
- If an assistant provides an implementation plan, it must be written to a Markdown file in the repository (not only in chat).
- Preferred location for cross-demo plans: `docs/plans/`.
- Use clear, dateable names such as `spread-editor-movable-resizable-boxes-plan.md`.
- Whenever work progresses on a planned task, update the corresponding plan file to reflect current status and remaining work.
- If a plan has no remaining work, remove it and update any index/reference files that list active plans.

## Architecture: App Shell / Plugin Boundary

See [docs/app-shell-boundary.md](docs/app-shell-boundary.md) for the
authoritative description of the public API between the app-shell
framework and editor plugins. Plugins must interact with the shell
exclusively through that API -- never by querying or mutating shell DOM
directly.

## Shared Layout and Components

- Maximize reuse of shared styles and components via the app shell (`app-shell/css/shell.css` and `ui-components/`).
- Do not duplicate CSS across demo pages. If a style appears in more than one demo, extract it into `shell.css` as a utility class or into a web component.
- Use Shadow DOM web components for encapsulating and sharing UI patterns (e.g., `<scribus-status-bar>`, `<scribus-dialog>`, `<scribus-button>`). Use slots to keep components flexible.
- Page-specific CSS that is genuinely unique to one demo may stay inline in that demo's `<style>` block, but keep it minimal.
- All demos must use relative paths for imports (`../app-shell/...`, not `/app-shell/...`). If a page is served from a different URL (e.g., a server rewrite), use a `<base>` tag to fix resolution.

## Editing Guidance for `docs/story-editor`

- Keep model logic in `lib/` pure where possible.
- Keep rendering/event wiring in `index.html` straightforward.
- Avoid introducing a build step unless requested.
- Maintain separation between:
  - story mutation (`story-ops.js`),
  - editor state/control (`editor-state.js`),
  - layout/position mapping (`layout-engine.js`, `positions.js`, `story-position.js`),
  - cursor view behavior (`cursor.js`).

## When Unsure

- If ambiguity changes architecture or user-visible behavior, ask one targeted question.
- Otherwise choose the most conservative option consistent with existing code.
