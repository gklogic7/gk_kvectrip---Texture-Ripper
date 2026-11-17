// Method A: Smoothed Collage seamless synthesis (pure pixel processing)

function smoothstep(edge0, edge1, x) {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0 + 1e-6)));
  return t * t * (3 - 2 * t);
}

// Fast separable box blur restricted to seam mask weights
function seamRestrictedBlur(data, w, h, radius, seamMask) {
  if (radius < 1) return data;
  const tmp = new Float32Array(w * h * 4);
  const out = new Uint8ClampedArray(data.length);
  const r = Math.min(24, Math.max(1, Math.round(radius)));

  // Horizontal wrapped pass
  for (let y = 0; y < h; y++) {
    const rowOff = y * w;
    for (let x = 0; x < w; x++) {
      let sr = 0, sg = 0, sb = 0, sa = 0, count = 0;
      for (let k = -r; k <= r; k++) {
        const sx = (x + k + w) % w;
        const idx = (rowOff + sx) * 4;
        sr += data[idx];
        sg += data[idx + 1];
        sb += data[idx + 2];
        sa += data[idx + 3];
        count++;
      }
      const o = (rowOff + x) * 4;
      tmp[o] = sr / count;
      tmp[o + 1] = sg / count;
      tmp[o + 2] = sb / count;
      tmp[o + 3] = sa / count;
    }
  }

  // Vertical wrapped pass, blended strictly by seamMask
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const m = seamMask[y * w + x];
      const o = (y * w + x) * 4;
      if (m <= 0.001) {
        out[o] = data[o];
        out[o + 1] = data[o + 1];
        out[o + 2] = data[o + 2];
        out[o + 3] = data[o + 3];
        continue;
      }
      let sr = 0, sg = 0, sb = 0, sa = 0, count = 0;
      for (let k = -r; k <= r; k++) {
        const sy = (y + k + h) % h;
        const idx = (sy * w + x) * 4;
        sr += tmp[idx];
        sg += tmp[idx + 1];
        sb += tmp[idx + 2];
        sa += tmp[idx + 3];
        count++;
      }
      const inv = 1 - m;
      out[o] = Math.round(data[o] * inv + (sr / count) * m);
      out[o + 1] = Math.round(data[o + 1] * inv + (sg / count) * m);
      out[o + 2] = Math.round(data[o + 2] * inv + (sb / count) * m);
      out[o + 3] = Math.round(data[o + 3] * inv + (sa / count) * m);
    }
  }
  return out;
}

export function runSmoothedCollage(srcData, w, h, params) {
  // Divide into 2x2 quadrants, swap opposite edges into center cross, blend overlapping sections
  const blendFrac = Math.max(0.05, Math.min(0.45, (params.blendWidth ?? 25) / 100));
  const softness = Math.max(0.05, Math.min(1, (params.seamBlending ?? 60) / 100));
  const strength = Math.max(0, Math.min(1, (params.blendStrength ?? 85) / 100));
  const edgeSmooth = Math.max(0, Math.min(1, (params.edgeSmoothing ?? 35) / 100));

  const hw = Math.floor(w / 2);
  const hh = Math.floor(h / 2);
  const bw = Math.max(4, Math.round(w * blendFrac * 0.5));
  const bh = Math.max(4, Math.round(h * blendFrac * 0.5));

  const result = new Uint8ClampedArray(srcData.length);
  const seamMask = new Float32Array(w * h);

  // Rearrange quadrants (50% shift) and blend overlap zones with original
  for (let y = 0; y < h; y++) {
    const sy = (y + hh) % h;
    const dyCenter = Math.abs(y - hh);
    const wy = dyCenter < bh ? 1 - smoothstep(0, bh, dyCenter) : 0;

    for (let x = 0; x < w; x++) {
      const sx = (x + hw) % w;
      const dxCenter = Math.abs(x - hw);
      const wx = dxCenter < bw ? 1 - smoothstep(0, bw, dxCenter) : 0;

      // Also track border proximity on wrapped coordinates
      const wSeam = Math.max(wx, wy);
      const m = Math.pow(wSeam, 1.4 - softness * 0.8) * strength;
      seamMask[y * w + x] = wSeam;

      const sIdx = (sy * w + sx) * 4;
      const oIdx = (y * w + x) * 4;

      // Cross-blend shifted pixel with nearby collage patch from unshifted source
      const altX = (sx + Math.round(bw * 0.6)) % w;
      const altY = (sy + Math.round(bh * 0.6)) % h;
      const aIdx = (altY * w + altX) * 4;

      const inv = 1 - m * 0.75;
      const mix = m * 0.75;

      result[oIdx] = Math.round(srcData[sIdx] * inv + ((srcData[oIdx] + srcData[aIdx]) * 0.5) * mix);
      result[oIdx + 1] = Math.round(srcData[sIdx + 1] * inv + ((srcData[oIdx + 1] + srcData[aIdx + 1]) * 0.5) * mix);
      result[oIdx + 2] = Math.round(srcData[sIdx + 2] * inv + ((srcData[oIdx + 2] + srcData[aIdx + 2]) * 0.5) * mix);
      result[oIdx + 3] = Math.round(srcData[sIdx + 3] * inv + srcData[oIdx + 3] * mix);
    }
  }

  // Apply adjustable blur strictly to seam regions (never globally)
  let blurred = result;
  if (edgeSmooth > 0.05) {
    const blurRadius = Math.max(1, Math.round(edgeSmooth * Math.min(bw, bh) * 0.35));
    const maskedBlur = seamMask.map((v) => v * edgeSmooth);
    blurred = seamRestrictedBlur(result, w, h, blurRadius, maskedBlur);
  }

  // Shift back 50% so original orientation is preserved while edges are seamless
  const finalOut = new Uint8ClampedArray(srcData.length);
  for (let y = 0; y < h; y++) {
    const ty = (y + h - hh) % h;
    for (let x = 0; x < w; x++) {
      const tx = (x + w - hw) % w;
      const srcI = (y * w + x) * 4;
      const dstI = (ty * w + tx) * 4;
      finalOut[dstI] = blurred[srcI];
      finalOut[dstI + 1] = blurred[srcI + 1];
      finalOut[dstI + 2] = blurred[srcI + 2];
      finalOut[dstI + 3] = blurred[srcI + 3];
    }
  }

  return finalOut;
}
