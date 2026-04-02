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
   - If changes touch `docs/story-editor/lib` or `docs/story-editor/test`, run:
     - `node --test test/*.js` from `docs/story-editor`.
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
   - Playwright tests provide the ONLY reliable way to verify cross-platform keyboard logic (e.g., Mac Command/Meta vs Ctrl) and to audit browser console logs via terminal output.
   - All tests created or modified during development MUST BE KEPT in the repository to ensure continuous regression-free development.
   - Your final report for the task MUST explicitly state that Playwright tests were run, confirm that console logs were checked via terminal output, and quote any errors found (or confirm 'No console errors found').

## Preferred Workflow

1. Read relevant files first.
2. Pick the smallest correct implementation.
3. Update/add tests when behavior changes.
4. Run verification.
5. Return a concise change summary.

## Planning Requirement

- When the user asks for implementation work, always create a plan file or update an existing relevant plan file before or during execution.
- If an assistant provides an implementation plan, it must be written to a Markdown file in the repository (not only in chat).
- Preferred location for cross-demo plans: `docs/notes/`.
- Use clear, dateable names such as `spread-editor-movable-resizable-boxes-plan.md`.
- Whenever work progresses on a planned task, update the corresponding plan file to reflect current status and remaining work.
- If a plan has no remaining work, remove it and update any index/reference files that list active plans.

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
