import { SpreadEditorApp } from './spread-editor-app.js';

const root = document;
const app = new SpreadEditorApp(root);

app.init().catch((err) => {
  console.error(err);
});
