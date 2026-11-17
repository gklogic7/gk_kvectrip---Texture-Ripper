// TextureManager: manages independent rippers, debounced Web Worker processing, cancellation, and caching
import { state, getActiveImage, setActiveRipper } from '../core/app-state.js';
import { events } from '../core/event-manager.js';
import { history } from '../core/history-manager.js';
import { projectManager } from '../core/project-manager.js';
import { getEffectiveCanvas } from '../canvas/image-loader.js';
import { createTextureRipper } from './texture-ripper.js';

function bufferToCanvas(width, height, buffer) {
  const c = document.createElement('canvas');
  c.width = width;
  c.height = height;
  const ctx = c.getContext('2d');
  const imgData = new ImageData(new Uint8ClampedArray(buffer), width, height);
  ctx.putImageData(imgData, 0, 0);
  return c;
}

class TextureManager {
  constructor() {
    this.worker = null;
    this.debounceTimers = new Map();
    this.activeJobs = new Map(); // ripperId -> jobId
    this._initWorker();
    this._bindEvents();
  }

  _initWorker() {
    try {
      this.worker = new Worker(new URL('../workers/texture-worker.js', import.meta.url), {
        type: 'module',
      });
      this.worker.onmessage = (e) => this._onWorkerMessage(e.data);
      this.worker.onerror = (err) => {
        console.error('[TextureWorker Error]', err);
        events.emit('toast', { type: 'error', message: 'Texture worker encountered an error.' });
      };
    } catch (err) {
      console.error('Failed to spawn texture worker:', err);
    }
  }

  _bindEvents() {
    events.on('polygon:completed', ({ points }) => {
      const img = getActiveImage();
      if (!img) return;
      const ripper = createTextureRipper({ sourceImageId: img.id, points });
      state.rippers.push(ripper);
      state.atlas.items.push({
        ripperId: ripper.id,
        scale: 1,
        locked: false,
        customW: null,
        customH: null,
        order: state.atlas.items.length,
      });
      setActiveRipper(ripper.id);
      events.emit('rippers:changed', state.rippers);
      history.push(`Create ${ripper.name}`);
      this.scheduleProcess(ripper.id, 20);
      projectManager.scheduleAutosave();
    });

    events.on('ripper:geometryChanged', (ripper) => {
      if (!ripper) return;
      this.scheduleProcess(ripper.id, 80);
      projectManager.scheduleAutosave();
    });

    events.on('image:transformed', (img) => {
      if (!img) return;
      for (const r of state.rippers) {
        if (r.sourceImageId === img.id) {
          this.scheduleProcess(r.id, 80);
        }
      }
      projectManager.scheduleAutosave();
    });

    events.on('history:restored', () => {
      for (const r of state.rippers) {
        this.scheduleProcess(r.id, 40);
      }
      events.emit('rippers:changed', state.rippers);
      projectManager.scheduleAutosave();
    });
  }

  _onWorkerMessage(msg) {
    if (!msg) return;
    if (msg.type === 'progress') {
      const currentJob = this.activeJobs.get(msg.ripperId);
      if (currentJob !== msg.jobId) return;
      state.workerJobs.set(msg.ripperId, {
        jobId: msg.jobId,
        progress: msg.progress,
        stageLabel: msg.stageLabel,
      });
      events.emit('worker:progress', {
        ripperId: msg.ripperId,
        progress: msg.progress,
        stageLabel: msg.stageLabel,
      });
    } else if (msg.type === 'result') {
      const currentJob = this.activeJobs.get(msg.ripperId);
      if (currentJob !== msg.jobId) return;

      this.activeJobs.delete(msg.ripperId);
      state.workerJobs.delete(msg.ripperId);

      const ripper = state.rippers.find((r) => r.id === msg.ripperId);
      if (!ripper) return;

      const s = msg.stages;
      const finalCanvas = bufferToCanvas(s.final.width, s.final.height, s.final.buffer);

      // Generate small thumbnail for library without holding huge data URLs
      const thumbCanvas = document.createElement('canvas');
      const maxT = 128;
      const scale = Math.min(1, maxT / Math.max(finalCanvas.width, finalCanvas.height));
      thumbCanvas.width = Math.max(1, Math.round(finalCanvas.width * scale));
      thumbCanvas.height = Math.max(1, Math.round(finalCanvas.height * scale));
      const tCtx = thumbCanvas.getContext('2d');
      tCtx.imageSmoothingEnabled = !ripper.pixelArt?.enabled;
      tCtx.drawImage(finalCanvas, 0, 0, thumbCanvas.width, thumbCanvas.height);

      ripper.cachedStages = {
        original: bufferToCanvas(s.original.width, s.original.height, s.original.buffer),
        perspective: bufferToCanvas(s.perspective.width, s.perspective.height, s.perspective.buffer),
        seamless: bufferToCanvas(s.seamless.width, s.seamless.height, s.seamless.buffer),
        final: finalCanvas,
        thumbnailUrl: thumbCanvas.toDataURL('image/png'),
      };

      events.emit('ripper:processed', ripper);
      events.emit('worker:progress', { ripperId: msg.ripperId, progress: 100, done: true });
    } else if (msg.type === 'error') {
      this.activeJobs.delete(msg.ripperId);
      state.workerJobs.delete(msg.ripperId);
      events.emit('worker:progress', { ripperId: msg.ripperId, progress: 0, done: true });
      events.emit('toast', { type: 'error', message: msg.message || 'Texture processing failed' });
    }
  }

  scheduleProcess(ripperId, delayMs = 140) {
    if (this.debounceTimers.has(ripperId)) {
      clearTimeout(this.debounceTimers.get(ripperId));
    }
    const timer = setTimeout(() => {
      this.debounceTimers.delete(ripperId);
      this.processNow(ripperId);
    }, delayMs);
    this.debounceTimers.set(ripperId, timer);
  }

  cancelProcess(ripperId) {
    if (this.debounceTimers.has(ripperId)) {
      clearTimeout(this.debounceTimers.get(ripperId));
      this.debounceTimers.delete(ripperId);
    }
    const jobId = this.activeJobs.get(ripperId);
    if (jobId && this.worker) {
      this.worker.postMessage({ type: 'cancel', jobId });
      this.activeJobs.delete(ripperId);
      state.workerJobs.delete(ripperId);
      events.emit('worker:progress', { ripperId, progress: 0, done: true });
    }
  }

  processNow(ripperId) {
    const ripper = state.rippers.find((r) => r.id === ripperId);
    if (!ripper || !this.worker) return;

    const srcImg = state.images.find((i) => i.id === ripper.sourceImageId);
    if (!srcImg) return;

    const effCanvas = getEffectiveCanvas(srcImg);
    if (!effCanvas) return;

    // Cancel any previous pending worker job for this ripper
    const prevJob = this.activeJobs.get(ripperId);
    if (prevJob) {
      this.worker.postMessage({ type: 'cancel', jobId: prevJob });
    }

    const jobId = `job_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    this.activeJobs.set(ripperId, jobId);
    state.workerJobs.set(ripperId, { jobId, progress: 5, stageLabel: 'Queued' });
    events.emit('worker:progress', { ripperId, progress: 5, stageLabel: 'Queued' });

    const ctx = effCanvas.getContext('2d', { willReadFrequently: true });
    const imgData = ctx.getImageData(0, 0, effCanvas.width, effCanvas.height);
    const bufferCopy = imgData.data.buffer;

    this.worker.postMessage(
      {
        type: 'process',
        jobId,
        ripperId,
        sourceWidth: effCanvas.width,
        sourceHeight: effCanvas.height,
        sourceBuffer: bufferCopy,
        config: {
          points: ripper.points.map((p) => ({ x: p.x, y: p.y })),
          extraction: { ...ripper.extraction },
          seamless: { ...ripper.seamless },
          detail: { ...ripper.detail },
          color: { ...ripper.color },
          pixelArt: { ...ripper.pixelArt },
          clonePatches: ripper.clonePatches.map((cp) => ({ ...cp })),
        },
      },
      [bufferCopy]
    );
  }

  duplicateRipper(ripperId) {
    const orig = state.rippers.find((r) => r.id === ripperId);
    if (!orig) return null;

    const copy = JSON.parse(
      JSON.stringify({
        ...orig,
        cachedStages: undefined,
      })
    );
    copy.id = `rip_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    copy.name = `${orig.name}_copy`;
    copy.createdAt = Date.now();
    copy.points = orig.points.map((p) => ({ x: p.x + 16, y: p.y + 16 }));
    copy.cachedStages = {
      original: null,
      perspective: null,
      seamless: null,
      final: null,
      thumbnailUrl: '',
    };

    state.rippers.push(copy);
    state.atlas.items.push({
      ripperId: copy.id,
      scale: 1,
      locked: false,
      customW: null,
      customH: null,
      order: state.atlas.items.length,
    });
    setActiveRipper(copy.id);
    events.emit('rippers:changed', state.rippers);
    history.push(`Duplicate ${orig.name}`);
    this.scheduleProcess(copy.id, 10);
    projectManager.scheduleAutosave();
    return copy;
  }

  deleteRipper(ripperId) {
    const idx = state.rippers.findIndex((r) => r.id === ripperId);
    if (idx < 0) return;

    this.cancelProcess(ripperId);
    const removed = state.rippers[idx];
    // Memory cleanup for deleted texture buffers
    if (removed.cachedStages) {
      removed.cachedStages.original = null;
      removed.cachedStages.perspective = null;
      removed.cachedStages.seamless = null;
      removed.cachedStages.final = null;
      removed.cachedStages.thumbnailUrl = '';
    }
    state.floatingPreviews.delete(ripperId);
    state.rippers.splice(idx, 1);
    state.atlas.items = state.atlas.items.filter((i) => i.ripperId !== ripperId);
    if (state.atlas.manualOverrides) delete state.atlas.manualOverrides[ripperId];
    if (state.atlas.selectedPlacementId === ripperId) state.atlas.selectedPlacementId = null;

    if (state.activeRipperId === ripperId) {
      const next = state.rippers[Math.max(0, idx - 1)] || null;
      setActiveRipper(next ? next.id : null);
    }
    events.emit('rippers:changed', state.rippers);
    history.push(`Delete ${removed.name}`);
    projectManager.scheduleAutosave();
  }
}

export const textureManager = new TextureManager();
