// Vertex editing, polygon move, scale/rotate transform, and perspective corner adjustment
import {
  state,
  getActiveImage,
  getActiveRipper,
  getRippersForActiveImage,
  setActiveRipper,
  TOOL_IDS,
} from '../core/app-state.js';
import { events } from '../core/event-manager.js';
import { history } from '../core/history-manager.js';
import { getEffectiveDimensions } from './image-loader.js';
import { computePolygonBounds, distanceToSegment, pointInPolygon } from './perspective-engine.js';
import { snapPoint } from './polygon-tool.js';

export class VertexEditorController {
  constructor() {
    this.dragMode = null; // 'vertex' | 'move' | 'scale' | 'rotate'
    this.dragRipperId = null;
    this.dragVertexIdx = -1;
    this.startImgPt = null;
    this.origPoints = null;
    this.origCenter = null;
    this.origBounds = null;
    this.scaleAnchor = null;
    this.scaleCorner = null;
    this.didModify = false;
  }

  getScaleRotateHandles(ripper) {
    if (!ripper || ripper.points.length < 3) return null;
    const b = computePolygonBounds(ripper.points);
    const pad = 12 / Math.max(0.2, state.view.zoom);
    const cx = (b.minX + b.maxX) / 2;
    const cy = (b.minY + b.maxY) / 2;
    return {
      bounds: b,
      center: { x: cx, y: cy },
      corners: [
        { id: 'nw', x: b.minX, y: b.minY, ax: b.maxX, ay: b.maxY },
        { id: 'ne', x: b.maxX, y: b.minY, ax: b.minX, ay: b.maxY },
        { id: 'se', x: b.maxX, y: b.maxY, ax: b.minX, ay: b.minY },
        { id: 'sw', x: b.minX, y: b.maxY, ax: b.maxX, ay: b.minY },
      ],
      rotateHandle: { x: cx, y: b.minY - pad * 1.8 },
    };
  }

  findVertexHit(imgPt, ripper) {
    if (!ripper || !ripper.style.visible) return -1;
    const hitRadius = Math.max(8, (ripper.style.vertexSize + 5)) / Math.max(0.2, state.view.zoom);
    for (let i = 0; i < ripper.points.length; i++) {
      const p = ripper.points[i];
      if (Math.hypot(imgPt.x - p.x, imgPt.y - p.y) <= hitRadius) {
        return i;
      }
    }
    return -1;
  }

  findEdgeHit(imgPt, ripper) {
    if (!ripper || !ripper.style.visible) return -1;
    const hitRadius = 7 / Math.max(0.2, state.view.zoom);
    const pts = ripper.points;
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i];
      const b = pts[(i + 1) % pts.length];
      const res = distanceToSegment(imgPt.x, imgPt.y, a, b);
      if (res.dist <= hitRadius) {
        return { edgeIndex: i, point: res.proj };
      }
    }
    return null;
  }

  onPointerDown(imgPt, e) {
    const img = getActiveImage();
    if (!img) return;
    const dims = getEffectiveDimensions(img);
    const active = getActiveRipper();
    const hitTol = 10 / Math.max(0.2, state.view.zoom);

    // Check scale/rotate handles in Select or Move mode
    if (active && active.style.visible && (state.activeTool === TOOL_IDS.SELECT || state.activeTool === TOOL_IDS.MOVE)) {
      const gizmo = this.getScaleRotateHandles(active);
      if (gizmo) {
        if (Math.hypot(imgPt.x - gizmo.rotateHandle.x, imgPt.y - gizmo.rotateHandle.y) <= hitTol) {
          this._beginDrag('rotate', active, imgPt, -1);
          this.origCenter = gizmo.center;
          return;
        }
        for (const c of gizmo.corners) {
          if (Math.hypot(imgPt.x - c.x, imgPt.y - c.y) <= hitTol) {
            this._beginDrag('scale', active, imgPt, -1);
            this.scaleAnchor = { x: c.ax, y: c.ay };
            this.scaleCorner = { x: c.x, y: c.y };
            return;
          }
        }
      }
    }

    // Check vertex hit on active ripper (for Vertex, Perspective, or Select tools)
    if (
      active &&
      active.style.visible &&
      [TOOL_IDS.VERTEX, TOOL_IDS.PERSPECTIVE, TOOL_IDS.SELECT].includes(state.activeTool)
    ) {
      const vIdx = this.findVertexHit(imgPt, active);
      if (vIdx >= 0) {
        // Alt+Click or right-click deletes vertex in Vertex mode
        if ((e.altKey || e.button === 2) && state.activeTool === TOOL_IDS.VERTEX && active.points.length > 3) {
          active.points.splice(vIdx, 1);
          state.selectedVertexIndex = -1;
          events.emit('ripper:geometryChanged', active);
          events.emit('canvas:redrawOverlay');
          history.push(`Delete vertex from ${active.name}`);
          return;
        }
        state.selectedVertexIndex = vIdx;
        this._beginDrag('vertex', active, imgPt, vIdx);
        events.emit('canvas:redrawOverlay');
        return;
      }

      // Click edge in Vertex mode to insert a new vertex
      if (state.activeTool === TOOL_IDS.VERTEX) {
        const edgeHit = this.findEdgeHit(imgPt, active);
        if (edgeHit) {
          const snapped = snapPoint(edgeHit.point, dims);
          active.points.splice(edgeHit.edgeIndex + 1, 0, snapped);
          state.selectedVertexIndex = edgeHit.edgeIndex + 1;
          this._beginDrag('vertex', active, imgPt, edgeHit.edgeIndex + 1);
          this.didModify = true;
          events.emit('canvas:redrawOverlay');
          return;
        }
      }
    }

    // Check if clicking inside any ripper polygon (topmost last)
    const rippers = getRippersForActiveImage();
    for (let i = rippers.length - 1; i >= 0; i--) {
      const r = rippers[i];
      if (!r.style.visible) continue;
      if (pointInPolygon(imgPt.x, imgPt.y, r.points)) {
        setActiveRipper(r.id);
        if ([TOOL_IDS.MOVE, TOOL_IDS.SELECT, TOOL_IDS.VERTEX, TOOL_IDS.PERSPECTIVE].includes(state.activeTool)) {
          this._beginDrag('move', r, imgPt, -1);
        }
        events.emit('canvas:redrawOverlay');
        return;
      }
    }

    // Clicked empty background in Select mode
    if (state.activeTool === TOOL_IDS.SELECT) {
      state.selectedVertexIndex = -1;
      events.emit('canvas:redrawOverlay');
    }
  }

  _beginDrag(mode, ripper, imgPt, vertexIdx) {
    this.dragMode = mode;
    this.dragRipperId = ripper.id;
    this.dragVertexIdx = vertexIdx;
    this.startImgPt = { x: imgPt.x, y: imgPt.y };
    this.origPoints = ripper.points.map((p) => ({ x: p.x, y: p.y }));
    this.didModify = false;
  }

  onPointerMove(imgPt) {
    if (!this.dragMode) return;
    const ripper = state.rippers.find((r) => r.id === this.dragRipperId);
    const img = getActiveImage();
    if (!ripper || !img) return;
    const dims = getEffectiveDimensions(img);

    if (this.dragMode === 'vertex' && this.dragVertexIdx >= 0) {
      const snapped = snapPoint(imgPt, dims);
      ripper.points[this.dragVertexIdx] = snapped;
      this.didModify = true;
      events.emit('canvas:redrawOverlay');
      events.emit('ripper:geometryLive', ripper);
    } else if (this.dragMode === 'move') {
      const dx = imgPt.x - this.startImgPt.x;
      const dy = imgPt.y - this.startImgPt.y;
      if (Math.abs(dx) > 0.2 || Math.abs(dy) > 0.2) this.didModify = true;

      // Clamp translation to image bounds
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      for (const p of this.origPoints) {
        if (p.x < minX) minX = p.x;
        if (p.y < minY) minY = p.y;
        if (p.x > maxX) maxX = p.x;
        if (p.y > maxY) maxY = p.y;
      }
      const clampedDx = Math.max(-minX, Math.min(dims.width - maxX, dx));
      const clampedDy = Math.max(-minY, Math.min(dims.height - maxY, dy));

      ripper.points = this.origPoints.map((p) => ({
        x: state.view.pixelGrid ? Math.round(p.x + clampedDx) : p.x + clampedDx,
        y: state.view.pixelGrid ? Math.round(p.y + clampedDy) : p.y + clampedDy,
      }));
      events.emit('canvas:redrawOverlay');
    } else if (this.dragMode === 'rotate' && this.origCenter) {
      const a0 = Math.atan2(this.startImgPt.y - this.origCenter.y, this.startImgPt.x - this.origCenter.x);
      const a1 = Math.atan2(imgPt.y - this.origCenter.y, imgPt.x - this.origCenter.x);
      const delta = a1 - a0;
      const cos = Math.cos(delta);
      const sin = Math.sin(delta);
      this.didModify = true;
      ripper.points = this.origPoints.map((p) => {
        const rx = p.x - this.origCenter.x;
        const ry = p.y - this.origCenter.y;
        return {
          x: Math.max(0, Math.min(dims.width, this.origCenter.x + rx * cos - ry * sin)),
          y: Math.max(0, Math.min(dims.height, this.origCenter.y + rx * sin + ry * cos)),
        };
      });
      events.emit('canvas:redrawOverlay');
    } else if (this.dragMode === 'scale' && this.scaleAnchor && this.scaleCorner) {
      const origW = this.scaleCorner.x - this.scaleAnchor.x;
      const origH = this.scaleCorner.y - this.scaleAnchor.y;
      const newW = imgPt.x - this.scaleAnchor.x;
      const newH = imgPt.y - this.scaleAnchor.y;
      const sx = Math.abs(origW) > 1 ? newW / origW : 1;
      const sy = Math.abs(origH) > 1 ? newH / origH : 1;
      this.didModify = true;
      ripper.points = this.origPoints.map((p) => ({
        x: Math.max(0, Math.min(dims.width, this.scaleAnchor.x + (p.x - this.scaleAnchor.x) * sx)),
        y: Math.max(0, Math.min(dims.height, this.scaleAnchor.y + (p.y - this.scaleAnchor.y) * sy)),
      }));
      events.emit('canvas:redrawOverlay');
    }
  }

  onPointerUp() {
    if (!this.dragMode) return;
    const mode = this.dragMode;
    const ripper = state.rippers.find((r) => r.id === this.dragRipperId);
    const modified = this.didModify;

    this.dragMode = null;
    this.dragRipperId = null;
    this.dragVertexIdx = -1;
    this.origPoints = null;

    if (ripper && modified) {
      events.emit('ripper:geometryChanged', ripper);
      const labels = {
        vertex: `Edit vertex (${ripper.name})`,
        move: `Move polygon (${ripper.name})`,
        scale: `Scale polygon (${ripper.name})`,
        rotate: `Rotate polygon (${ripper.name})`,
      };
      history.push(labels[mode] || `Modify ${ripper.name}`);
    }
  }

  deleteSelectedVertex() {
    const active = getActiveRipper();
    if (!active || state.selectedVertexIndex < 0 || active.points.length <= 3) return false;
    active.points.splice(state.selectedVertexIndex, 1);
    state.selectedVertexIndex = -1;
    events.emit('ripper:geometryChanged', active);
    events.emit('canvas:redrawOverlay');
    history.push(`Delete vertex (${active.name})`);
    return true;
  }
}
