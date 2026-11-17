// Shelf bin-packing algorithm (Next-Fit / Best-Fit shelf rows)

export function packShelf(items, binW, binH, { spacing = 2, allowRotate = true } = {}) {
  const shelves = []; // { y, height, usedW }
  const placements = [];
  const unplaced = [];

  const sorted = [...items].sort((a, b) => b.h - a.h || b.w - a.w);

  for (const item of sorted) {
    let w = item.w;
    let h = item.h;
    let rotated = false;

    if (allowRotate && h > w && h <= binW) {
      // Optionally orient landscape to reduce shelf height
      const tmp = w;
      w = h;
      h = tmp;
      rotated = true;
    }

    const reqW = w + spacing;
    const reqH = h + spacing;

    let placed = false;
    for (const shelf of shelves) {
      if (shelf.usedW + reqW <= binW && reqH <= shelf.height) {
        placements.push({
          ...item,
          x: shelf.usedW,
          y: shelf.y,
          packedW: w,
          packedH: h,
          rotated,
        });
        shelf.usedW += reqW;
        placed = true;
        break;
      }
      // Try un-rotated or rotated fit on existing shelf
      if (allowRotate && shelf.usedW + h + spacing <= binW && w + spacing <= shelf.height) {
        placements.push({
          ...item,
          x: shelf.usedW,
          y: shelf.y,
          packedW: h,
          packedH: w,
          rotated: !rotated,
        });
        shelf.usedW += h + spacing;
        placed = true;
        break;
      }
    }

    if (!placed) {
      const nextY = shelves.length ? shelves[shelves.length - 1].y + shelves[shelves.length - 1].height : 0;
      if (nextY + reqH <= binH && reqW <= binW) {
        shelves.push({ y: nextY, height: reqH, usedW: reqW });
        placements.push({
          ...item,
          x: 0,
          y: nextY,
          packedW: w,
          packedH: h,
          rotated,
        });
      } else if (allowRotate && nextY + w + spacing <= binH && h + spacing <= binW) {
        shelves.push({ y: nextY, height: w + spacing, usedW: h + spacing });
        placements.push({
          ...item,
          x: 0,
          y: nextY,
          packedW: h,
          packedH: w,
          rotated: !rotated,
        });
      } else {
        unplaced.push(item);
      }
    }
  }

  return { placements, unplaced };
}
