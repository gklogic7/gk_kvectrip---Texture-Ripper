// Polygon creation tools: Polygon Ripper, Rectangle Selection, Freeform Polygon, Snap-to-Grid/Edges
import { state, getActiveImage, TOOL_IDS } from '../core/app-state.js';
import { events } from '../core/event-manager.js';
import { getEffectiveDimensions } from './image-loader.js';

export function snapPoint(pt, imgDims) {
  let x = pt.x;
  let y = pt.y;

  if (state.view.pixelGrid) {
    x = Math.round(x);
    y = Math.round(y);
  }

  if (state.view.snapGrid && state.view.gridSize > 1) {
    const g = state.view.gridSize;
    x = Math.round(x / g) * g;
    y = Math.round(y / g) * g;
  }

  if (state.view.snapEdges && imgDims) {
    const threshold = Math.max(4, 8 / Math.max(0.25, state.view.zoom));
    if (Math.abs(x) < threshold) x = 0;
    if (Math.abs(y) < threshold) y = 0;
    if (Math.abs(x - imgDims.width) < threshold) x = imgDims.width;
    if (Math.abs(y - imgDims.height) < threshold) y = imgDims.height;
  }

  if (imgDims) {
    x = Math.max(0, Math.min(imgDims.width, x));
    y = Math.max(0, Math.min(imgDims.height, y));
  }

  return { x, y };
}

function simplifyPath(points, tolerance) {
  if (points.length <= 4) return points;
  const sqTol = tolerance * tolerance;

  function getSqSegDist(p, p1, p2) {
    let x = p1.x;
    let y = p1.y;
    let dx = p2.x - x;
    let dy = p2.y - y;
    if (dx !== 0 || dy !== 0) {
      const t = ((p.x - x) * dx + (p.y - y) * dy) / (dx * dx + dy * dy);
      if (t > 1) {
        x = p2.x;
        y = p2.y;
      } else if (t > 0) {
        x += dx * t;
        y += dy * t;
      }
    }
    dx = p.x - x;
    dy = p.y - y;
    return dx * dx + dy * dy;
  }

  function step(pts, first, last, out) {
    let maxDist = sqTol;
    let idx = -1;
    for (let i = first + 1; i < last; i++) {
      const d = getSqSegDist(pts[i], pts[first], pts[last]);
      if (d > maxDist) {
        idx = i;
        maxDist = d;
      }
    }
    if (idx !== -1) {
      if (idx - first > 1) step(pts, first, idx, out);
      out.push(pts[idx]);
      if (last - idx > 1) step(pts, idx, last, out);
    }
  }

  const out = [points[0]];
  step(points, 0, points.length - 1, out);
  out.push(points[points.length - 1]);
  return out;
}

export class PolygonToolController {
  constructor() {
    this.rectStart = null;
  }

  cancelDraft() {
    state.draftPolygon.active = false;
    state.draftPolygon.mode = null;
    state.draftPolygon.points = [];
    state.draftPolygon.hoverPoint = null;
    state.draftPolygon.isDrawingFreeform = false;
    this.rectStart = null;
    events.emit('canvas:redrawOverlay');
  }

  confirmDraft() {
    const pts = state.draftPolygon.points;
    if (!state.draftPolygon.active || pts.length < 3) {
      this.cancelDraft();
      return;
    }
    const finalPoints = pts.map((p) => ({ x: p.x, y: p.y }));
    this.cancelDraft();
    events.emit('polygon:completed', { points: finalPoints });
  }

  onPointerDown(imgPt, e) {
    const img = getActiveImage();
    if (!img) return;
    const dims = getEffectiveDimensions(img);
    const snapped = snapPoint(imgPt, dims);

    if (state.activeTool === TOOL_IDS.POLYGON) {
      const draft = state.draftPolygon;
      if (!draft.active) {
        draft.active = true;
        draft.mode = 'polygon';
        draft.points = [snapped];
        draft.hoverPoint = snapped;
      } else {
        // Close if clicking near first vertex (with >= 3 points)
        const first = draft.points[0];
        const closeRadius = 10 / Math.max(0.2, state.view.zoom);
        if (draft.points.length >= 3 && Math.hypot(snapped.x - first.x, snapped.y - first.y) <= closeRadius) {
          this.confirmDraft();
          return;
        }
        // Double click protection: avoid identical point
        const prev = draft.points[draft.points.length - 1];
        if (Math.hypot(snapped.x - prev.x, snapped.y - prev.y) > 1.5) {
          draft.points.push(snapped);
        }
      }
      events.emit('canvas:redrawOverlay');
    } else if (state.activeTool === TOOL_IDS.RECT) {
      this.rectStart = snapped;
      state.draftPolygon.active = true;
      state.draftPolygon.mode = 'rect';
      state.draftPolygon.points = [
        snapped,
        { x: snapped.x, y: snapped.y },
        { x: snapped.x, y: snapped.y },
        { x: snapped.x, y: snapped.y },
      ];
      events.emit('canvas:redrawOverlay');
    } else if (state.activeTool === TOOL_IDS.FREEFORM) {
      state.draftPolygon.active = true;
      state.draftPolygon.mode = 'freeform';
      state.draftPolygon.isDrawingFreeform = true;
      state.draftPolygon.points = [snapped];
      events.emit('canvas:redrawOverlay');
    }
  }

  onPointerMove(imgPt) {
    const img = getActiveImage();
    if (!img) return;
    const dims = getEffectiveDimensions(img);
    const snapped = snapPoint(imgPt, dims);

    if (state.activeTool === TOOL_IDS.POLYGON && state.draftPolygon.active) {
      state.draftPolygon.hoverPoint = snapped;
      events.emit('canvas:redrawOverlay');
    } else if (state.activeTool === TOOL_IDS.RECT && this.rectStart && state.draftPolygon.active) {
      const x1 = Math.min(this.rectStart.x, snapped.x);
      const y1 = Math.min(this.rectStart.y, snapped.y);
      const x2 = Math.max(this.rectStart.x, snapped.x);
      const y2 = Math.max(this.rectStart.y, snapped.y);
      state.draftPolygon.points = [
        { x: x1, y: y1 },
        { x: x2, y: y1 },
        { x: x2, y: y2 },
        { x: x1, y: y2 },
      ];
      events.emit('canvas:redrawOverlay');
    } else if (state.activeTool === TOOL_IDS.FREEFORM && state.draftPolygon.isDrawingFreeform) {
      const pts = state.draftPolygon.points;
      const last = pts[pts.length - 1];
      const minStep = 4 / Math.max(0.25, state.view.zoom);
      if (Math.hypot(snapped.x - last.x, snapped.y - last.y) >= minStep) {
        pts.push(snapped);
        events.emit('canvas:redrawOverlay');
      }
    }
  }

  onPointerUp() {
    if (state.activeTool === TOOL_IDS.RECT && this.rectStart) {
      const pts = state.draftPolygon.points;
      const w = Math.abs(pts[2].x - pts[0].x);
      const h = Math.abs(pts[2].y - pts[0].y);
      if (w >= 4 && h >= 4) {
        this.confirmDraft();
      } else {
        this.cancelDraft();
      }
    } else if (state.activeTool === TOOL_IDS.FREEFORM && state.draftPolygon.isDrawingFreeform) {
      state.draftPolygon.isDrawingFreeform = false;
      const raw = state.draftPolygon.points;
      if (raw.length >= 3) {
        const simplified = simplifyPath(raw, 4 / Math.max(0.25, state.view.zoom));
        state.draftPolygon.points = simplified.length >= 3 ? simplified : raw.slice(0, 12);
        this.confirmDraft();
      } else {
        this.cancelDraft();
      }
    }
  }
}
