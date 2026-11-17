// IndexedDB offline autosave and JSON project save/load manager
import { state } from './app-state.js';
import { events } from './event-manager.js';

const DB_NAME = 'texture_ripper_offline_db';
const DB_VERSION = 1;
const STORE_PROJECT = 'autosave';

class ProjectManager {
  constructor() {
    this._dbPromise = null;
    this._autosaveTimer = null;
  }

  _openDB() {
    if (this._dbPromise) return this._dbPromise;
    this._dbPromise = new Promise((resolve, reject) => {
      if (!window.indexedDB) {
        reject(new Error('IndexedDB not supported'));
        return;
      }
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains(STORE_PROJECT)) {
          db.createObjectStore(STORE_PROJECT, { keyPath: 'id' });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return this._dbPromise;
  }

  serializeProject() {
    return {
      format: 'texture-ripper-project',
      version: 1,
      savedAt: new Date().toISOString(),
      projectName: state.projectName,
      theme: state.theme,
      view: { ...state.view },
      activeImageId: state.activeImageId,
      activeRipperId: state.activeRipperId,
      images: state.images.map((img) => ({
        id: img.id,
        name: img.name,
        width: img.width,
        height: img.height,
        mimeType: img.mimeType,
        dataUrl: img.dataUrl,
        rotation: img.rotation || 0,
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
      atlas: {
        algorithm: state.atlas.algorithm,
        aspectRatio: state.atlas.aspectRatio,
        maxWidth: state.atlas.maxWidth,
        maxHeight: state.atlas.maxHeight,
        padding: state.atlas.padding,
        spacing: state.atlas.spacing,
        allowRotate: state.atlas.allowRotate,
        powerOfTwo: state.atlas.powerOfTwo,
        square: state.atlas.square,
        autoSize: state.atlas.autoSize,
        transparent: state.atlas.transparent,
        bgColor: state.atlas.bgColor,
        showBounds: state.atlas.showBounds,
        showNames: state.atlas.showNames,
        showUVs: state.atlas.showUVs,
        freeMoveGizmo: state.atlas.freeMoveGizmo,
        snapEnabled: state.atlas.snapEnabled,
        snapGridSize: state.atlas.snapGridSize,
        manualOverrides: JSON.parse(JSON.stringify(state.atlas.manualOverrides || {})),
        items: state.atlas.items.map((item) => ({ ...item })),
      },
    };
  }

  scheduleAutosave() {
    if (this._autosaveTimer) clearTimeout(this._autosaveTimer);
    this._autosaveTimer = setTimeout(() => {
      this.saveToIndexedDB().catch(() => {});
    }, 1200);
  }

  async saveToIndexedDB() {
    const db = await this._openDB();
    const data = this.serializeProject();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_PROJECT, 'readwrite');
      const store = tx.objectStore(STORE_PROJECT);
      store.put({ id: 'latest', payload: data });
      tx.oncomplete = () => {
        events.emit('project:autosaved', data.savedAt);
        resolve(data.savedAt);
      };
      tx.onerror = () => reject(tx.error);
    });
  }

  async loadFromIndexedDB() {
    try {
      const db = await this._openDB();
      return new Promise((resolve) => {
        const tx = db.transaction(STORE_PROJECT, 'readonly');
        const store = tx.objectStore(STORE_PROJECT);
        const req = store.get('latest');
        req.onsuccess = () => resolve(req.result?.payload || null);
        req.onerror = () => resolve(null);
      });
    } catch {
      return null;
    }
  }

  async clearAutosave() {
    try {
      const db = await this._openDB();
      const tx = db.transaction(STORE_PROJECT, 'readwrite');
      tx.objectStore(STORE_PROJECT).delete('latest');
    } catch {
      // ignore
    }
  }
}

export const projectManager = new ProjectManager();
