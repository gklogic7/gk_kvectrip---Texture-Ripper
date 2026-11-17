// Customizable keyboard shortcuts manager
import { events } from './event-manager.js';

export const DEFAULT_SHORTCUTS = {
  openImage: { label: 'Open Image', combo: 'Ctrl+O' },
  saveProject: { label: 'Save Project', combo: 'Ctrl+S' },
  saveProjectAs: { label: 'Save Project As', combo: 'Ctrl+Shift+S' },
  undo: { label: 'Undo', combo: 'Ctrl+Z' },
  redo: { label: 'Redo', combo: 'Ctrl+Y' },
  deleteSelection: { label: 'Delete Selection', combo: 'Delete' },
  duplicateSelection: { label: 'Duplicate Selection', combo: 'Ctrl+D' },
  confirmPolygon: { label: 'Confirm Polygon', combo: 'Enter' },
  cancelSelection: { label: 'Cancel Current Selection', combo: 'Escape' },
  exportTexture: { label: 'Export Texture', combo: 'Ctrl+E' },
  fitToScreen: { label: 'Fit Image to Screen', combo: 'F' },
  toolSelect: { label: 'Select Tool', combo: 'V' },
  toolPolygon: { label: 'Polygon Ripper Tool', combo: 'P' },
  toolRect: { label: 'Rectangle Selection Tool', combo: 'R' },
  toolVertex: { label: 'Vertex Edit Tool', combo: 'A' },
  toolMove: { label: 'Move Polygon Tool', combo: 'M' },
};

const STORAGE_KEY = 'texture_ripper_shortcuts_v1';

class ShortcutsManager {
  constructor() {
    this.bindings = {};
    this.handlers = new Map();
    this.spacePressed = false;
    this.load();
  }

  load() {
    this.bindings = {};
    for (const [id, def] of Object.entries(DEFAULT_SHORTCUTS)) {
      this.bindings[id] = { ...def };
    }
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        for (const [id, combo] of Object.entries(parsed)) {
          if (this.bindings[id] && typeof combo === 'string') {
            this.bindings[id].combo = combo;
          }
        }
      }
    } catch {
      // ignore storage errors
    }
  }

  save() {
    const out = {};
    for (const [id, def] of Object.entries(this.bindings)) {
      out[id] = def.combo;
    }
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(out));
    } catch {
      // ignore
    }
    events.emit('shortcuts:changed', this.bindings);
  }

  setBinding(actionId, combo) {
    if (!this.bindings[actionId]) return;
    this.bindings[actionId].combo = combo;
    this.save();
  }

  resetDefaults() {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      // ignore
    }
    this.load();
    events.emit('shortcuts:changed', this.bindings);
  }

  registerAction(actionId, fn) {
    this.handlers.set(actionId, fn);
  }

  getComboText(actionId) {
    return this.bindings[actionId]?.combo || '';
  }

  eventToCombo(e) {
    const parts = [];
    if (e.ctrlKey || e.metaKey) parts.push('Ctrl');
    if (e.shiftKey) parts.push('Shift');
    if (e.altKey) parts.push('Alt');

    let key = e.key;
    if (key === ' ') key = 'Space';
    else if (key.length === 1) key = key.toUpperCase();
    else if (key === 'Del') key = 'Delete';
    else if (key === 'Esc') key = 'Escape';

    if (['Control', 'Shift', 'Alt', 'Meta'].includes(key)) {
      return null;
    }
    parts.push(key);
    return parts.join('+');
  }

  attachGlobalListeners() {
    window.addEventListener('keydown', (e) => {
      if (e.code === 'Space' && !this._isTypingTarget(e.target)) {
        this.spacePressed = true;
        document.body.classList.add('space-pan-active');
        events.emit('viewport:space', true);
      }

      if (this._isTypingTarget(e.target)) return;

      const combo = this.eventToCombo(e);
      if (!combo) return;

      // Support Ctrl+Shift+Z as alias for redo if unbound
      if (combo === 'Ctrl+Shift+Z') {
        const fn = this.handlers.get('redo');
        if (fn) {
          e.preventDefault();
          fn();
          return;
        }
      }

      for (const [actionId, def] of Object.entries(this.bindings)) {
        if (def.combo.toLowerCase() === combo.toLowerCase()) {
          const fn = this.handlers.get(actionId);
          if (fn) {
            e.preventDefault();
            fn();
            return;
          }
        }
      }
    });

    window.addEventListener('keyup', (e) => {
      if (e.code === 'Space') {
        this.spacePressed = false;
        document.body.classList.remove('space-pan-active');
        events.emit('viewport:space', false);
      }
    });
  }

  _isTypingTarget(target) {
    if (!target) return false;
    const tag = target.tagName;
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable;
  }
}

export const shortcuts = new ShortcutsManager();
