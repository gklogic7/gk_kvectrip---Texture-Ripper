// AtlasManager: ratio-aware packing (Auto, 1:1, 16:9, 9:16, 4:3, 3:4), Free-Move Gizmo support, and Grid+Edge snapping
import { state } from '../core/app-state.js';
import { events } from '../core/event-manager.js';
import { packMaxRects } from './maxrects-packer.js';
import { packShelf } from './shelf-packer.js';
import { packGuillotine } from './guillotine-packer.js';

export const ATLAS_RATIOS = {
  auto: null,
  '1:1': [1, 1],
  '16:9': [16, 9],
  '9:16': [9, 16],
  '4:3': [4, 3],
  '3:4': [3, 4],
};

function nextPowerOfTwo(n) {
  let p = 64;
  while (p < n && p < 4096) p *= 2;
  return p;
}

function runPacker(algo, items, binW, binH, opts) {
  switch (algo) {
    case 'shelf':
      return packShelf(items, binW, binH, opts);
    case 'guillotine':
      return packGuillotine(items, binW, binH, opts);
    case 'maxrects':
    default:
      return packMaxRects(items, binW, binH, opts);
  }
}

function fitDimensionsToRatio(maxW, maxH, rw, rh) {
  const scale = Math.floor(Math.min(maxW / rw, maxH / rh));
  const safeScale = Math.max(1, scale);
  return {
    w: Math.max(64, safeScale * rw),
    h: Math.max(64, safeScale * rh),
  };
}

class AtlasManager {
  constructor() {
    this._timer = null;
    this.activeGuides = []; // [{ axis: 'x'|'y', pos: number }]
    events.on('ripper:processed', () => this.scheduleRebuild(120));
    events.on('rippers:changed', () => this.scheduleRebuild(80));
  }

  scheduleRebuild(delay = 80) {
    if (this._timer) clearTimeout(this._timer);
    this._timer = setTimeout(() => {
      this._timer = null;
      this.rebuildAtlas({ clearManual: false });
    }, delay);
  }

  getActiveItems() {
    const items = [];
    const itemMap = new Map(state.atlas.items.map((it) => [it.ripperId, it]));
    for (const ripper of state.rippers) {
      if (!ripper.enabled) continue;
      const canvas = ripper.cachedStages?.final || ripper.cachedStages?.perspective;
      if (!canvas) continue;

      let itemCfg = itemMap.get(ripper.id);
      if (!itemCfg) {
        itemCfg = {
          ripperId: ripper.id,
          scale: 1,
          locked: false,
          customW: null,
          customH: null,
          order: state.atlas.items.length,
        };
        state.atlas.items.push(itemCfg);
      }

      const w = itemCfg.customW
        ? Math.max(8, Math.round(itemCfg.customW))
        : Math.max(8, Math.round(canvas.width * (itemCfg.scale || 1)));
      const h = itemCfg.customH
        ? Math.max(8, Math.round(itemCfg.customH))
        : Math.max(8, Math.round(canvas.height * (itemCfg.scale || 1)));

      items.push({
        ripperId: ripper.id,
        name: ripper.name,
        sourceCanvas: canvas,
        w: w + state.atlas.padding * 2,
        h: h + state.atlas.padding * 2,
        innerW: w,
        innerH: h,
        order: itemCfg.order ?? 0,
        locked: !!itemCfg.locked,
        pixelArt: !!ripper.pixelArt?.enabled,
      });
    }
    return items.sort((a, b) => a.order - b.order);
  }

  rebuildAtlas({ clearManual = false } = {}) {
    const cfg = state.atlas;
    if (clearManual) {
      cfg.manualOverrides = {};
    }
    // Keep square flag aligned with 1:1 ratio
    const effectiveRatio = cfg.aspectRatio && cfg.aspectRatio !== 'auto'
      ? cfg.aspectRatio
      : cfg.square
      ? '1:1'
      : 'auto';

    const items = this.getActiveItems();
    if (!items.length) {
      cfg.packedResult = null;
      events.emit('atlas:updated', null);
      return null;
    }

    const opts = { spacing: cfg.spacing, allowRotate: cfg.allowRotate };
    let targetW = cfg.maxWidth;
    let targetH = cfg.maxHeight;
    let result;

    if (effectiveRatio !== 'auto' && ATLAS_RATIOS[effectiveRatio]) {
      const [rw, rh] = ATLAS_RATIOS[effectiveRatio];
      const maxFit = fitDimensionsToRatio(cfg.maxWidth, cfg.maxHeight, rw, rh);
      targetW = maxFit.w;
      targetH = maxFit.h;
      result = runPacker(cfg.algorithm, items, targetW, targetH, opts);

      if (cfg.autoSize && result.placements.length > 0) {
        if (effectiveRatio === '1:1' && cfg.powerOfTwo) {
          for (const side of [64, 128, 256, 512, 1024, 2048, 4096]) {
            if (side > Math.min(cfg.maxWidth, cfg.maxHeight)) break;
            const test = runPacker(cfg.algorithm, items, side, side, opts);
            if (test.unplaced.length === 0) {
              result = test;
              targetW = side;
              targetH = side;
              break;
            }
          }
        } else {
          // Binary search tightest scale factor preserving exact rw:rh ratio
          const maxK = Math.floor(Math.min(cfg.maxWidth / rw, cfg.maxHeight / rh));
          let lo = Math.max(4, Math.ceil(64 / Math.min(rw, rh)));
          let hi = Math.max(lo, maxK);
          let best = { res: result, w: targetW, h: targetH };
          while (lo <= hi) {
            const mid = Math.floor((lo + hi) / 2);
            const tw = mid * rw;
            const th = mid * rh;
            const test = runPacker(cfg.algorithm, items, tw, th, opts);
            if (test.unplaced.length === 0) {
              best = { res: test, w: tw, h: th };
              hi = mid - 1;
            } else {
              lo = mid + 1;
            }
          }
          result = best.res;
          targetW = best.w;
          targetH = best.h;
        }
      }
    } else {
      result = runPacker(cfg.algorithm, items, targetW, targetH, opts);

      if (result.placements.length > 0 && cfg.autoSize) {
        let usedW = 0;
        let usedH = 0;
        for (const p of result.placements) {
          usedW = Math.max(usedW, p.x + p.packedW);
          usedH = Math.max(usedH, p.y + p.packedH);
        }

        if (cfg.powerOfTwo) {
          usedW = Math.min(cfg.maxWidth, nextPowerOfTwo(usedW));
          usedH = Math.min(cfg.maxHeight, nextPowerOfTwo(usedH));
        } else {
          usedW = Math.max(32, usedW);
          usedH = Math.max(32, usedH);
        }

        const tighter = runPacker(cfg.algorithm, items, usedW, usedH, opts);
        if (tighter.placements.length >= result.placements.length) {
          result = tighter;
          targetW = usedW;
          targetH = usedH;
        }
      }
    }

    // Normalize placements and apply any manual Free-Move Gizmo overrides
    const pad = cfg.padding;
    const placements = result.placements.map((p) => {
      const ov = cfg.manualOverrides?.[p.ripperId];
      if (ov) {
        const innerW = Math.max(8, Math.round(ov.innerW));
        const innerH = Math.max(8, Math.round(ov.innerH));
        const angleDeg = ov.angleDeg ?? 0;
        const rad = (angleDeg * Math.PI) / 180;
        const cos = Math.abs(Math.cos(rad));
        const sin = Math.abs(Math.sin(rad));
        const boxW = Math.round(innerW * cos + innerH * sin) + pad * 2;
        const boxH = Math.round(innerW * sin + innerH * cos) + pad * 2;
        return {
          ...p,
          x: ov.x,
          y: ov.y,
          innerW,
          innerH,
          packedW: boxW,
          packedH: boxH,
          angleDeg,
          rotated: Math.abs(angleDeg) > 0.01,
        };
      }
      return {
        ...p,
        angleDeg: p.rotated ? 90 : 0,
      };
    });

    cfg.packedResult = {
      width: Math.max(1, targetW),
      height: Math.max(1, targetH),
      placements,
      unplaced: result.unplaced,
      efficiency: 0,
      cleanCanvas: null,
      previewCanvas: null,
    };

    return this.renderAtlasCanvases();
  }

  // Computes bounding-box & gizmo handles in atlas pixel coordinates
  getPlacementGizmo(p) {
    const cx = p.x + p.packedW / 2;
    const cy = p.y + p.packedH / 2;
    const rad = ((p.angleDeg || 0) * Math.PI) / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);
    const hw = p.innerW / 2 + state.atlas.padding;
    const hh = p.innerH / 2 + state.atlas.padding;

    const rotPt = (lx, ly) => ({
      x: cx + lx * cos - ly * sin,
      y: cy + lx * sin + ly * cos,
    });

    const stemDist = Math.max(16, Math.min(36, Math.round(Math.max(p.packedW, p.packedH) * 0.14)));

    return {
      center: { x: cx, y: cy },
      corners: [
        { id: 'nw', ...rotPt(-hw, -hh), opp: rotPt(hw, hh), lx: -hw, ly: -hh },
        { id: 'ne', ...rotPt(hw, -hh), opp: rotPt(-hw, hh), lx: hw, ly: -hh },
        { id: 'se', ...rotPt(hw, hh), opp: rotPt(-hw, -hh), lx: hw, ly: hh },
        { id: 'sw', ...rotPt(-hw, hh), opp: rotPt(hw, -hh), lx: -hw, ly: hh },
      ],
      topMid: rotPt(0, -hh),
      rotateHandle: rotPt(0, -hh - stemDist),
    };
  }

  // Dual-target Snap (Atlas Grid + Neighboring Texture Edges & Atlas Bounds)
  computeSnapPosition(movingId, rawX, rawY, boxW, boxH) {
    const res = state.atlas.packedResult;
    if (!state.atlas.snapEnabled || !res) {
      this.activeGuides = [];
      return { x: Math.round(rawX), y: Math.round(rawY) };
    }

    const threshold = Math.max(5, Math.round(Math.max(res.width, res.height) * 0.01));
    const grid = Math.max(2, state.atlas.snapGridSize || 16);
    const spacing = state.atlas.spacing || 0;
    const guides = [];

    const xTargets = [0, res.width / 2, res.width];
    const yTargets = [0, res.height / 2, res.height];

    for (const other of res.placements) {
      if (other.ripperId === movingId) continue;
      xTargets.push(
        other.x,
        other.x + other.packedW,
        other.x - spacing,
        other.x + other.packedW + spacing,
        other.x + other.packedW / 2
      );
      yTargets.push(
        other.y,
        other.y + other.packedH,
        other.y - spacing,
        other.y + other.packedH + spacing,
        other.y + other.packedH / 2
      );
    }

    // Find best X snap across left, center, right edges (priority to neighbor/bound edges, then grid)
    let bestDx = null;
    let bestXDist = threshold + 1;
    let bestXGuide = null;
    for (const edgeVal of [rawX, rawX + boxW / 2, rawX + boxW]) {
      for (const t of xTargets) {
        const d = Math.abs(t - edgeVal);
        if (d < bestXDist) {
          bestXDist = d;
          bestDx = t - edgeVal;
          bestXGuide = t;
        }
      }
    }
    if (bestDx === null) {
      const gx = Math.round(rawX / grid) * grid;
      if (Math.abs(gx - rawX) <= threshold) {
        bestDx = gx - rawX;
        bestXGuide = gx;
      }
    }

    // Find best Y snap across top, center, bottom edges
    let bestDy = null;
    let bestYDist = threshold + 1;
    let bestYGuide = null;
    for (const edgeVal of [rawY, rawY + boxH / 2, rawY + boxH]) {
      for (const t of yTargets) {
        const d = Math.abs(t - edgeVal);
        if (d < bestYDist) {
          bestYDist = d;
          bestDy = t - edgeVal;
          bestYGuide = t;
        }
      }
    }
    if (bestDy === null) {
      const gy = Math.round(rawY / grid) * grid;
      if (Math.abs(gy - rawY) <= threshold) {
        bestDy = gy - rawY;
        bestYGuide = gy;
      }
    }

    const snappedX = bestDx !== null ? Math.round(rawX + bestDx) : Math.round(rawX);
    const snappedY = bestDy !== null ? Math.round(rawY + bestDy) : Math.round(rawY);
    if (bestXGuide !== null) guides.push({ axis: 'x', pos: bestXGuide });
    if (bestYGuide !== null) guides.push({ axis: 'y', pos: bestYGuide });

    this.activeGuides = guides;
    return { x: snappedX, y: snappedY };
  }

  renderAtlasCanvases() {
    const cfg = state.atlas;
    const res = cfg.packedResult;
    if (!res) return null;

    const targetW = res.width;
    const targetH = res.height;
    const pad = cfg.padding;

    const cleanCanvas = document.createElement('canvas');
    cleanCanvas.width = targetW;
    cleanCanvas.height = targetH;
    const cctx = cleanCanvas.getContext('2d');

    if (!cfg.transparent) {
      cctx.fillStyle = cfg.bgColor || '#000000';
      cctx.fillRect(0, 0, targetW, targetH);
    }

    let usedArea = 0;
    for (const p of res.placements) {
      usedArea += p.packedW * p.packedH;
      const cx = p.x + p.packedW / 2;
      const cy = p.y + p.packedH / 2;
      const rad = ((p.angleDeg ?? (p.rotated ? 90 : 0)) * Math.PI) / 180;

      cctx.save();
      cctx.imageSmoothingEnabled = !p.pixelArt;
      cctx.translate(cx, cy);
      cctx.rotate(rad);
      cctx.drawImage(p.sourceCanvas, -p.innerW / 2, -p.innerH / 2, p.innerW, p.innerH);
      cctx.restore();
    }

    const previewCanvas = document.createElement('canvas');
    previewCanvas.width = targetW;
    previewCanvas.height = targetH;
    const pctx = previewCanvas.getContext('2d');

    // Subtle grid overlay when Free Move Gizmo + Snap are active
    if (cfg.freeMoveGizmo && cfg.snapEnabled) {
      const g = Math.max(4, cfg.snapGridSize || 16);
      if (targetW / g <= 128) {
        pctx.save();
        pctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
        pctx.lineWidth = 1;
        pctx.beginPath();
        for (let gx = g; gx < targetW; gx += g) {
          pctx.moveTo(gx + 0.5, 0);
          pctx.lineTo(gx + 0.5, targetH);
        }
        for (let gy = g; gy < targetH; gy += g) {
          pctx.moveTo(0, gy + 0.5);
          pctx.lineTo(targetW, gy + 0.5);
        }
        pctx.stroke();
        pctx.restore();
      }
    }

    pctx.drawImage(cleanCanvas, 0, 0);

    for (const p of res.placements) {
      if (cfg.showBounds) {
        pctx.strokeStyle = '#3b82f6';
        pctx.lineWidth = Math.max(1, Math.round(targetW / 512));
        pctx.strokeRect(p.x + 0.5, p.y + 0.5, p.packedW - 1, p.packedH - 1);
      }
      if (cfg.showNames || cfg.showUVs) {
        const fontSize = Math.max(10, Math.min(14, Math.round(targetW / 48)));
        pctx.font = `600 ${fontSize}px "JetBrains Mono", monospace`;
        const u0 = (p.x / targetW).toFixed(3);
        const v0 = (p.y / targetH).toFixed(3);
        const text =
          cfg.showNames && cfg.showUVs
            ? `${p.name} (${u0},${v0})`
            : cfg.showNames
            ? p.name
            : `UV:${u0},${v0}`;
        const tw = pctx.measureText(text).width;
        pctx.fillStyle = 'rgba(15, 23, 42, 0.78)';
        pctx.fillRect(p.x + 2, p.y + 2, Math.min(p.packedW - 4, tw + 6), fontSize + 4);
        pctx.fillStyle = '#ffffff';
        pctx.fillText(text, p.x + 5, p.y + fontSize + 3, Math.max(10, p.packedW - 8));
      }
    }

    // Active snap alignment guides
    if (cfg.freeMoveGizmo && this.activeGuides.length) {
      pctx.save();
      pctx.strokeStyle = '#22c55e';
      pctx.lineWidth = Math.max(1, Math.round(targetW / 450));
      pctx.setLineDash([4, 3]);
      for (const g of this.activeGuides) {
        pctx.beginPath();
        if (g.axis === 'x') {
          pctx.moveTo(g.pos + 0.5, 0);
          pctx.lineTo(g.pos + 0.5, targetH);
        } else {
          pctx.moveTo(0, g.pos + 0.5);
          pctx.lineTo(targetW, g.pos + 0.5);
        }
        pctx.stroke();
      }
      pctx.restore();
    }

    // Render Free-Move Gizmo on selected texture placement
    if (cfg.freeMoveGizmo && cfg.selectedPlacementId) {
      const sel = res.placements.find((p) => p.ripperId === cfg.selectedPlacementId);
      if (sel) {
        const gizmo = this.getPlacementGizmo(sel);
        const lw = Math.max(1.5, targetW / 420);
        const hs = Math.max(5, Math.round(targetW / 90));

        pctx.save();
        pctx.strokeStyle = '#60a5fa';
        pctx.lineWidth = lw;

        // Rotated texture frame
        pctx.beginPath();
        pctx.moveTo(gizmo.corners[0].x, gizmo.corners[0].y);
        for (let i = 1; i < 4; i++) pctx.lineTo(gizmo.corners[i].x, gizmo.corners[i].y);
        pctx.closePath();
        pctx.stroke();

        // Rotation stem & handle
        pctx.beginPath();
        pctx.moveTo(gizmo.topMid.x, gizmo.topMid.y);
        pctx.lineTo(gizmo.rotateHandle.x, gizmo.rotateHandle.y);
        pctx.stroke();

        pctx.fillStyle = '#3b82f6';
        pctx.strokeStyle = '#ffffff';
        pctx.beginPath();
        pctx.arc(gizmo.rotateHandle.x, gizmo.rotateHandle.y, hs * 0.85, 0, Math.PI * 2);
        pctx.fill();
        pctx.stroke();

        // Corner scale handles
        for (const c of gizmo.corners) {
          pctx.fillStyle = '#ffffff';
          pctx.strokeStyle = '#1d4ed8';
          pctx.fillRect(c.x - hs / 2, c.y - hs / 2, hs, hs);
          pctx.strokeRect(c.x - hs / 2, c.y - hs / 2, hs, hs);
        }
        pctx.restore();
      }
    }

    const totalArea = targetW * targetH;
    const efficiency = totalArea > 0 ? Math.min(100, (usedArea / totalArea) * 100) : 0;

    res.cleanCanvas = cleanCanvas;
    res.previewCanvas = previewCanvas;
    res.efficiency = Number(efficiency.toFixed(1));

    events.emit('atlas:updated', res);
    return res;
  }
}

export const atlasManager = new AtlasManager();
