// Draggable, resizable floating texture preview windows (per ripper) + Before/After split + Tiling + Clone brush
import { state } from '../core/app-state.js';
import { events } from '../core/event-manager.js';
import { history } from '../core/history-manager.js';
import { textureManager } from '../texture/texture-manager.js';
import { exportRipperStage } from '../export/image-exporter.js';

class FloatingPreviewManager {
  constructor() {
    this.layer = document.getElementById('floating-layer');
    this.windows = new Map(); // ripperId -> DOM element
    this.cloneSamplePt = { x: 0.5, y: 0.5 };
    this._bindEvents();
  }

  _bindEvents() {
    events.on('ripper:processed', (ripper) => {
      if (this.windows.has(ripper.id)) {
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

    if (this.windows.has(ripperId)) {
      const existing = this.windows.get(ripperId);
      this._bringToFront(existing);
      this._renderPreviewCanvas(ripperId);
      return;
    }

    const offset = (this.windows.size % 5) * 26;
    const cfg = {
      x: 120 + offset,
      y: 70 + offset,
      width: 390,
      height: 390,
      stage: 'final', // 'original' | 'perspective' | 'seamless' | 'final'
      tileMode: 1, // 1 | 2 | 4
      bgMode: 'checker', // 'checker' | 'transparent' | 'dark'
      zoom: 1,
      compareEnabled: false,
      compareSplit: 0.5,
      cloneBrush: false,
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
        <div style="display:flex;gap:3px;align-items:center">
          <button type="button" class="btn btn-sm fp-export">Export</button>
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
          <button type="button" class="tab-btn fp-tile active" data-tile="1">1x1</button>
          <button type="button" class="tab-btn fp-tile" data-tile="2">2x2</button>
          <button type="button" class="tab-btn fp-tile" data-tile="4">4x4</button>
        </div>
      </div>
      <div class="preview-toolbar">
        <div style="display:flex;gap:3px;align-items:center">
          <button type="button" class="btn btn-sm fp-compare">Compare</button>
          <button type="button" class="btn btn-sm fp-clone-brush" title="Alt+Click sets sample source, Drag repairs seams">Clone Brush</button>
        </div>
        <div style="display:flex;gap:3px;align-items:center">
          <select class="select fp-bg" style="height:22px;padding:1px 4px;font-size:11px">
            <option value="checker">Checker</option>
            <option value="dark">Dark</option>
            <option value="light">Light</option>
          </select>
          <button type="button" class="btn btn-sm fp-zoom-out">-</button>
          <button type="button" class="btn btn-sm fp-zoom-fit">Fit</button>
          <button type="button" class="btn btn-sm fp-zoom-in">+</button>
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

    this.layer.appendChild(win);
    this.windows.set(ripperId, win);
    this._bringToFront(win);
    this._wireWindowEvents(ripperId, win, cfg);
    this._renderPreviewCanvas(ripperId);
  }

  closeWindow(ripperId) {
    const win = this.windows.get(ripperId);
    if (win) {
      win.remove();
      this.windows.delete(ripperId);
    }
    state.floatingPreviews.delete(ripperId);
  }

  _bringToFront(win) {
    let maxZ = 41;
    for (const el of this.windows.values()) {
      const z = Number(el.style.zIndex || 41);
      if (z >= maxZ) maxZ = z + 1;
    }
    win.style.zIndex = String(maxZ);
  }

  _wireWindowEvents(ripperId, win, cfg) {
    win.addEventListener('pointerdown', () => this._bringToFront(win));

    // Drag window by titlebar
    const titlebar = win.querySelector('.floating-titlebar');
    titlebar.addEventListener('pointerdown', (e) => {
      if (e.target.closest('button')) return;
      const startX = e.clientX;
      const startY = e.clientY;
      const origX = win.offsetLeft;
      const origY = win.offsetTop;
      const onMove = (me) => {
        win.style.left = `${Math.max(0, origX + me.clientX - startX)}px`;
        win.style.top = `${Math.max(30, origY + me.clientY - startY)}px`;
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
        win.style.width = `${Math.max(280, origW + me.clientX - startX)}px`;
        win.style.height = `${Math.max(260, origH + me.clientY - startY)}px`;
        this._renderPreviewCanvas(ripperId);
      };
      const onUp = () => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
      };
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
    });

    win.querySelector('.fp-close').addEventListener('click', () => this.closeWindow(ripperId));
    win.querySelector('.fp-export').addEventListener('click', () => {
      const r = state.rippers.find((it) => it.id === ripperId);
      if (r) exportRipperStage(r, cfg.stage, 'png', 0.92);
    });
    win.querySelector('.fp-cancel-job').addEventListener('click', () => {
      textureManager.cancelProcess(ripperId);
    });

    win.querySelectorAll('.fp-stage').forEach((btn) => {
      btn.addEventListener('click', () => {
        cfg.stage = btn.dataset.stage;
        win.querySelectorAll('.fp-stage').forEach((b) => b.classList.toggle('active', b === btn));
        this._renderPreviewCanvas(ripperId);
      });
    });

    win.querySelectorAll('.fp-tile').forEach((btn) => {
      btn.addEventListener('click', () => {
        cfg.tileMode = Number(btn.dataset.tile);
        win.querySelectorAll('.fp-tile').forEach((b) => b.classList.toggle('active', b === btn));
        this._renderPreviewCanvas(ripperId);
      });
    });

    const area = win.querySelector('.preview-canvas-area');
    win.querySelector('.fp-bg').addEventListener('change', (e) => {
      cfg.bgMode = e.target.value;
      area.classList.toggle('checkerboard-bg', cfg.bgMode === 'checker');
      area.style.backgroundColor = cfg.bgMode === 'dark' ? '#111318' : cfg.bgMode === 'light' ? '#f3f4f6' : '';
    });

    win.querySelector('.fp-zoom-in').addEventListener('click', () => {
      cfg.zoom = Math.min(8, cfg.zoom * 1.25);
      this._renderPreviewCanvas(ripperId);
    });
    win.querySelector('.fp-zoom-out').addEventListener('click', () => {
      cfg.zoom = Math.max(0.25, cfg.zoom / 1.25);
      this._renderPreviewCanvas(ripperId);
    });
    win.querySelector('.fp-zoom-fit').addEventListener('click', () => {
      cfg.zoom = 1;
      this._renderPreviewCanvas(ripperId);
    });

    const splitLine = win.querySelector('.preview-split-line');
    const cmpBtn = win.querySelector('.fp-compare');
    cmpBtn.addEventListener('click', () => {
      cfg.compareEnabled = !cfg.compareEnabled;
      cmpBtn.classList.toggle('active', cfg.compareEnabled);
      splitLine.style.display = cfg.compareEnabled ? 'block' : 'none';
      this._renderPreviewCanvas(ripperId);
    });

    splitLine.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      const onMove = (me) => {
        const rect = area.getBoundingClientRect();
        cfg.compareSplit = Math.max(0.05, Math.min(0.95, (me.clientX - rect.left) / Math.max(1, rect.width)));
        splitLine.style.left = `${cfg.compareSplit * 100}%`;
        this._renderPreviewCanvas(ripperId);
      };
      const onUp = () => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
      };
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
    });

    // Interactive Clone Seam Repair Brush inside preview canvas
    const cloneBtn = win.querySelector('.fp-clone-brush');
    cloneBtn.addEventListener('click', () => {
      cfg.cloneBrush = !cfg.cloneBrush;
      cloneBtn.classList.toggle('active', cfg.cloneBrush);
      area.style.cursor = cfg.cloneBrush ? 'crosshair' : 'default';
      if (cfg.cloneBrush) {
        events.emit('toast', {
          type: 'info',
          message: 'Clone Brush active: Alt+Click sets sample point, Click/Drag repairs seams.',
        });
      }
    });

    const pCanvas = win.querySelector('.fp-canvas');
    pCanvas.addEventListener('pointerdown', (e) => {
      if (!cfg.cloneBrush) return;
      const ripper = state.rippers.find((r) => r.id === ripperId);
      if (!ripper) return;
      const rect = pCanvas.getBoundingClientRect();
      const nx = ((((e.clientX - rect.left) / Math.max(1, rect.width)) * cfg.tileMode) % 1 + 1) % 1;
      const ny = ((((e.clientY - rect.top) / Math.max(1, rect.height)) * cfg.tileMode) % 1 + 1) % 1;

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
  }

  _renderPreviewCanvas(ripperId) {
    const win = this.windows.get(ripperId);
    const ripper = state.rippers.find((r) => r.id === ripperId);
    const cfg = state.floatingPreviews.get(ripperId);
    if (!win || !ripper || !cfg) return;

    win.querySelector('.floating-title').textContent = `${ripper.name} — Texture Preview`;

    const area = win.querySelector('.preview-canvas-area');
    const canvas = win.querySelector('.fp-canvas');
    const stageCanvas = ripper.cachedStages?.[cfg.stage] || ripper.cachedStages?.final;
    const beforeCanvas = ripper.cachedStages?.perspective || ripper.cachedStages?.original;
    if (!stageCanvas) return;

    const areaW = Math.max(120, area.clientWidth - 16);
    const areaH = Math.max(120, area.clientHeight - 16);
    const baseSize = Math.min(areaW, areaH);
    const aspect = stageCanvas.width / Math.max(1, stageCanvas.height);

    let drawW = baseSize * cfg.zoom;
    let drawH = (baseSize / aspect) * cfg.zoom;
    if (drawH > areaH * cfg.zoom) {
      drawH = areaH * cfg.zoom;
      drawW = drawH * aspect;
    }

    canvas.width = Math.max(1, Math.round(drawW));
    canvas.height = Math.max(1, Math.round(drawH));

    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.imageSmoothingEnabled = !ripper.pixelArt?.enabled;

    const tiles = cfg.tileMode || 1;
    const tw = canvas.width / tiles;
    const th = canvas.height / tiles;

    for (let ty = 0; ty < tiles; ty++) {
      for (let tx = 0; tx < tiles; tx++) {
        ctx.drawImage(stageCanvas, tx * tw, ty * th, tw, th);
      }
    }

    if (cfg.compareEnabled && beforeCanvas) {
      const splitX = Math.round(canvas.width * cfg.compareSplit);
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, 0, splitX, canvas.height);
      ctx.clip();
      for (let ty = 0; ty < tiles; ty++) {
        for (let tx = 0; tx < tiles; tx++) {
          ctx.drawImage(beforeCanvas, tx * tw, ty * th, tw, th);
        }
      }
      ctx.restore();
    }
  }
}

export const floatingPreviews = new FloatingPreviewManager();
