// Guillotine bin-packing algorithm (Best Area Fit + Shorter Axis Split)

export function packGuillotine(items, binW, binH, { spacing = 2, allowRotate = true } = {}) {
  const freeRects = [{ x: 0, y: 0, w: binW, h: binH }];
  const placements = [];
  const unplaced = [];

  const sorted = [...items].sort((a, b) => b.w * b.h - a.w * a.h);

  for (const item of sorted) {
    const reqW = item.w + spacing;
    const reqH = item.h + spacing;

    let bestIdx = -1;
    let bestAreaFit = Infinity;
    let bestRotated = false;

    for (let i = 0; i < freeRects.length; i++) {
      const r = freeRects[i];
      if (r.w >= reqW && r.h >= reqH) {
        const areaFit = r.w * r.h - reqW * reqH;
        if (areaFit < bestAreaFit) {
          bestAreaFit = areaFit;
          bestIdx = i;
          bestRotated = false;
        }
      }
      if (allowRotate && r.w >= reqH && r.h >= reqW) {
        const areaFit = r.w * r.h - reqW * reqH;
        if (areaFit < bestAreaFit) {
          bestAreaFit = areaFit;
          bestIdx = i;
          bestRotated = true;
        }
      }
    }

    if (bestIdx < 0) {
      unplaced.push(item);
      continue;
    }

    const chosen = freeRects.splice(bestIdx, 1)[0];
    const usedW = bestRotated ? reqH : reqW;
    const usedH = bestRotated ? reqW : reqH;

    placements.push({
      ...item,
      x: chosen.x,
      y: chosen.y,
      packedW: bestRotated ? item.h : item.w,
      packedH: bestRotated ? item.w : item.h,
      rotated: bestRotated,
    });

    // Guillotine split along shorter leftover axis
    const remW = chosen.w - usedW;
    const remH = chosen.h - usedH;
    if (remW <= remH) {
      if (remW > 0) {
        freeRects.push({ x: chosen.x + usedW, y: chosen.y, w: remW, h: usedH });
      }
      if (remH > 0) {
        freeRects.push({ x: chosen.x, y: chosen.y + usedH, w: chosen.w, h: remH });
      }
    } else {
      if (remW > 0) {
        freeRects.push({ x: chosen.x + usedW, y: chosen.y, w: remW, h: chosen.h });
      }
      if (remH > 0) {
        freeRects.push({ x: chosen.x, y: chosen.y + usedH, w: usedW, h: remH });
      }
    }
  }

  return { placements, unplaced };
}
