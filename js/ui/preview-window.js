// Draggable, resizable floating texture preview windows with cursor-anchored zoom/pan navigation,
// linked X/Y (px) & U/V (0-1) wrap sliders + custom numeric inputs, Repeat X/Y tiling, Inspector sync, and full-res WYSIWYG Preview Export
import { state } from '../core/app-state.js';
import { events } from '../core/event-manager.js';
import { history } from '../core/history-manager.js';
import { projectManager } from '../core/project-manager.js';
import { shortcuts } from '../core/shortcuts-manager.js';
import { textureManager } from '../texture/texture-manager.js';
import { ensureRipperFx } from '../texture/texture-ripper.js';
import { applyRipperFxToCanvas } from '../atlas/atlas-fx-engine.js';
import { canvasToBlob, triggerBlobDownload } from '../export/image-exporter.js';
import { ICONS } from './icons.js';

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

function wrap01(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  if (n >= 0 && n <= 1) return n;
  return ((n % 1) + 1) % 1;
}

export function renderWrappedTiledCanvas(srcCanvas, offU, offV, repeatX, repeatY, pixelArt = false, beforeCanvas = null, compareSplit = 0.5, compareEnabled = false) {
  if (!srcCanvas) return null;

  const rx = clamp(Number(repeatX) || 1, 0.25, 8);
  const ry = clamp(Number(repeatY) || 1, 0.25, 8);
  const rawW = Math.max(8, Math.round(srcCanvas.width * rx));
  const rawH = Math.max(8, Math.round(srcCanvas.height * ry));
  const capScale = Math.min(1, 4096 / Math.max(rawW, rawH));
  const outW = Math.max(8, Math.round(rawW * capScale));
  const outH = Math.max(8, Math.round(rawH * capScale));
  const tileW = Math.max(1, srcCanvas.width * capScale);
  const tileH = Math.max(1, srcCanvas.height * capScale);

  const out = document.createElement('canvas');
  out.width = outW;
  out.height = outH;
  const ctx = out.getContext('2d');
  ctx.imageSmoothingEnabled = !pixelArt;

  const drawLayer = (layerSrc, clipW = null) => {
    const single = document.createElement('canvas');
    single.width = Math.max(1, Math.round(tileW));
    single.height = Math.max(1, Math.round(tileH));
    const sctx = single.getContext('2d');
    sctx.imageSmoothingEnabled = !pixelArt;
    const ox = wrap01(offU) * single.width;
    const oy = wrap01(offV) * single.height;
    for (let sx = -1; sx <= 0; sx++) {
      for (let sy = -1; sy <= 0; sy++) {
        sctx.drawImage(
          layerSrc,
          ox + sx * single.width,
          oy + sy * single.height,
          single.width,
          single.height
        );
      }
    }

    const pat = ctx.createPattern(single, 'repeat');
    if (!pat) return;
    ctx.save();
    if (clipW !== null) {
      ctx.beginPath();
      ctx.rect(0, 0, clipW, outH);
      ctx.clip();
    }
    ctx.fillStyle = pat;
    ctx.fillRect(0, 0, outW, outH);
    ctx.restore();
  };

  drawLayer(srcCanvas, null);

  if (compareEnabled && beforeCanvas) {
    const splitX = Math.round(outW * clamp(compareSplit, 0.05, 0.95));
    drawLayer(beforeCanvas, splitX);
  }

  return out;
}

class FloatingPreviewManager {
  constructor() {
    this.layer = document.getElementById('floating-layer');
    this.windows = new Map(); // ripperId -> DOM element
    this.cleanups = new Map(); // ripperId -> cleanup fn[]
    this.cloneSamplePt = { x: 0.5, y: 0.5 };
    this._bindEvents();
  }

  _bindEvents() {
    events.on('ripper:processed', (ripper) => {
      if (this.windows.has(ripper.id)) {
        this._syncControlValues(ripper.id);
        this._renderPreviewCanvas(ripper.id);
      }
    });
    events.on('rippers:changed', () => {
      for (const id of [...this.windows.keys()]) {
        if (!state.rippers.some((r) => r.id === id)) {
          this.closeWindow(id);
        }
      }
    });
    events.on('ripper:fxChanged', ({ ripperId } = {}) => {
      for (const id of this.windows.keys()) {
        if (!ripperId || id === ripperId) {
          this._syncControlValues(id);
          this._renderPreviewCanvas(id);
        }
      }
    });
    events.on('preview:transformChanged', ({ ripperId, source } = {}) => {
      if (source === 'preview') return;
      const cfg = state.floatingPreviews.get(ripperId);
      const ripper = state.rippers.find((r) => r.id === ripperId);
      if (!cfg || !ripper || !this.windows.has(ripperId)) return;
      const pt = ripper.previewTransform || { offsetU: 0, offsetV: 0, repeatX: 1, repeatY: 1, applyFx: true };
      cfg.offsetU = wrap01(pt.offsetU ?? 0);
      cfg.offsetV = wrap01(pt.offsetV ?? 0);
      cfg.repeatX = clamp(pt.repeatX ?? 1, 0.25, 8);
      cfg.repeatY = clamp(pt.repeatY ?? 1, 0.25, 8);
      cfg.applyFx = pt.applyFx ?? true;
      this._syncControlValues(ripperId);
      this._renderPreviewCanvas(ripperId);
    });
    events.on('worker:progress', ({ ripperId, progress, stageLabel, done }) => {
      const win = this.windows.get(ripperId);
      if (!win) return;
      const bar = win.querySelector('.fp-progress-wrap');
      const fill = win.querySelector('.worker-progress-fill');
      const label = win.querySelector('.fp-progress-label');
      if (!bar) return;
      if (done) {
        bar.style.display = 'none';
      } else {
        bar.style.display = 'flex';
        fill.style.width = `${progress}%`;
        label.textContent = stageLabel || 'Processing';
      }
    });
  }

  openWindow(ripperId) {
    const ripper = state.rippers.find((r) => r.id === ripperId);
    if (!ripper) return;

    if (!ripper.previewTransform) {
      ripper.previewTransform = { offsetU: 0, offsetV: 0, repeatX: 1, repeatY: 1 };
    }

    if (this.windows.has(ripperId)) {
      const existing = this.windows.get(ripperId);
      const cfg = state.floatingPreviews.get(ripperId);
      if (cfg?.minimized) {
        cfg.minimized = false;
        existing.classList.remove('minimized');
      }
      this._bringToFront(existing);
      this._syncControlValues(ripperId);
      this._renderPreviewCanvas(ripperId);
      return;
    }

    const offset = (this.windows.size % 5) * 26;
    const pt = ripper.previewTransform;
    const vw = Math.max(380, window.innerWidth);
    const vh = Math.max(360, window.innerHeight);
    const width = Math.min(500, vw - 24);
    const height = Math.min(530, vh - 48);
    const x = Math.max(12, Math.min(vw - width - 12, 110 + offset));
    const y = Math.max(34, Math.min(vh - height - 12, 64 + offset));

    const cfg = {
      x,
      y,
      width,
      height,
      minimized: false,
      stage: 'final', // 'original' | 'perspective' | 'seamless' | 'final'
      bgMode: 'checker', // 'checker' | 'dark' | 'light'
      zoom: 1,
      panX: 0,
      panY: 0,
      isFit: true,
      panMode: false,
      compareEnabled: false,
      compareSplit: 0.5,
      cloneBrush: false,
      offsetU: wrap01(pt.offsetU ?? 0),
      offsetV: wrap01(pt.offsetV ?? 0),
      repeatX: clamp(pt.repeatX ?? 1, 0.25, 8),
      repeatY: clamp(pt.repeatY ?? 1, 0.25, 8),
      applyFx: pt.applyFx ?? true,
      syncInspector: true,
    };
    state.floatingPreviews.set(ripperId, cfg);

    const win = document.createElement('div');
    win.className = 'floating-window';
    win.style.left = `${cfg.x}px`;
    win.style.top = `${cfg.y}px`;
    win.style.width = `${cfg.width}px`;
    win.style.height = `${cfg.height}px`;

    win.innerHTML = `
      <div class="floating-titlebar">
        <span class="floating-title">${ripper.name} — Texture Preview</span>
        <div style="display:flex;gap:3px;align-items:center;flex-shrink:0">
          <button type="button" class="btn btn-sm btn-primary fp-export" title="Export exact composed preview at full pixel resolution">Export Preview</button>
          <button type="button" class="btn-icon fp-min" title="Minimize / Restore">${ICONS.minimize}</button>
          <button type="button" class="btn-icon fp-close" title="Close preview">✕</button>
        </div>
      </div>
      <div class="preview-toolbar">
        <div style="display:flex;gap:2px">
          <button type="button" class="tab-btn fp-stage active" data-stage="final">Final</button>
          <button type="button" class="tab-btn fp-stage" data-stage="seamless">Seamless</button>
          <button type="button" class="tab-btn fp-stage" data-stage="perspective">Persp</button>
          <button type="button" class="tab-btn fp-stage" data-stage="original">Orig</button>
        </div>
        <div style="display:flex;gap:2px">
          <button type="button" class="tab-btn fp-tile" data-tile="1">1×1</button>
          <button type="button" class="tab-btn fp-tile" data-tile="2">2×2</button>
          <button type="button" class="tab-btn fp-tile" data-tile="4">4×4</button>
        </div>
      </div>
      <div class="preview-toolbar">
        <div style="display:flex;gap:3px;align-items:center">
          <button type="button" class="btn btn-sm fp-fx" title="Toggle Overlay Filter &amp; Post-FX in Texture Preview &amp; Export">FX</button>
          <button type="button" class="btn btn-sm fp-compare" title="Toggle before/after comparison split">Compare</button>
          <button type="button" class="btn btn-sm fp-clone-brush" title="Alt+Click sets sample source, Click/Drag repairs seams">Clone</button>
          <select class="select fp-bg" style="height:22px;padding:1px 4px;font-size:11px" title="Backdrop">
            <option value="checker">Checker</option>
            <option value="dark">Dark</option>
            <option value="light">Light</option>
          </select>
        </div>
        <div style="display:flex;gap:2px;align-items:center">
          <button type="button" class="btn btn-sm fp-nav-pan" title="Pan mode (or hold Space / Middle-Mouse drag)">Pan</button>
          <button type="button" class="btn btn-sm fp-zoom-out" title="Zoom Out">−</button>
          <button type="button" class="btn btn-sm fp-zoom-fit btn-primary" title="Fit to Viewport">Fit</button>
          <button type="button" class="btn btn-sm fp-zoom-100" title="Actual Pixels (100%)">100%</button>
          <button type="button" class="btn btn-sm fp-zoom-in" title="Zoom In">+</button>
          <span class="mono fp-zoom-val" style="min-width:38px;text-align:right;font-size:10px">100%</span>
        </div>
      </div>
      <div class="fp-uv-panel">
        <div class="fp-uv-row">
          <span class="fp-uv-lbl">X / U</span>
          <input type="range" class="slider fp-u-slider" min="0" max="1000" step="1" value="0" title="Horizontal wrap offset" />
          <label class="fp-uv-field" title="Horizontal offset in pixels">
            <span>X</span>
            <input type="number" class="input input-num mono fp-x-px fp-uv-num" step="1" value="0" />
          </label>
          <label class="fp-uv-field" title="Horizontal UV offset (0.000 – 1.000)">
            <span>U</span>
            <input type="number" class="input input-num mono fp-u-num fp-uv-num" min="0" max="1" step="0.01" value="0.000" />
          </label>
        </div>
        <div class="fp-uv-row">
          <span class="fp-uv-lbl">Y / V</span>
          <input type="range" class="slider fp-v-slider" min="0" max="1000" step="1" value="0" title="Vertical wrap offset" />
          <label class="fp-uv-field" title="Vertical offset in pixels">
            <span>Y</span>
            <input type="number" class="input input-num mono fp-y-px fp-uv-num" step="1" value="0" />
          </label>
          <label class="fp-uv-field" title="Vertical UV offset (0.000 – 1.000)">
            <span>V</span>
            <input type="number" class="input input-num mono fp-v-num fp-uv-num" min="0" max="1" step="0.01" value="0.000" />
          </label>
        </div>
        <div class="fp-uv-repeat-row">
          <div class="fp-uv-cell">
            <span class="fp-uv-lbl">Rep X</span>
            <input type="range" class="slider fp-rx-slider" min="1" max="6" step="0.25" value="1" />
            <input type="number" class="input input-num mono fp-rx-num fp-uv-num" style="width:44px" min="0.25" max="8" step="0.25" value="1" />
          </div>
          <div class="fp-uv-cell">
            <span class="fp-uv-lbl">Rep Y</span>
            <input type="range" class="slider fp-ry-slider" min="1" max="6" step="0.25" value="1" />
            <input type="number" class="input input-num mono fp-ry-num fp-uv-num" style="width:44px" min="0.25" max="8" step="0.25" value="1" />
          </div>
          <div style="display:flex;align-items:center;gap:6px;flex-shrink:0">
            <label class="check-label" style="font-size:10px" title="Sync preview X/Y, U/V, and Repeat with Properties Inspector">
              <input type="checkbox" class="fp-sync-insp" checked /> Sync
            </label>
            <button type="button" class="btn btn-sm fp-uv-reset" title="Reset X/Y, U/V, and Repeat to 1×1">Reset</button>
          </div>
        </div>
      </div>
      <div class="worker-progress fp-progress-wrap" style="display:none;margin:4px 6px 0">
        <span class="fp-progress-label">Processing</span>
        <div class="worker-progress-bar"><div class="worker-progress-fill" style="width:0%"></div></div>
        <button type="button" class="btn btn-sm fp-cancel-job">Cancel</button>
      </div>
      <div class="preview-canvas-area checkerboard-bg">
        <canvas class="fp-canvas"></canvas>
        <div class="preview-split-line" style="display:none;left:50%">
          <div class="preview-split-handle">⇄</div>
        </div>
      </div>
      <div class="floating-resize-handle"></div>
    `;

    this.layer?.appendChild(win);
    this.windows.set(ripperId, win);
    this.cleanups.set(ripperId, []);
    this._bringToFront(win);
    this._wireWindowEvents(ripperId, win, cfg);
    this._syncControlValues(ripperId);
    this._renderPreviewCanvas(ripperId);
  }

  closeWindow(ripperId) {
    const winCleanups = this.cleanups.get(ripperId);
    if (winCleanups) {
      for (const fn of winCleanups) {
        try {
          fn();
        } catch {
          // ignore cleanup errors
        }
      }
      this.cleanups.delete(ripperId);
    }
    const win = this.windows.get(ripperId);
    if (win) {
      win.remove();
      this.windows.delete(ripperId);
    }
    state.floatingPreviews.delete(ripperId);
  }

  _bringToFront(win) {
    let maxZ = 53;
    if (this.layer) {
      for (const el of this.layer.children) {
        const z = Number(el.style?.zIndex || 41);
        if (z >= maxZ) maxZ = z + 1;
      }
    }
    win.style.zIndex = String(maxZ);
  }

  _getStageCanvas(ripper, stage) {
    if (!ripper || !ripper.cachedStages) return null;
    return ripper.cachedStages[stage] || ripper.cachedStages.final || ripper.cachedStages.perspective || null;
  }

  _syncTransformToRipper(ripperId, commit = false) {
    const ripper = state.rippers.find((r) => r.id === ripperId);
    const cfg = state.floatingPreviews.get(ripperId);
    if (!ripper || !cfg) return;

    ripper.previewTransform = {
      offsetU: cfg.offsetU,
      offsetV: cfg.offsetV,
      repeatX: cfg.repeatX,
      repeatY: cfg.repeatY,
      applyFx: !!cfg.applyFx,
    };

    if (cfg.syncInspector) {
      events.emit('preview:transformChanged', { ripperId, source: 'preview' });
      if (commit) {
        projectManager.scheduleAutosave();
      }
    }
  }

  _syncControlValues(ripperId) {
    const win = this.windows.get(ripperId);
    const cfg = state.floatingPreviews.get(ripperId);
    const ripper = state.rippers.find((r) => r.id === ripperId);
    if (!win || !cfg || !ripper) return;

    const src = this._getStageCanvas(ripper, cfg.stage);
    const srcW = src ? src.width : ripper.extraction.outWidth || 256;
    const srcH = src ? src.height : ripper.extraction.outHeight || 256;

    const uSlider = win.querySelector('.fp-u-slider');
    const vSlider = win.querySelector('.fp-v-slider');
    const xPxInp = win.querySelector('.fp-x-px');
    const yPxInp = win.querySelector('.fp-y-px');
    const uNumInp = win.querySelector('.fp-u-num');
    const vNumInp = win.querySelector('.fp-v-num');
    const rxSlider = win.querySelector('.fp-rx-slider');
    const rySlider = win.querySelector('.fp-ry-slider');
    const rxNum = win.querySelector('.fp-rx-num');
    const ryNum = win.querySelector('.fp-ry-num');
    const syncChk = win.querySelector('.fp-sync-insp');

    if (uSlider) uSlider.value = String(Math.round(cfg.offsetU * 1000));
    if (vSlider) vSlider.value = String(Math.round(cfg.offsetV * 1000));
    if (xPxInp && document.activeElement !== xPxInp) xPxInp.value = String(Math.round(cfg.offsetU * srcW));
    if (yPxInp && document.activeElement !== yPxInp) yPxInp.value = String(Math.round(cfg.offsetV * srcH));
    if (uNumInp && document.activeElement !== uNumInp) uNumInp.value = cfg.offsetU.toFixed(3);
    if (vNumInp && document.activeElement !== vNumInp) vNumInp.value = cfg.offsetV.toFixed(3);

    if (rxSlider) rxSlider.value = String(Math.min(6, cfg.repeatX));
    if (rySlider) rySlider.value = String(Math.min(6, cfg.repeatY));
    if (rxNum && document.activeElement !== rxNum) rxNum.value = String(cfg.repeatX);
    if (ryNum && document.activeElement !== ryNum) ryNum.value = String(cfg.repeatY);
    if (syncChk) syncChk.checked = !!cfg.syncInspector;

    win.querySelectorAll('.fp-tile').forEach((b) => {
      const t = Number(b.dataset.tile);
      b.classList.toggle('active', Math.abs(cfg.repeatX - t) < 0.01 && Math.abs(cfg.repeatY - t) < 0.01);
    });

    const fxBtn = win.querySelector('.fp-fx');
    if (fxBtn) {
      const ripFx = ensureRipperFx(ripper);
      const hasAnyFx = (ripFx?.filter && ripFx.filter !== 'none') || !!ripFx?.post?.enabled;
      fxBtn.classList.toggle('btn-primary', !!cfg.applyFx);
      fxBtn.textContent = hasAnyFx && cfg.applyFx ? 'FX On' : 'FX';
      fxBtn.title = hasAnyFx
        ? `Toggle live FX (${ripFx.filter !== 'none' ? ripFx.filter : 'Post-FX'})`
        : 'Toggle live FX (currently None — configure in Atlas FX & Shaders)';
    }
  }

  _fitView(ripperId) {
    const win = this.windows.get(ripperId);
    const cfg = state.floatingPreviews.get(ripperId);
    if (!win || !cfg) return;
    const area = win.querySelector('.preview-canvas-area');
    const canvas = win.querySelector('.fp-canvas');
    if (!area || !canvas || !canvas.width || !canvas.height) return;
    const aw = area.clientWidth;
    const ah = area.clientHeight;
    if (aw <= 0 || ah <= 0) return;

    const pad = 12;
    const fitZoom = clamp(Math.min((aw - pad * 2) / canvas.width, (ah - pad * 2) / canvas.height), 0.12, 4);
    cfg.zoom = fitZoom;
    cfg.panX = Math.round((aw - canvas.width * fitZoom) / 2);
    cfg.panY = Math.round((ah - canvas.height * fitZoom) / 2);
    cfg.isFit = true;
  }

  _applyNavTransform(ripperId) {
    const win = this.windows.get(ripperId);
    const cfg = state.floatingPreviews.get(ripperId);
    const ripper = state.rippers.find((r) => r.id === ripperId);
    if (!win || !cfg || !ripper) return;

    const area = win.querySelector('.preview-canvas-area');
    const canvas = win.querySelector('.fp-canvas');
    if (!area || !canvas) return;

    if (cfg.isFit) {
      this._fitView(ripperId);
    }

    canvas.style.transform = `translate(${cfg.panX}px, ${cfg.panY}px) scale(${cfg.zoom})`;
    canvas.style.imageRendering = ripper.pixelArt?.enabled || cfg.zoom >= 2 ? 'pixelated' : 'auto';

    const zoomVal = win.querySelector('.fp-zoom-val');
    if (zoomVal) zoomVal.textContent = `${Math.round(cfg.zoom * 100)}%`;

    win.querySelector('.fp-nav-pan')?.classList.toggle('btn-primary', !!cfg.panMode);
    win.querySelector('.fp-zoom-fit')?.classList.toggle('btn-primary', !!cfg.isFit);
    win.querySelector('.fp-zoom-100')?.classList.toggle('btn-primary', !cfg.isFit && Math.abs(cfg.zoom - 1) < 0.01);

    const splitLine = win.querySelector('.preview-split-line');
    if (splitLine) {
      splitLine.style.display = cfg.compareEnabled ? 'block' : 'none';
      if (cfg.compareEnabled) {
        const splitLeft = cfg.panX + canvas.width * cfg.compareSplit * cfg.zoom;
        splitLine.style.left = `${Math.round(splitLeft)}px`;
      }
    }
  }

  composePreviewCanvas(ripperId) {
    const ripper = state.rippers.find((r) => r.id === ripperId);
    const cfg = state.floatingPreviews.get(ripperId);
    if (!ripper || !cfg) return null;

    const rawStage = this._getStageCanvas(ripper, cfg.stage);
    const beforeCanvas = ripper.cachedStages?.perspective || ripper.cachedStages?.original;
    if (!rawStage) return null;

    const stageCanvas = cfg.applyFx ? applyRipperFxToCanvas(rawStage, ensureRipperFx(ripper)) : rawStage;

    return renderWrappedTiledCanvas(
      stageCanvas,
      cfg.offsetU,
      cfg.offsetV,
      cfg.repeatX,
      cfg.repeatY,
      !!ripper.pixelArt?.enabled,
      beforeCanvas,
      cfg.compareSplit,
      cfg.compareEnabled
    );
  }

  async exportComposedPreview(ripperId) {
    const ripper = state.rippers.find((r) => r.id === ripperId);
    const cfg = state.floatingPreviews.get(ripperId);
    if (!ripper || !cfg) return;

    const composed = this.composePreviewCanvas(ripperId);
    if (!composed) {
      events.emit('toast', { type: 'warning', message: 'Texture preview is not processed yet.' });
      return;
    }

    const blob = await canvasToBlob(composed, 'png', 0.92);
    const safeName = ripper.name.replace(/[^a-z0-9_\-]+/gi, '_');
    const filename = `${safeName}_${cfg.stage}_preview.png`;
    triggerBlobDownload(blob, filename);
    events.emit('toast', {
      type: 'success',
      message: `Exported ${filename} (${composed.width}×${composed.height})`,
    });
  }

  _wireWindowEvents(ripperId, win, cfg) {
    const cleanups = this.cleanups.get(ripperId) || [];
    win.addEventListener('pointerdown', () => this._bringToFront(win));

    // Drag window by titlebar
    const titlebar = win.querySelector('.floating-titlebar');
    titlebar.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || e.target.closest('button')) return;
      const startX = e.clientX;
      const startY = e.clientY;
      const origX = win.offsetLeft;
      const origY = win.offsetTop;
      const onMove = (me) => {
        cfg.x = Math.max(0, Math.min(window.innerWidth - 120, origX + me.clientX - startX));
        cfg.y = Math.max(28, Math.min(window.innerHeight - 36, origY + me.clientY - startY));
        win.style.left = `${cfg.x}px`;
        win.style.top = `${cfg.y}px`;
      };
      const onUp = () => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
      };
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
    });

    // Resize window
    const resizer = win.querySelector('.floating-resize-handle');
    resizer.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      const startX = e.clientX;
      const startY = e.clientY;
      const origW = win.offsetWidth;
      const origH = win.offsetHeight;
      const onMove = (me) => {
        cfg.width = Math.max(340, Math.min(window.innerWidth - cfg.x - 8, origW + me.clientX - startX));
        cfg.height = Math.max(300, Math.min(window.innerHeight - cfg.y - 8, origH + me.clientY - startY));
        win.style.width = `${cfg.width}px`;
        win.style.height = `${cfg.height}px`;
        this._applyNavTransform(ripperId);
      };
      const onUp = () => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
      };
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
    });

    win.querySelector('.fp-min')?.addEventListener('click', () => {
      cfg.minimized = !cfg.minimized;
      win.classList.toggle('minimized', cfg.minimized);
      const minBtn = win.querySelector('.fp-min');
      if (minBtn) {
        minBtn.innerHTML = cfg.minimized ? ICONS.restoreWin : ICONS.minimize;
        minBtn.title = cfg.minimized ? 'Restore preview window' : 'Minimize preview window';
      }
      if (!cfg.minimized) this._applyNavTransform(ripperId);
    });

    win.querySelector('.fp-close')?.addEventListener('click', () => this.closeWindow(ripperId));
    win.querySelector('.fp-export')?.addEventListener('click', () => this.exportComposedPreview(ripperId));
    win.querySelector('.fp-cancel-job')?.addEventListener('click', () => {
      textureManager.cancelProcess(ripperId);
    });

    win.querySelectorAll('.fp-stage').forEach((btn) => {
      btn.addEventListener('click', () => {
        cfg.stage = btn.dataset.stage;
        win.querySelectorAll('.fp-stage').forEach((b) => b.classList.toggle('active', b === btn));
        this._syncControlValues(ripperId);
        this._renderPreviewCanvas(ripperId);
      });
    });

    win.querySelectorAll('.fp-tile').forEach((btn) => {
      btn.addEventListener('click', () => {
        const n = Number(btn.dataset.tile) || 1;
        cfg.repeatX = n;
        cfg.repeatY = n;
        this._syncControlValues(ripperId);
        this._syncTransformToRipper(ripperId, true);
        this._renderPreviewCanvas(ripperId);
      });
    });

    const area = win.querySelector('.preview-canvas-area');
    const canvas = win.querySelector('.fp-canvas');

    win.querySelector('.fp-bg')?.addEventListener('change', (e) => {
      cfg.bgMode = e.target.value;
      area.classList.toggle('checkerboard-bg', cfg.bgMode === 'checker');
      area.style.backgroundColor = cfg.bgMode === 'dark' ? '#111318' : cfg.bgMode === 'light' ? '#f3f4f6' : '';
    });

    const zoomAt = (nextZoom, clientX = null, clientY = null) => {
      const clamped = clamp(nextZoom, 0.12, 12);
      const rect = area.getBoundingClientRect();
      const sx = clientX == null ? rect.width / 2 : clientX - rect.left;
      const sy = clientY == null ? rect.height / 2 : clientY - rect.top;
      const wx = (sx - cfg.panX) / Math.max(0.01, cfg.zoom);
      const wy = (sy - cfg.panY) / Math.max(0.01, cfg.zoom);
      cfg.zoom = clamped;
      cfg.isFit = false;
      cfg.panX = sx - wx * clamped;
      cfg.panY = sy - wy * clamped;
      this._applyNavTransform(ripperId);
    };

    const syncCursor = () => {
      if (cfg.panMode || shortcuts.spacePressed) area.style.cursor = 'grab';
      else if (cfg.cloneBrush) area.style.cursor = 'crosshair';
      else area.style.cursor = 'default';
    };

    win.querySelector('.fp-nav-pan')?.addEventListener('click', () => {
      cfg.panMode = !cfg.panMode;
      this._applyNavTransform(ripperId);
      syncCursor();
    });
    win.querySelector('.fp-zoom-in')?.addEventListener('click', () => zoomAt(cfg.zoom * 1.25));
    win.querySelector('.fp-zoom-out')?.addEventListener('click', () => zoomAt(cfg.zoom / 1.25));
    win.querySelector('.fp-zoom-fit')?.addEventListener('click', () => {
      cfg.isFit = true;
      this._applyNavTransform(ripperId);
    });
    win.querySelector('.fp-zoom-100')?.addEventListener('click', () => {
      cfg.isFit = false;
      cfg.zoom = 1;
      cfg.panX = Math.round((area.clientWidth - canvas.width) / 2);
      cfg.panY = Math.round((area.clientHeight - canvas.height) / 2);
      this._applyNavTransform(ripperId);
    });

    // Wheel / pinch zoom centered on cursor
    area.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        const sensitivity = e.ctrlKey ? 0.01 : 0.0018;
        const factor = clamp(Math.exp(-e.deltaY * sensitivity), 0.5, 2);
        zoomAt(cfg.zoom * factor, e.clientX, e.clientY);
      },
      { passive: false }
    );

    const offSpace = events.on('viewport:space', () => syncCursor());
    cleanups.push(offSpace);

    if (typeof ResizeObserver !== 'undefined') {
      const ro = new ResizeObserver(() => {
        if (cfg.isFit) this._applyNavTransform(ripperId);
      });
      ro.observe(area);
      cleanups.push(() => ro.disconnect());
    }

    // Linked X/U & Y/V sliders + custom numeric inputs + Repeat X/Y
    const getSrcDims = () => {
      const r = state.rippers.find((x) => x.id === ripperId);
      const sc = this._getStageCanvas(r, cfg.stage);
      return {
        w: sc ? sc.width : r?.extraction?.outWidth || 256,
        h: sc ? sc.height : r?.extraction?.outHeight || 256,
      };
    };

    const updateOffset = (uVal, vVal, commit = false) => {
      cfg.offsetU = wrap01(uVal);
      cfg.offsetV = wrap01(vVal);
      this._syncControlValues(ripperId);
      this._syncTransformToRipper(ripperId, commit);
      this._renderPreviewCanvas(ripperId);
    };

    const uSlider = win.querySelector('.fp-u-slider');
    const vSlider = win.querySelector('.fp-v-slider');
    const xPxInp = win.querySelector('.fp-x-px');
    const yPxInp = win.querySelector('.fp-y-px');
    const uNumInp = win.querySelector('.fp-u-num');
    const vNumInp = win.querySelector('.fp-v-num');

    uSlider?.addEventListener('input', () => updateOffset(Number(uSlider.value) / 1000, cfg.offsetV, false));
    uSlider?.addEventListener('change', () => updateOffset(Number(uSlider.value) / 1000, cfg.offsetV, true));
    vSlider?.addEventListener('input', () => updateOffset(cfg.offsetU, Number(vSlider.value) / 1000, false));
    vSlider?.addEventListener('change', () => updateOffset(cfg.offsetU, Number(vSlider.value) / 1000, true));

    xPxInp?.addEventListener('input', () => {
      const { w } = getSrcDims();
      updateOffset(Number(xPxInp.value || 0) / Math.max(1, w), cfg.offsetV, false);
    });
    xPxInp?.addEventListener('change', () => {
      const { w } = getSrcDims();
      updateOffset(Number(xPxInp.value || 0) / Math.max(1, w), cfg.offsetV, true);
    });
    yPxInp?.addEventListener('input', () => {
      const { h } = getSrcDims();
      updateOffset(cfg.offsetU, Number(yPxInp.value || 0) / Math.max(1, h), false);
    });
    yPxInp?.addEventListener('change', () => {
      const { h } = getSrcDims();
      updateOffset(cfg.offsetU, Number(yPxInp.value || 0) / Math.max(1, h), true);
    });

    uNumInp?.addEventListener('input', () => updateOffset(Number(uNumInp.value || 0), cfg.offsetV, false));
    uNumInp?.addEventListener('change', () => updateOffset(Number(uNumInp.value || 0), cfg.offsetV, true));
    vNumInp?.addEventListener('input', () => updateOffset(cfg.offsetU, Number(vNumInp.value || 0), false));
    vNumInp?.addEventListener('change', () => updateOffset(cfg.offsetU, Number(vNumInp.value || 0), true));

    const updateRepeat = (rx, ry, commit = false) => {
      cfg.repeatX = clamp(Number(rx) || 1, 0.25, 8);
      cfg.repeatY = clamp(Number(ry) || 1, 0.25, 8);
      this._syncControlValues(ripperId);
      this._syncTransformToRipper(ripperId, commit);
      this._renderPreviewCanvas(ripperId);
    };

    const rxSlider = win.querySelector('.fp-rx-slider');
    const rySlider = win.querySelector('.fp-ry-slider');
    const rxNum = win.querySelector('.fp-rx-num');
    const ryNum = win.querySelector('.fp-ry-num');

    rxSlider?.addEventListener('input', () => updateRepeat(rxSlider.value, cfg.repeatY, false));
    rxSlider?.addEventListener('change', () => updateRepeat(rxSlider.value, cfg.repeatY, true));
    rySlider?.addEventListener('input', () => updateRepeat(cfg.repeatX, rySlider.value, false));
    rySlider?.addEventListener('change', () => updateRepeat(cfg.repeatX, rySlider.value, true));
    rxNum?.addEventListener('change', () => updateRepeat(rxNum.value, cfg.repeatY, true));
    ryNum?.addEventListener('change', () => updateRepeat(cfg.repeatX, ryNum.value, true));

    win.querySelector('.fp-sync-insp')?.addEventListener('change', (e) => {
      cfg.syncInspector = e.target.checked;
      if (cfg.syncInspector) {
        this._syncTransformToRipper(ripperId, true);
      }
    });

    win.querySelector('.fp-uv-reset')?.addEventListener('click', () => {
      cfg.offsetU = 0;
      cfg.offsetV = 0;
      cfg.repeatX = 1;
      cfg.repeatY = 1;
      this._syncControlValues(ripperId);
      this._syncTransformToRipper(ripperId, true);
      this._renderPreviewCanvas(ripperId);
    });

    win.querySelector('.fp-fx')?.addEventListener('click', () => {
      cfg.applyFx = !cfg.applyFx;
      this._syncControlValues(ripperId);
      this._syncTransformToRipper(ripperId, true);
      this._renderPreviewCanvas(ripperId);
    });

    // Compare split toggle & handle drag
    const splitLine = win.querySelector('.preview-split-line');
    const cmpBtn = win.querySelector('.fp-compare');
    cmpBtn?.addEventListener('click', () => {
      cfg.compareEnabled = !cfg.compareEnabled;
      cmpBtn.classList.toggle('btn-primary', cfg.compareEnabled);
      this._renderPreviewCanvas(ripperId);
    });

    splitLine?.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      e.preventDefault();
      if (splitLine.isConnected && e.pointerId != null) {
        try {
          splitLine.setPointerCapture(e.pointerId);
        } catch {
          // Ignore InvalidStateError for synthetic or inactive pointers
        }
      }
      const onMove = (me) => {
        const rect = area.getBoundingClientRect();
        const canvasX = (me.clientX - rect.left - cfg.panX) / Math.max(0.01, cfg.zoom);
        cfg.compareSplit = clamp(canvasX / Math.max(1, canvas.width), 0.05, 0.95);
        this._renderPreviewCanvas(ripperId);
      };
      const onUp = () => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
      };
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
    });

    // Interactive Clone Seam Repair Brush toggle
    const cloneBtn = win.querySelector('.fp-clone-brush');
    cloneBtn?.addEventListener('click', () => {
      cfg.cloneBrush = !cfg.cloneBrush;
      cloneBtn.classList.toggle('btn-primary', cfg.cloneBrush);
      syncCursor();
      if (cfg.cloneBrush) {
        events.emit('toast', {
          type: 'info',
          message: 'Clone Brush active: Alt+Click sets sample point, Click/Drag repairs seams.',
        });
      }
    });

    // Panning + Clone Brush pointer handlers on .preview-canvas-area
    let panDrag = null;
    area.addEventListener('pointerdown', (e) => {
      const isPanGesture = e.button === 1 || (e.button === 0 && (cfg.panMode || shortcuts.spacePressed));
      if (isPanGesture) {
        e.preventDefault();
        cfg.isFit = false;
        panDrag = {
          startX: e.clientX,
          startY: e.clientY,
          origPanX: cfg.panX,
          origPanY: cfg.panY,
        };
        if (area.isConnected && e.pointerId != null) {
          try {
            area.setPointerCapture(e.pointerId);
          } catch {
            // Ignore InvalidStateError for synthetic or inactive pointers
          }
        }
        area.style.cursor = 'grabbing';
        this._applyNavTransform(ripperId);
        return;
      }

      if (!cfg.cloneBrush || e.button !== 0) return;
      const ripper = state.rippers.find((r) => r.id === ripperId);
      const stageCanvas = this._getStageCanvas(ripper, cfg.stage);
      if (!ripper || !stageCanvas) return;

      const rect = area.getBoundingClientRect();
      const ptX = (e.clientX - rect.left - cfg.panX) / Math.max(0.01, cfg.zoom);
      const ptY = (e.clientY - rect.top - cfg.panY) / Math.max(0.01, cfg.zoom);
      const capScale = Math.min(1, 4096 / Math.max(stageCanvas.width * cfg.repeatX, stageCanvas.height * cfg.repeatY));
      const tileW = Math.max(1, stageCanvas.width * capScale);
      const tileH = Math.max(1, stageCanvas.height * capScale);
      const nx = wrap01(ptX / tileW - cfg.offsetU);
      const ny = wrap01(ptY / tileH - cfg.offsetV);

      if (e.altKey) {
        this.cloneSamplePt = { x: nx, y: ny };
        events.emit('toast', { type: 'info', message: 'Clone source sample point updated.' });
        return;
      }

      ripper.seamless.method = 'clone';
      ripper.seamless.enabled = true;
      ripper.clonePatches.push({
        srcX: this.cloneSamplePt.x,
        srcY: this.cloneSamplePt.y,
        dstX: nx,
        dstY: ny,
        radius: Math.max(8, Math.round(ripper.extraction.outWidth * 0.06)),
        strength: 0.9,
      });
      textureManager.scheduleProcess(ripper.id, 30);
      history.push(`Manual clone repair (${ripper.name})`);
    });

    area.addEventListener('pointermove', (e) => {
      if (!panDrag) return;
      cfg.panX = panDrag.origPanX + (e.clientX - panDrag.startX);
      cfg.panY = panDrag.origPanY + (e.clientY - panDrag.startY);
      this._applyNavTransform(ripperId);
    });

    const endPan = () => {
      if (!panDrag) return;
      panDrag = null;
      syncCursor();
    };
    area.addEventListener('pointerup', endPan);
    area.addEventListener('pointercancel', endPan);

    syncCursor();
  }

  _renderPreviewCanvas(ripperId) {
    const win = this.windows.get(ripperId);
    const ripper = state.rippers.find((r) => r.id === ripperId);
    const cfg = state.floatingPreviews.get(ripperId);
    if (!win || !ripper || !cfg) return;

    const titleEl = win.querySelector('.floating-title');
    const stageCanvas = this._getStageCanvas(ripper, cfg.stage);
    const composed = this.composePreviewCanvas(ripperId);
    if (titleEl && composed) {
      titleEl.textContent = `${ripper.name} — Texture Preview (${composed.width}×${composed.height})`;
    } else if (titleEl) {
      titleEl.textContent = `${ripper.name} — Texture Preview`;
    }

    const canvas = win.querySelector('.fp-canvas');
    if (!canvas || !composed || !stageCanvas) return;

    canvas.width = composed.width;
    canvas.height = composed.height;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.imageSmoothingEnabled = !ripper.pixelArt?.enabled;
    ctx.drawImage(composed, 0, 0);

    this._applyNavTransform(ripperId);
  }
}

export const floatingPreviews = new FloatingPreviewManager();
