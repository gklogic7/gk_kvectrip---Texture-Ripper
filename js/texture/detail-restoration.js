// High-frequency detail restoration, edge preservation, sharpness, noise reduction, and local contrast

function clampByte(v) {
  return v < 0 ? 0 : v > 255 ? 255 : v | 0;
}

function boxBlur3x3(data, w, h) {
  const out = new Float32Array(data.length);
  for (let y = 0; y < h; y++) {
    const ym = (y - 1 + h) % h;
    const yp = (y + 1) % h;
    for (let x = 0; x < w; x++) {
      const xm = (x - 1 + w) % w;
      const xp = (x + 1) % w;
      const idx = (y * w + x) * 4;
      for (let c = 0; c < 3; c++) {
        const sum =
          data[(ym * w + xm) * 4 + c] +
          data[(ym * w + x) * 4 + c] +
          data[(ym * w + xp) * 4 + c] +
          data[(y * w + xm) * 4 + c] +
          data[idx + c] +
          data[(y * w + xp) * 4 + c] +
          data[(yp * w + xm) * 4 + c] +
          data[(yp * w + x) * 4 + c] +
          data[(yp * w + xp) * 4 + c];
        out[idx + c] = sum / 9;
      }
      out[idx + 3] = data[idx + 3];
    }
  }
  return out;
}

export function applyDetailRestoration(seamlessData, origData, w, h, detailCfg) {
  const strength = Math.max(0, Math.min(1.5, (detailCfg.strength ?? 45) / 100));
  const sharpness = Math.max(0, Math.min(1.5, (detailCfg.sharpness ?? 20) / 100));
  const edgePreserve = Math.max(0, Math.min(1, (detailCfg.edgePreserve ?? 50) / 100));
  const grain = Math.max(0, Math.min(1, (detailCfg.grain ?? 25) / 100));
  const noiseReduce = Math.max(0, Math.min(1, (detailCfg.noiseReduce ?? 0) / 100));
  const localContrast = Math.max(0, Math.min(1, (detailCfg.localContrast ?? 15) / 100));

  let working = new Uint8ClampedArray(seamlessData);

  // 1. Optional edge-aware noise reduction
  if (noiseReduce > 0.02) {
    const blurred = boxBlur3x3(working, w, h);
    for (let i = 0; i < w * h; i++) {
      const idx = i * 4;
      const diff =
        (Math.abs(working[idx] - blurred[idx]) +
          Math.abs(working[idx + 1] - blurred[idx + 1]) +
          Math.abs(working[idx + 2] - blurred[idx + 2])) /
        3;
      // Preserve strong edges while smoothing micro-noise
      const edgeWeight = Math.max(0, 1 - (diff / 35) * edgePreserve);
      const mix = noiseReduce * edgeWeight * 0.7;
      working[idx] = clampByte(working[idx] * (1 - mix) + blurred[idx] * mix);
      working[idx + 1] = clampByte(working[idx + 1] * (1 - mix) + blurred[idx + 1] * mix);
      working[idx + 2] = clampByte(working[idx + 2] * (1 - mix) + blurred[idx + 2] * mix);
    }
  }

  // 2. High-frequency detail recovery from original perspective texture
  if (strength > 0.01 && origData && origData.length === working.length) {
    const origBlur = boxBlur3x3(origData, w, h);
    const workBlur = boxBlur3x3(working, w, h);

    for (let i = 0; i < w * h; i++) {
      const idx = i * 4;
      for (let c = 0; c < 3; c++) {
        const origHigh = origData[idx + c] - origBlur[idx + c];
        const workHigh = working[idx + c] - workBlur[idx + c];
        // Restore missing high-frequency micro-detail without re-introducing border color seams
        const restored = working[idx + c] + (origHigh - workHigh * 0.35) * strength * (0.65 + grain * 0.55);
        working[idx + c] = clampByte(restored);
      }
    }
  }

  // 3. Controlled unsharp mask & local contrast enhancement
  if (sharpness > 0.01 || localContrast > 0.01) {
    const baseBlur = boxBlur3x3(working, w, h);
    for (let i = 0; i < w * h; i++) {
      const idx = i * 4;
      for (let c = 0; c < 3; c++) {
        const detail = working[idx + c] - baseBlur[idx + c];
        // Soft-clamp high-frequency boost to prevent artificial halos
        const dampedDetail = Math.tanh(detail / 28) * 28;
        const boost = sharpness * 0.75 + localContrast * 0.55;
        working[idx + c] = clampByte(working[idx + c] + dampedDetail * boost);
      }
    }
  }

  return working;
}
