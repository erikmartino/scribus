/**
 * CommandRegistry - Central registry for all application and plugin actions.
 */
export class CommandRegistry {
  constructor(shell) {
    this.shell = shell;
    this.commands = new Map();
  }

  register(cmd) {
    this.commands.set(cmd.id, {
      id: cmd.id,
      label: cmd.label || cmd.id,
      icon: cmd.icon || '',
      execute: cmd.execute,
      shortcut: cmd.shortcut || null,
      isEnabled: cmd.isEnabled || (() => true)
    });
  }

  execute(id, ...args) {
    const cmd = this.commands.get(id);
    if (!cmd) return;
    if (!cmd.isEnabled()) return;
    return cmd.execute(...args);
  }

  get(id) {
    return this.commands.get(id);
  }

  getAll() {
    return Array.from(this.commands.values());
  }
}

/**
 * CommandHistory - Manages the Undo/Redo stacks for a document.
 */
export class CommandHistory {
  constructor() {
    this.undoStack = [];
    this.redoStack = [];
    this.maxSize = 100;
  }

  submit(action) {
    action.execute();
    this.undoStack.push(action);
    if (this.undoStack.length > this.maxSize) this.undoStack.shift();
    this.redoStack = [];
  }

  undo() {
    if (this.undoStack.length === 0) return;
    const action = this.undoStack.pop();
    action.undo();
    this.redoStack.push(action);
  }

  redo() {
    if (this.redoStack.length === 0) return;
    const action = this.redoStack.pop();
    action.execute();
    this.undoStack.push(action);
  }

  canUndo() { return this.undoStack.length > 0; }
  canRedo() { return this.redoStack.length > 0; }
}
