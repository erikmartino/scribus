import { SpreadEditorApp } from './spread-editor-app.js';
import shell from '../../app-shell/lib/shell-core.js';

const root = document;
const app = new SpreadEditorApp(root);

shell.registerPlugin(app);
