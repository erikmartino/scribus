# Spread Editor Demo

`spread-editor` is a new demo that reuses the Story Editor core modules while adding a facing-pages (spread) view.

## Structure

- `index.html` - combined spread app shell and controls
- `app/main.js` - bootstraps the combined app
- `app/spread-editor-app.js` - combined app wiring (state, input, render loop)
- `app/spread-geometry.js` - spread/page/column geometry computation
- `lib/story-editor-core.js` - stable re-export boundary to `../story-editor/lib/*`
- `components/story-core/index.html` - standalone core-editing component page
- `components/spread-layout/index.html` - standalone spread-layout component page

## Why this layout scales

- Keeps **editing engine reuse explicit** through one import boundary (`lib/story-editor-core.js`).
- Keeps **demo-specific behavior isolated** in `app/`.
- Makes it easy to add more demos (e.g. booklet, galley, facing-notes) without duplicating editor internals.

## Run

From `docs/`:

- `npm run start`
- Combined app: `http://localhost:8000/spread-editor/`
- Story-core component: `http://localhost:8000/spread-editor/components/story-core/`
- Spread-layout component: `http://localhost:8000/spread-editor/components/spread-layout/`
