// MaxRects bin-packing algorithm (Best Short Side Fit with free rect splitting)

export function packMaxRects(items, binW, binH, { spacing = 2, allowRotate = true } = {}) {
  const freeRects = [{ x: 0, y: 0, w: binW, h: binH }];
  const placements = [];
  const unplaced = [];

  // Sort tallest/largest first for higher packing efficiency
  const sorted = [...items].sort((a, b) => Math.max(b.w, b.h) - Math.max(a.w, a.h) || b.w * b.h - a.w * a.h);

  for (const item of sorted) {
    const reqW = item.w + spacing;
    const reqH = item.h + spacing;

    let bestScore1 = Infinity;
    let bestScore2 = Infinity;
    let bestNode = null;
    let bestRotated = false;

    for (const r of freeRects) {
      // Normal orientation
      if (r.w >= reqW && r.h >= reqH) {
        const leftoverH = Math.abs(r.w - reqW);
        const leftoverV = Math.abs(r.h - reqH);
        const shortSide = Math.min(leftoverH, leftoverV);
        const longSide = Math.max(leftoverH, leftoverV);
        if (shortSide < bestScore1 || (shortSide === bestScore1 && longSide < bestScore2)) {
          bestScore1 = shortSide;
          bestScore2 = longSide;
          bestNode = { x: r.x, y: r.y, w: reqW, h: reqH };
          bestRotated = false;
        }
      }
      // 90-degree rotated orientation
      if (allowRotate && r.w >= reqH && r.h >= reqW) {
        const leftoverH = Math.abs(r.w - reqH);
        const leftoverV = Math.abs(r.h - reqW);
        const shortSide = Math.min(leftoverH, leftoverV);
        const longSide = Math.max(leftoverH, leftoverV);
        if (shortSide < bestScore1 || (shortSide === bestScore1 && longSide < bestScore2)) {
          bestScore1 = shortSide;
          bestScore2 = longSide;
          bestNode = { x: r.x, y: r.y, w: reqH, h: reqW };
          bestRotated = true;
        }
      }
    }

    if (!bestNode) {
      unplaced.push(item);
      continue;
    }

    // Split intersecting free rectangles
    let numRects = freeRects.length;
    for (let i = 0; i < numRects; i++) {
      const fr = freeRects[i];
      if (
        bestNode.x < fr.x + fr.w &&
        bestNode.x + bestNode.w > fr.x &&
        bestNode.y < fr.y + fr.h &&
        bestNode.y + bestNode.h > fr.y
      ) {
        if (bestNode.x > fr.x && bestNode.x < fr.x + fr.w) {
          freeRects.push({ x: fr.x, y: fr.y, w: bestNode.x - fr.x, h: fr.h });
        }
        if (bestNode.x + bestNode.w < fr.x + fr.w) {
          freeRects.push({
            x: bestNode.x + bestNode.w,
            y: fr.y,
            w: fr.x + fr.w - (bestNode.x + bestNode.w),
            h: fr.h,
          });
        }
        if (bestNode.y > fr.y && bestNode.y < fr.y + fr.h) {
          freeRects.push({ x: fr.x, y: fr.y, w: fr.w, h: bestNode.y - fr.y });
        }
        if (bestNode.y + bestNode.h < fr.y + fr.h) {
          freeRects.push({
            x: fr.x,
            y: bestNode.y + bestNode.h,
            w: fr.w,
            h: fr.y + fr.h - (bestNode.y + bestNode.h),
          });
        }
        freeRects.splice(i, 1);
        i--;
        numRects--;
      }
    }

    // Prune contained free rects
    for (let i = 0; i < freeRects.length; i++) {
      for (let j = i + 1; j < freeRects.length; j++) {
        const a = freeRects[i];
        const b = freeRects[j];
        if (a.x >= b.x && a.y >= b.y && a.x + a.w <= b.x + b.w && a.y + a.h <= b.y + b.h) {
          freeRects.splice(i, 1);
          i--;
          break;
        }
        if (b.x >= a.x && b.y >= a.y && b.x + b.w <= a.x + a.w && b.y + b.h <= a.y + a.h) {
          freeRects.splice(j, 1);
          j--;
        }
      }
    }

    placements.push({
      ...item,
      x: bestNode.x,
      y: bestNode.y,
      packedW: bestRotated ? item.h : item.w,
      packedH: bestRotated ? item.w : item.h,
      rotated: bestRotated,
    });
  }

  return { placements, unplaced };
}
