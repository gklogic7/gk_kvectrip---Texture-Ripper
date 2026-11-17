// Layered Center Canvas Workspace: image display, pan/zoom, grid, pixel rulers, polygon overlays, and touch/mouse interaction
import {
  state,
  getActiveImage,
  getActiveRipper,
  getRippersForActiveImage,
  TOOL_IDS,
} from '../core/app-state.js';
import { events } from '../core/event-manager.js';
import { shortcuts } from '../core/shortcuts-manager.js';
import { getEffectiveCanvas, getEffectiveDimensions, importImageFiles } from './image-loader.js';
import { PolygonToolController } from './polygon-tool.js';
import { VertexEditorController } from './vertex-editor.js';
import { orderQuadCorners } from './perspective-engine.js';

export class CanvasManager {
  constructor() {
    this.viewport = document.getElementById('canvas-viewport');
    this.stage = document.getElementById('canvas-stage');
    this.baseCanvas = document.getElementById('base-canvas');
    this.overlayCanvas = document.getElementById('overlay-canvas');
    this.rulerTop = document.getElementById('ruler-top');
    this.rulerLeft = document.getElementById('ruler-left');
    this.dropzone = document.getElementById('empty-dropzone');
    this.hud = document.getElementById('canvas-hud');

    this.baseCtx = this.baseCanvas.getContext('2d');
    this.overlayCtx = this.overlayCanvas.getContext('2d');
    this.rulerTopCtx = this.rulerTop.getContext('2d');
    this.rulerLeftCtx = this.rulerLeft.getContext('2d');

    this.polygonTool = new PolygonToolController();
    this.vertexEditor = new VertexEditorController();

    this.isPanning = false;
    this.panStart = null;
    this.cursorImgPt = null;
    this.activePointers = new Map();
    this.pinchDistStart = null;
    this.pinchZoomStart = null;

    this._baseRaf = 0;
    this._overlayRaf = 0;

    this._bindEvents();
    this.resize();
  }

  _bindEvents() {
    window.addEventListener('resize', () => this.resize());

    const ro = new ResizeObserver(() => this.resize());
    ro.observe(this.viewport);

    // Drag and drop image files onto viewport
    this.viewport.addEventListener('dragover', (e) => {
      e.preventDefault();
      this.viewport.classList.add('drag-over');
    });
    this.viewport.addEventListener('dragleave', () => {
      this.viewport.classList.remove('drag-over');
    });
    this.viewport.addEventListener('drop', async (e) => {
      e.preventDefault();
      this.viewport.classList.remove('drag-over');
      if (e.dataTransfer?.files?.length) {
        await importImageFiles(e.dataTransfer.files);
      }
    });

    // Clipboard image paste
    window.addEventListener('paste', async (e) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      const files = [];
      for (const item of items) {
        if (item.kind === 'file' && item.type.startsWith('image/')) {
          const f = item.getAsFile();
          if (f) files.push(f);
        }
      }
      if (files.length) {
        await importImageFiles(files);
      }
    });

    // Pointer interactions (mouse + touch)
    this.overlayCanvas.addEventListener('contextmenu', (e) => e.preventDefault());

    this.overlayCanvas.addEventListener('pointerdown', (e) => {
      this.viewport.focus();
      this.activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (this.overlayCanvas.isConnected && e.pointerId != null) {
        try {
          this.overlayCanvas.setPointerCapture(e.pointerId);
        } catch {
          // Ignore InvalidStateError for synthetic or inactive pointers
        }
      }

      // Two-finger pinch zoom on touch
      if (this.activePointers.size === 2) {
        const pts = [...this.activePointers.values()];
        this.pinchDistStart = Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y);
        this.pinchZoomStart = state.view.zoom;
        this.isPanning = false;
        return;
      }

      const img = getActiveImage();
      if (!img) return;

      const stagePt = this._clientToStage(e.clientX, e.clientY);

      // Middle mouse button, Space+Drag, or Pan tool
      if (e.button === 1 || shortcuts.spacePressed || state.activeTool === TOOL_IDS.PAN) {
        this.isPanning = true;
        this.panStart = {
          clientX: e.clientX,
          clientY: e.clientY,
          panX: state.view.panX,
          panY: state.view.panY,
        };
        return;
      }

      if (state.activeTool === TOOL_IDS.ZOOM) {
        const factor = e.altKey || e.button === 2 ? 0.8 : 1.25;
        this.zoomAtStagePoint(stagePt.x, stagePt.y, state.view.zoom * factor);
        return;
      }

      const imgPt = this.stageToImage(stagePt.x, stagePt.y);

      if ([TOOL_IDS.POLYGON, TOOL_IDS.RECT, TOOL_IDS.FREEFORM].includes(state.activeTool)) {
        if (e.button === 2 && state.draftPolygon.active) {
          this.polygonTool.cancelDraft();
          return;
        }
        this.polygonTool.onPointerDown(imgPt, e);
      } else if (state.activeTool === TOOL_IDS.ERASER) {
        // Right click or click inside active ripper: erase/remove nearest vertex if > 3, or nudge repair
        const active = getActiveRipper();
        if (active) {
          const vIdx = this.vertexEditor.findVertexHit(imgPt, active);
          if (vIdx >= 0 && active.points.length > 3) {
            active.points.splice(vIdx, 1);
            events.emit('ripper:geometryChanged', active);
            this.scheduleOverlayDraw();
          }
        }
      } else {
        this.vertexEditor.onPointerDown(imgPt, e);
      }
    });

    this.overlayCanvas.addEventListener('pointermove', (e) => {
      if (this.activePointers.has(e.pointerId)) {
        this.activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      }

      if (this.activePointers.size === 2 && this.pinchDistStart) {
        const pts = [...this.activePointers.values()];
        const dist = Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y);
        const midX = (pts[0].x + pts[1].x) / 2;
        const midY = (pts[0].y + pts[1].y) / 2;
        const stageMid = this._clientToStage(midX, midY);
        this.zoomAtStagePoint(stageMid.x, stageMid.y, this.pinchZoomStart * (dist / this.pinchDistStart));
        return;
      }

      if (this.isPanning && this.panStart) {
        state.view.panX = this.panStart.panX + (e.clientX - this.panStart.clientX);
        state.view.panY = this.panStart.panY + (e.clientY - this.panStart.clientY);
        this.scheduleBaseDraw();
        this.scheduleOverlayDraw();
        this.updateHUD();
        return;
      }

      const img = getActiveImage();
      if (!img) return;
      const stagePt = this._clientToStage(e.clientX, e.clientY);
      const imgPt = this.stageToImage(stagePt.x, stagePt.y);
      this.cursorImgPt = imgPt;
      this.updateHUD();

      if ([TOOL_IDS.POLYGON, TOOL_IDS.RECT, TOOL_IDS.FREEFORM].includes(state.activeTool)) {
        this.polygonTool.onPointerMove(imgPt);
      } else {
        this.vertexEditor.onPointerMove(imgPt);
      }
    });

    const endPointer = (e) => {
      this.activePointers.delete(e.pointerId);
      if (this.activePointers.size < 2) {
        this.pinchDistStart = null;
      }
      if (this.isPanning) {
        this.isPanning = false;
        this.panStart = null;
        return;
      }
      if ([TOOL_IDS.POLYGON, TOOL_IDS.RECT, TOOL_IDS.FREEFORM].includes(state.activeTool)) {
        this.polygonTool.onPointerUp();
      } else {
        this.vertexEditor.onPointerUp();
      }
    };

    this.overlayCanvas.addEventListener('pointerup', endPointer);
    this.overlayCanvas.addEventListener('pointercancel', endPointer);

    this.overlayCanvas.addEventListener('dblclick', () => {
      if (state.activeTool === TOOL_IDS.POLYGON && state.draftPolygon.active) {
        this.polygonTool.confirmDraft();
      }
    });

    this.overlayCanvas.addEventListener(
      'wheel',
      (e) => {
        if (!getActiveImage()) return;
        e.preventDefault();
        const stagePt = this._clientToStage(e.clientX, e.clientY);
        const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
        this.zoomAtStagePoint(stagePt.x, stagePt.y, state.view.zoom * factor);
      },
      { passive: false }
    );

    // App state listeners
    events.on('image:selected', () => {
      this._syncDropzone();
      this.scheduleBaseDraw();
      this.scheduleOverlayDraw();
      this.updateHUD();
    });
    events.on('images:changed', () => {
      this._syncDropzone();
      this.scheduleBaseDraw();
      this.scheduleOverlayDraw();
    });
    events.on('image:transformed', () => {
      this.scheduleBaseDraw();
      this.scheduleOverlayDraw();
    });
    events.on('ripper:selected', () => this.scheduleOverlayDraw());
    events.on('rippers:changed', () => this.scheduleOverlayDraw());
    events.on('history:restored', () => {
      this.scheduleBaseDraw();
      this.scheduleOverlayDraw();
    });
    events.on('canvas:redrawBase', () => this.scheduleBaseDraw());
    events.on('canvas:redrawOverlay', () => this.scheduleOverlayDraw());
    events.on('view:changed', () => {
      this._syncRulerClass();
      this.resize();
      this.scheduleBaseDraw();
      this.scheduleOverlayDraw();
      this.updateHUD();
    });
    events.on('view:fit', () => this.fitToScreen());
    events.on('theme:changed', () => {
      this.scheduleBaseDraw();
      this.scheduleOverlayDraw();
    });
  }

  _syncDropzone() {
    const img = getActiveImage();
    this.dropzone.classList.toggle('hidden', !!img);
    this.hud.classList.toggle('hidden', !img);
    this._syncRulerClass();
  }

  _syncRulerClass() {
    const show = !!getActiveImage() && state.view.showRuler;
    this.viewport.classList.toggle('has-rulers', show);
  }

  _clientToStage(clientX, clientY) {
    const rect = this.stage.getBoundingClientRect();
    return { x: clientX - rect.left, y: clientY - rect.top };
  }

  stageToImage(sx, sy) {
    return {
      x: (sx - state.view.panX) / state.view.zoom,
      y: (sy - state.view.panY) / state.view.zoom,
    };
  }

  imageToStage(ix, iy) {
    return {
      x: ix * state.view.zoom + state.view.panX,
      y: iy * state.view.zoom + state.view.panY,
    };
  }

  resize() {
    const rect = this.stage.getBoundingClientRect();
    const w = Math.max(1, Math.floor(rect.width));
    const h = Math.max(1, Math.floor(rect.height));
    const dpr = window.devicePixelRatio || 1;

    for (const canvas of [this.baseCanvas, this.overlayCanvas]) {
      canvas.width = Math.floor(w * dpr);
      canvas.height = Math.floor(h * dpr);
    }

    const rTopRect = this.rulerTop.getBoundingClientRect();
    this.rulerTop.width = Math.max(1, Math.floor(rTopRect.width * dpr));
    this.rulerTop.height = Math.max(1, Math.floor(20 * dpr));

    const rLeftRect = this.rulerLeft.getBoundingClientRect();
    this.rulerLeft.width = Math.max(1, Math.floor(20 * dpr));
    this.rulerLeft.height = Math.max(1, Math.floor(rLeftRect.height * dpr));

    this.scheduleBaseDraw();
    this.scheduleOverlayDraw();
  }

  zoomAtStagePoint(sx, sy, targetZoom) {
    let z = Math.max(0.05, Math.min(32, targetZoom));
    if (state.view.integerZoom && z >= 1) {
      z = Math.max(1, Math.round(z));
    }
    const imgPt = this.stageToImage(sx, sy);
    state.view.zoom = z;
    state.view.panX = sx - imgPt.x * z;
    state.view.panY = sy - imgPt.y * z;
    this.scheduleBaseDraw();
    this.scheduleOverlayDraw();
    this.updateHUD();
  }

  fitToScreen() {
    const img = getActiveImage();
    if (!img) return;
    const dims = getEffectiveDimensions(img);
    const rect = this.stage.getBoundingClientRect();
    const pad = 40;
    const availW = Math.max(60, rect.width - pad);
    const availH = Math.max(60, rect.height - pad);
    let z = Math.min(availW / dims.width, availH / dims.height);
    z = Math.max(0.05, Math.min(8, z));
    if (state.view.integerZoom && z >= 1) {
      z = Math.max(1, Math.floor(z));
    }
    state.view.zoom = z;
    state.view.panX = (rect.width - dims.width * z) / 2;
    state.view.panY = (rect.height - dims.height * z) / 2;
    this.scheduleBaseDraw();
    this.scheduleOverlayDraw();
    this.updateHUD();
  }

  zoomTo100() {
    const img = getActiveImage();
    if (!img) return;
    const dims = getEffectiveDimensions(img);
    const rect = this.stage.getBoundingClientRect();
    state.view.zoom = 1;
    state.view.panX = (rect.width - dims.width) / 2;
    state.view.panY = (rect.height - dims.height) / 2;
    this.scheduleBaseDraw();
    this.scheduleOverlayDraw();
    this.updateHUD();
  }

  resetView() {
    this.fitToScreen();
  }

  scheduleBaseDraw() {
    if (this._baseRaf) return;
    this._baseRaf = requestAnimationFrame(() => {
      this._baseRaf = 0;
      this.drawBase();
      this.drawRulers();
    });
  }

  scheduleOverlayDraw() {
    if (this._overlayRaf) return;
    this._overlayRaf = requestAnimationFrame(() => {
      this._overlayRaf = 0;
      this.drawOverlay();
    });
  }

  drawBase() {
    const dpr = window.devicePixelRatio || 1;
    const w = this.baseCanvas.width / dpr;
    const h = this.baseCanvas.height / dpr;
    const ctx = this.baseCtx;

    ctx.save();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    const img = getActiveImage();
    if (!img) {
      ctx.restore();
      return;
    }

    const effCanvas = getEffectiveCanvas(img);
    const z = state.view.zoom;
    const px = state.view.panX;
    const py = state.view.panY;
    const dw = effCanvas.width * z;
    const dh = effCanvas.height * z;

    // Checkerboard under image for alpha transparency
    const style = getComputedStyle(document.documentElement);
    const checkerA = style.getPropertyValue('--checker-a').trim() || '#1e2128';
    const checkerB = style.getPropertyValue('--checker-b').trim() || '#262a33';
    ctx.fillStyle = checkerA;
    ctx.fillRect(px, py, dw, dh);
    ctx.save();
    ctx.beginPath();
    ctx.rect(px, py, dw, dh);
    ctx.clip();
    const cs = 12;
    ctx.fillStyle = checkerB;
    for (let y = Math.floor(py / cs) * cs; y < py + dh; y += cs * 2) {
      for (let x = Math.floor(px / cs) * cs; x < px + dw; x += cs * 2) {
        ctx.fillRect(x, y, cs, cs);
        ctx.fillRect(x + cs, y + cs, cs, cs);
      }
    }
    ctx.restore();

    // Draw actual source image
    ctx.imageSmoothingEnabled = !(state.view.pixelGrid || z >= 3);
    ctx.drawImage(effCanvas, px, py, dw, dh);

    // Image outer border
    ctx.strokeStyle = 'rgba(255,255,255,0.22)';
    ctx.lineWidth = 1;
    ctx.strokeRect(px - 0.5, py - 0.5, dw + 1, dh + 1);

    // Optional snap/reference grid
    if (state.view.showGrid && state.view.gridSize * z >= 6) {
      const step = state.view.gridSize * z;
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let gx = px; gx <= px + dw + 0.5; gx += step) {
        ctx.moveTo(Math.round(gx) + 0.5, py);
        ctx.lineTo(Math.round(gx) + 0.5, py + dh);
      }
      for (let gy = py; gy <= py + dh + 0.5; gy += step) {
        ctx.moveTo(px, Math.round(gy) + 0.5);
        ctx.lineTo(px + dw, Math.round(gy) + 0.5);
      }
      ctx.stroke();
    }

    // Optional pixel-art 1px grid at higher zoom
    if (state.view.pixelGrid && z >= 4) {
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.14)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let ix = 0; ix <= effCanvas.width; ix++) {
        const sx = Math.round(px + ix * z) + 0.5;
        ctx.moveTo(sx, py);
        ctx.lineTo(sx, py + dh);
      }
      for (let iy = 0; iy <= effCanvas.height; iy++) {
        const sy = Math.round(py + iy * z) + 0.5;
        ctx.moveTo(px, sy);
        ctx.lineTo(px + dw, sy);
      }
      ctx.stroke();
    }

    ctx.restore();
  }

  drawOverlay() {
    const dpr = window.devicePixelRatio || 1;
    const w = this.overlayCanvas.width / dpr;
    const h = this.overlayCanvas.height / dpr;
    const ctx = this.overlayCtx;

    ctx.save();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    const img = getActiveImage();
    if (!img) {
      ctx.restore();
      return;
    }

    const rippers = getRippersForActiveImage();
    const activeId = state.activeRipperId;

    for (const ripper of rippers) {
      if (!ripper.style.visible || ripper.points.length < 3) continue;
      const isSelected = ripper.id === activeId;
      const pts = ripper.points.map((p) => this.imageToStage(p.x, p.y));

      // Polygon fill
      ctx.beginPath();
      ctx.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
      ctx.closePath();

      ctx.save();
      ctx.globalAlpha = ripper.style.opacity;
      ctx.fillStyle = ripper.style.fillColor;
      ctx.fill();
      ctx.restore();

      // Perspective inner grid when 4 points & selected
      if (isSelected && ripper.points.length === 4 && (state.activeTool === TOOL_IDS.PERSPECTIVE || ripper.extraction.mode === 'perspective')) {
        const ordered = orderQuadCorners(ripper.points).map((p) => this.imageToStage(p.x, p.y));
        ctx.save();
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.35)';
        ctx.lineWidth = 1;
        ctx.setLineDash([3, 3]);
        for (let t = 0.25; t < 1; t += 0.25) {
          // Top-to-bottom lerp
          ctx.beginPath();
          ctx.moveTo(ordered[0].x + (ordered[1].x - ordered[0].x) * t, ordered[0].y + (ordered[1].y - ordered[0].y) * t);
          ctx.lineTo(ordered[3].x + (ordered[2].x - ordered[3].x) * t, ordered[3].y + (ordered[2].y - ordered[3].y) * t);
          ctx.stroke();
          // Left-to-right lerp
          ctx.beginPath();
          ctx.moveTo(ordered[0].x + (ordered[3].x - ordered[0].x) * t, ordered[0].y + (ordered[3].y - ordered[0].y) * t);
          ctx.lineTo(ordered[1].x + (ordered[2].x - ordered[1].x) * t, ordered[1].y + (ordered[2].y - ordered[1].y) * t);
          ctx.stroke();
        }
        ctx.restore();
      }

      // Outline
      ctx.strokeStyle = ripper.style.outlineColor;
      ctx.lineWidth = isSelected ? ripper.style.outlineWidth : Math.max(1, ripper.style.outlineWidth * 0.7);
      if (!ripper.enabled) ctx.setLineDash([4, 4]);
      ctx.stroke();
      ctx.setLineDash([]);

      // Name label above first vertex
      ctx.font = '600 11px "Plus Jakarta Sans", sans-serif';
      const label = ripper.name;
      const tw = ctx.measureText(label).width;
      const lx = pts[0].x;
      const ly = Math.max(16, pts[0].y - 8);
      ctx.fillStyle = isSelected ? ripper.style.outlineColor : 'rgba(20,22,28,0.85)';
      ctx.fillRect(lx - 3, ly - 11, tw + 6, 14);
      ctx.fillStyle = '#ffffff';
      ctx.fillText(label, lx, ly);

      // Vertex handles
      if (isSelected) {
        const vs = ripper.style.vertexSize;
        for (let i = 0; i < pts.length; i++) {
          const p = pts[i];
          const isActiveV = i === state.selectedVertexIndex;
          ctx.fillStyle = isActiveV ? '#f59e0b' : '#ffffff';
          ctx.strokeStyle = ripper.style.outlineColor;
          ctx.lineWidth = 1.5;
          ctx.fillRect(p.x - vs / 2, p.y - vs / 2, vs, vs);
          ctx.strokeRect(p.x - vs / 2, p.y - vs / 2, vs, vs);
        }

        // Scale & rotate gizmo in Select or Move mode
        if (state.activeTool === TOOL_IDS.SELECT || state.activeTool === TOOL_IDS.MOVE) {
          const gizmo = this.vertexEditor.getScaleRotateHandles(ripper);
          if (gizmo) {
            const tl = this.imageToStage(gizmo.bounds.minX, gizmo.bounds.minY);
            const br = this.imageToStage(gizmo.bounds.maxX, gizmo.bounds.maxY);
            const rot = this.imageToStage(gizmo.rotateHandle.x, gizmo.rotateHandle.y);
            const topMidX = (tl.x + br.x) / 2;

            ctx.save();
            ctx.strokeStyle = 'rgba(255,255,255,0.55)';
            ctx.lineWidth = 1;
            ctx.setLineDash([4, 3]);
            ctx.strokeRect(tl.x, tl.y, br.x - tl.x, br.y - tl.y);
            ctx.setLineDash([]);

            ctx.beginPath();
            ctx.moveTo(topMidX, tl.y);
            ctx.lineTo(rot.x, rot.y);
            ctx.stroke();

            ctx.fillStyle = '#3b82f6';
            ctx.strokeStyle = '#ffffff';
            ctx.beginPath();
            ctx.arc(rot.x, rot.y, 5, 0, Math.PI * 2);
            ctx.fill();
            ctx.stroke();

            for (const c of gizmo.corners) {
              const sc = this.imageToStage(c.x, c.y);
              ctx.fillStyle = '#ffffff';
              ctx.strokeStyle = '#111827';
              ctx.fillRect(sc.x - 4, sc.y - 4, 8, 8);
              ctx.strokeRect(sc.x - 4, sc.y - 4, 8, 8);
            }
            ctx.restore();
          }
        }
      }
    }

    // Active draft polygon overlay
    if (state.draftPolygon.active && state.draftPolygon.points.length > 0) {
      const dPts = state.draftPolygon.points.map((p) => this.imageToStage(p.x, p.y));
      ctx.save();
      ctx.strokeStyle = '#60a5fa';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(dPts[0].x, dPts[0].y);
      for (let i = 1; i < dPts.length; i++) {
        ctx.lineTo(dPts[i].x, dPts[i].y);
      }
      if (state.draftPolygon.mode === 'polygon' && state.draftPolygon.hoverPoint) {
        const hp = this.imageToStage(state.draftPolygon.hoverPoint.x, state.draftPolygon.hoverPoint.y);
        ctx.lineTo(hp.x, hp.y);
      } else if (state.draftPolygon.mode === 'rect') {
        ctx.closePath();
      }
      ctx.stroke();

      if (state.draftPolygon.mode === 'polygon') {
        for (let i = 0; i < dPts.length; i++) {
          ctx.fillStyle = i === 0 ? '#22c55e' : '#ffffff';
          ctx.strokeStyle = '#1d4ed8';
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.arc(dPts[i].x, dPts[i].y, i === 0 ? 5.5 : 4, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
        }
      }
      ctx.restore();
    }

    ctx.restore();
  }

  drawRulers() {
    if (!state.view.showRuler || !getActiveImage()) return;
    const dpr = window.devicePixelRatio || 1;
    const style = getComputedStyle(document.documentElement);
    const tickColor = style.getPropertyValue('--ruler-tick').trim() || '#596377';
    const textColor = style.getPropertyValue('--ruler-text').trim() || '#8c96aa';

    const z = state.view.zoom;
    const stepChoices = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000];
    let imgStep = 50;
    for (const s of stepChoices) {
      if (s * z >= 45) {
        imgStep = s;
        break;
      }
    }

    // Top ruler
    const tw = this.rulerTop.width / dpr;
    const tCtx = this.rulerTopCtx;
    tCtx.save();
    tCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    tCtx.clearRect(0, 0, tw, 20);
    tCtx.strokeStyle = tickColor;
    tCtx.fillStyle = textColor;
    tCtx.font = '10px "JetBrains Mono", monospace';
    const startX = Math.floor(-state.view.panX / z / imgStep) * imgStep;
    const endX = Math.ceil((tw - state.view.panX) / z / imgStep) * imgStep;
    for (let ix = startX; ix <= endX; ix += imgStep) {
      const sx = Math.round(ix * z + state.view.panX) + 0.5;
      tCtx.beginPath();
      tCtx.moveTo(sx, 11);
      tCtx.lineTo(sx, 20);
      tCtx.stroke();
      tCtx.fillText(String(ix), sx + 2, 10);
    }
    tCtx.restore();

    // Left ruler
    const lh = this.rulerLeft.height / dpr;
    const lCtx = this.rulerLeftCtx;
    lCtx.save();
    lCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    lCtx.clearRect(0, 0, 20, lh);
    lCtx.strokeStyle = tickColor;
    lCtx.fillStyle = textColor;
    lCtx.font = '10px "JetBrains Mono", monospace';
    const startY = Math.floor(-state.view.panY / z / imgStep) * imgStep;
    const endY = Math.ceil((lh - state.view.panY) / z / imgStep) * imgStep;
    for (let iy = startY; iy <= endY; iy += imgStep) {
      const sy = Math.round(iy * z + state.view.panY) + 0.5;
      lCtx.beginPath();
      lCtx.moveTo(11, sy);
      lCtx.lineTo(20, sy);
      lCtx.stroke();
      lCtx.save();
      lCtx.translate(10, sy + 2);
      lCtx.rotate(-Math.PI / 2);
      lCtx.fillText(String(iy), 0, 0);
      lCtx.restore();
    }
    lCtx.restore();
  }

  updateHUD() {
    const img = getActiveImage();
    if (!img) {
      this.hud.classList.add('hidden');
      return;
    }
    this.hud.classList.remove('hidden');
    const dims = getEffectiveDimensions(img);
    const zoomPct = Math.round(state.view.zoom * 100);
    const cx = this.cursorImgPt ? Math.round(this.cursorImgPt.x) : 0;
    const cy = this.cursorImgPt ? Math.round(this.cursorImgPt.y) : 0;
    this.hud.innerHTML = `
      <span class="mono">${dims.width}×${dims.height}px</span>
      <span>·</span>
      <span class="mono">X:${cx} Y:${cy}</span>
      <span>·</span>
      <span class="mono">${zoomPct}%</span>
    `;
  }
}
