// Non-destructive Undo/Redo history manager + Processing History log
import { state } from './app-state.js';
import { events } from './event-manager.js';

const MAX_HISTORY = 60;

class HistoryManager {
  constructor() {
    this.entries = []; // { id, label, timestamp, snapshot }
    this.index = -1;
    this._restoring = false;
  }

  captureSnapshot() {
    return {
      activeImageId: state.activeImageId,
      activeRipperId: state.activeRipperId,
      imageTransforms: state.images.map((img) => ({
        id: img.id,
        rotation: img.rotation,
        cropRect: img.cropRect ? { ...img.cropRect } : null,
      })),
      rippers: state.rippers.map((r) => ({
        id: r.id,
        name: r.name,
        sourceImageId: r.sourceImageId,
        category: r.category,
        favorite: r.favorite,
        enabled: r.enabled,
        points: r.points.map((p) => ({ x: p.x, y: p.y })),
        style: { ...r.style },
        extraction: { ...r.extraction },
        seamless: { ...r.seamless },
        detail: { ...r.detail },
        color: { ...r.color },
        pixelArt: { ...r.pixelArt },
        clonePatches: r.clonePatches.map((cp) => ({ ...cp })),
      })),
      atlasItems: state.atlas.items.map((item) => ({ ...item })),
      atlasOverrides: JSON.parse(JSON.stringify(state.atlas.manualOverrides || {})),
    };
  }

  push(label) {
    if (this._restoring) return;
    const snapshot = this.captureSnapshot();
    if (this.index < this.entries.length - 1) {
      this.entries = this.entries.slice(0, this.index + 1);
    }
    this.entries.push({
      id: `hist_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      label,
      timestamp: new Date().toLocaleTimeString(),
      snapshot,
    });
    if (this.entries.length > MAX_HISTORY) {
      this.entries.shift();
    }
    this.index = this.entries.length - 1;
    events.emit('history:changed', { canUndo: this.canUndo(), canRedo: this.canRedo() });
  }

  canUndo() {
    return this.index > 0;
  }

  canRedo() {
    return this.index >= 0 && this.index < this.entries.length - 1;
  }

  undo() {
    if (!this.canUndo()) return false;
    this.index -= 1;
    this._applySnapshot(this.entries[this.index].snapshot);
    return true;
  }

  redo() {
    if (!this.canRedo()) return false;
    this.index += 1;
    this._applySnapshot(this.entries[this.index].snapshot);
    return true;
  }

  jumpTo(targetIndex) {
    if (targetIndex < 0 || targetIndex >= this.entries.length) return;
    this.index = targetIndex;
    this._applySnapshot(this.entries[this.index].snapshot);
  }

  clear() {
    this.entries = [];
    this.index = -1;
    events.emit('history:changed', { canUndo: false, canRedo: false });
  }

  _applySnapshot(snapshot) {
    this._restoring = true;
    try {
      const cacheMap = new Map();
      for (const oldR of state.rippers) {
        cacheMap.set(oldR.id, oldR.cachedStages);
      }

      for (const tf of snapshot.imageTransforms || []) {
        const img = state.images.find((i) => i.id === tf.id);
        if (img) {
          img.rotation = tf.rotation;
          img.cropRect = tf.cropRect ? { ...tf.cropRect } : null;
        }
      }

      state.rippers = snapshot.rippers.map((r) => ({
        ...r,
        points: r.points.map((p) => ({ x: p.x, y: p.y })),
        style: { ...r.style },
        extraction: { ...r.extraction },
        seamless: { ...r.seamless },
        detail: { ...r.detail },
        color: { ...r.color },
        pixelArt: { ...r.pixelArt },
        clonePatches: r.clonePatches.map((cp) => ({ ...cp })),
        cachedStages: cacheMap.get(r.id) || {
          original: null,
          perspective: null,
          seamless: null,
          final: null,
          thumbnailUrl: '',
        },
      }));

      state.activeImageId = snapshot.activeImageId;
      state.activeRipperId = snapshot.activeRipperId;
      state.selectedVertexIndex = -1;
      state.atlas.items = (snapshot.atlasItems || []).map((i) => ({ ...i }));
      state.atlas.manualOverrides = JSON.parse(JSON.stringify(snapshot.atlasOverrides || {}));

      events.emit('history:restored', snapshot);
      events.emit('history:changed', { canUndo: this.canUndo(), canRedo: this.canRedo() });
    } finally {
      this._restoring = false;
    }
  }
}

export const history = new HistoryManager();
