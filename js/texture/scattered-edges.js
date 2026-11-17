// Method B: Scattered Edges seamless synthesis with randomized irregular masks

function createRng(seed) {
  let s = (seed || 1337) >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function hashNoise(x, y, seed) {
  const n = Math.sin(x * 12.9898 + y * 78.233 + seed * 37.719) * 43758.5453;
  return n - Math.floor(n);
}

export function runScatteredEdges(srcData, w, h, params) {
  const randFactor = Math.max(0.1, (params.randomization ?? 50) / 100);
  const blendFrac = Math.max(0.08, Math.min(0.45, (params.blendWidth ?? 25) / 100));
  const softness = Math.max(0.1, Math.min(1, (params.seamBlending ?? 60) / 100));
  const strength = Math.max(0, Math.min(1, (params.blendStrength ?? 85) / 100));
  const seed = params.seed ?? 42;
  const rng = createRng(seed);

  const out = new Uint8ClampedArray(srcData);
  const patchCount = Math.max(10, Math.round((18 + randFactor * 36) * (0.6 + blendFrac)));
  const maxRx = Math.max(6, Math.round(w * blendFrac * 0.55));
  const maxRy = Math.max(6, Math.round(h * blendFrac * 0.55));

  // Distribute patches specifically crossing the horizontal (x=0/w) and vertical (y=0/h) tile boundaries
  for (let p = 0; p < patchCount; p++) {
    const onVerticalSeam = p % 2 === 0;
    const dstCx = onVerticalSeam
      ? (rng() < 0.5 ? rng() * maxRx * 0.45 : w - rng() * maxRx * 0.45)
      : rng() * w;
    const dstCy = !onVerticalSeam
      ? (rng() < 0.5 ? rng() * maxRy * 0.45 : h - rng() * maxRy * 0.45)
      : rng() * h;

    // Sample patch from safe interior region away from edges
    const marginX = Math.max(4, Math.floor(w * 0.18));
    const marginY = Math.max(4, Math.floor(h * 0.18));
    const srcCx = marginX + rng() * Math.max(4, w - marginX * 2);
    const srcCy = marginY + rng() * Math.max(4, h - marginY * 2);

    const rx = Math.max(5, Math.round(maxRx * (0.45 + rng() * 0.75)));
    const ry = Math.max(5, Math.round(maxRy * (0.45 + rng() * 0.75)));
    const phase = rng() * Math.PI * 2;

    for (let dy = -ry; dy <= ry; dy++) {
      const py = ((Math.round(dstCy + dy) % h) + h) % h;
      const sy = Math.max(0, Math.min(h - 1, Math.round(srcCy + dy)));
      const ny = dy / ry;

      for (let dx = -rx; dx <= rx; dx++) {
        const nx = dx / rx;
        // Irregular organic boundary distortion
        const angle = Math.atan2(ny, nx);
        const wobble = 0.78 + 0.22 * Math.sin(angle * 3 + phase) + (hashNoise(dx + p, dy, seed) - 0.5) * 0.16 * randFactor;
        const dist = Math.hypot(nx, ny) / wobble;
        if (dist >= 1) continue;

        const feather = Math.pow(1 - dist, 1.8 - softness * 1.1) * strength;
        const px = ((Math.round(dstCx + dx) % w) + w) % w;
        const sx = Math.max(0, Math.min(w - 1, Math.round(srcCx + dx)));

        const dIdx = (py * w + px) * 4;
        const sIdx = (sy * w + sx) * 4;

        const inv = 1 - feather;
        out[dIdx] = Math.round(out[dIdx] * inv + srcData[sIdx] * feather);
        out[dIdx + 1] = Math.round(out[dIdx + 1] * inv + srcData[sIdx + 1] * feather);
        out[dIdx + 2] = Math.round(out[dIdx + 2] * inv + srcData[sIdx + 2] * feather);
        out[dIdx + 3] = Math.round(out[dIdx + 3] * inv + srcData[sIdx + 3] * feather);
      }
    }
  }

  return out;
}
