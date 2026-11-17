// Seamless synthesis engine supporting Methods A, B, C, D, and E
import { runSmoothedCollage } from './smoothed-collage.js';
import { runScatteredEdges } from './scattered-edges.js';

function smoothstep(edge0, edge1, x) {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0 + 1e-6)));
  return t * t * (3 - 2 * t);
}

// Method C: Offset 50% H/V & Cross-Seam Mask Blend
export function runOffsetAndBlend(srcData, w, h, params) {
  const hw = Math.floor(w / 2);
  const hh = Math.floor(h / 2);
  const blendFrac = Math.max(0.04, Math.min(0.45, (params.blendWidth ?? 25) / 100));
  const softness = Math.max(0.05, Math.min(1, (params.seamBlending ?? 60) / 100));
  const strength = Math.max(0, Math.min(1, (params.blendStrength ?? 85) / 100));

  const bw = Math.max(4, Math.round(w * blendFrac));
  const bh = Math.max(4, Math.round(h * blendFrac));
  const out = new Uint8ClampedArray(srcData.length);

  for (let y = 0; y < h; y++) {
    const sy = (y + hh) % h;
    const distY = Math.abs(y - hh);
    const wy = distY < bh ? 1 - smoothstep(0, bh, distY) : 0;

    for (let x = 0; x < w; x++) {
      const sx = (x + hw) % w;
      const distX = Math.abs(x - hw);
      const wx = distX < bw ? 1 - smoothstep(0, bw, distX) : 0;

      const seamWeight = Math.pow(Math.max(wx, wy), 1.5 - softness * 0.85) * strength;
      const shiftedIdx = (sy * w + sx) * 4;
      const origIdx = (y * w + x) * 4;

      // Sample mirror-interior patch to heal center cross seam without global blur
      const healX = (x + Math.round(w * 0.25)) % w;
      const healY = (y + Math.round(h * 0.25)) % h;
      const healIdx = (healY * w + healX) * 4;

      const inv = 1 - seamWeight;
      const r = srcData[shiftedIdx] * inv + ((srcData[origIdx] + srcData[healIdx]) * 0.5) * seamWeight;
      const g = srcData[shiftedIdx + 1] * inv + ((srcData[origIdx + 1] + srcData[healIdx + 1]) * 0.5) * seamWeight;
      const b = srcData[shiftedIdx + 2] * inv + ((srcData[origIdx + 2] + srcData[healIdx + 2]) * 0.5) * seamWeight;
      const a = srcData[shiftedIdx + 3] * inv + srcData[origIdx + 3] * seamWeight;

      // Unshift back to preserve visual alignment
      const outX = (x + w - hw) % w;
      const outY = (y + h - hh) % h;
      const outIdx = (outY * w + outX) * 4;
      out[outIdx] = Math.round(r);
      out[outIdx + 1] = Math.round(g);
      out[outIdx + 2] = Math.round(b);
      out[outIdx + 3] = Math.round(a);
    }
  }
  return out;
}

// Method D: Mirror & Blend opposite edge transitions
export function runMirrorAndBlend(srcData, w, h, params) {
  const blendFrac = Math.max(0.05, Math.min(0.45, (params.blendWidth ?? 25) / 100));
  const softness = Math.max(0.05, Math.min(1, (params.seamBlending ?? 60) / 100));
  const strength = Math.max(0, Math.min(1, (params.blendStrength ?? 85) / 100));

  const bw = Math.max(4, Math.round(w * blendFrac));
  const bh = Math.max(4, Math.round(h * blendFrac));

  // Horizontal mirror blend pass
  const tmp = new Uint8ClampedArray(srcData.length);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const idx = (y * w + x) * 4;
      const distEdgeX = Math.min(x, w - 1 - x);
      if (distEdgeX >= bw) {
        tmp[idx] = srcData[idx];
        tmp[idx + 1] = srcData[idx + 1];
        tmp[idx + 2] = srcData[idx + 2];
        tmp[idx + 3] = srcData[idx + 3];
        continue;
      }
      const mirrorX = w - 1 - x;
      const mIdx = (y * w + mirrorX) * 4;
      const t = (1 - smoothstep(0, bw, distEdgeX)) * 0.5 * strength;
      const wt = Math.pow(t * 2, 1.3 - softness * 0.6) * 0.5;
      const inv = 1 - wt;
      tmp[idx] = Math.round(srcData[idx] * inv + srcData[mIdx] * wt);
      tmp[idx + 1] = Math.round(srcData[idx + 1] * inv + srcData[mIdx + 1] * wt);
      tmp[idx + 2] = Math.round(srcData[idx + 2] * inv + srcData[mIdx + 2] * wt);
      tmp[idx + 3] = Math.round(srcData[idx + 3] * inv + srcData[mIdx + 3] * wt);
    }
  }

  // Vertical mirror blend pass
  const out = new Uint8ClampedArray(srcData.length);
  for (let y = 0; y < h; y++) {
    const distEdgeY = Math.min(y, h - 1 - y);
    const mirrorY = h - 1 - y;
    const t = distEdgeY < bh ? (1 - smoothstep(0, bh, distEdgeY)) * 0.5 * strength : 0;
    const wt = t > 0 ? Math.pow(t * 2, 1.3 - softness * 0.6) * 0.5 : 0;
    const inv = 1 - wt;

    for (let x = 0; x < w; x++) {
      const idx = (y * w + x) * 4;
      if (wt <= 0) {
        out[idx] = tmp[idx];
        out[idx + 1] = tmp[idx + 1];
        out[idx + 2] = tmp[idx + 2];
        out[idx + 3] = tmp[idx + 3];
        continue;
      }
      const mIdx = (mirrorY * w + x) * 4;
      out[idx] = Math.round(tmp[idx] * inv + tmp[mIdx] * wt);
      out[idx + 1] = Math.round(tmp[idx + 1] * inv + tmp[mIdx + 1] * wt);
      out[idx + 2] = Math.round(tmp[idx + 2] * inv + tmp[mIdx + 2] * wt);
      out[idx + 3] = Math.round(tmp[idx + 3] * inv + tmp[mIdx + 3] * wt);
    }
  }
  return out;
}

// Method E: Clone-Based Seam Repair (auto-samples nearby clean patches + applies manual clone strokes)
export function runCloneSeamRepair(srcData, w, h, params, clonePatches = []) {
  const blendFrac = Math.max(0.05, Math.min(0.4, (params.blendWidth ?? 25) / 100));
  const strength = Math.max(0, Math.min(1, (params.blendStrength ?? 85) / 100));
  const edgeSmooth = Math.max(0.1, Math.min(1, (params.edgeSmoothing ?? 35) / 100));
  const out = new Uint8ClampedArray(srcData);

  const bw = Math.max(4, Math.round(w * blendFrac));
  const bh = Math.max(4, Math.round(h * blendFrac));

  // Auto-clone nearby interior texture across wrapped borders
  for (let y = 0; y < h; y++) {
    const dy = Math.min(y, h - 1 - y);
    const wy = dy < bh ? 1 - smoothstep(0, bh, dy) : 0;
    for (let x = 0; x < w; x++) {
      const dx = Math.min(x, w - 1 - x);
      const wx = dx < bw ? 1 - smoothstep(0, bw, dx) : 0;
      const weight = Math.max(wx, wy) * strength * 0.75;
      if (weight <= 0.01) continue;

      // Sample opposite wrapped border & nearby clean interior
      const oppX = (x + w - (x < w / 2 ? -bw : bw)) % w;
      const oppY = (y + h - (y < h / 2 ? -bh : bh)) % h;
      const wrapX = (w - 1 - x + w) % w;
      const wrapY = (h - 1 - y + h) % h;

      const idx = (y * w + x) * 4;
      const s1 = (oppY * w + oppX) * 4;
      const s2 = (wrapY * w + wrapX) * 4;

      const blendTargetR = (srcData[s1] * (1 - edgeSmooth * 0.4) + srcData[s2] * (edgeSmooth * 0.4));
      const blendTargetG = (srcData[s1 + 1] * (1 - edgeSmooth * 0.4) + srcData[s2 + 1] * (edgeSmooth * 0.4));
      const blendTargetB = (srcData[s1 + 2] * (1 - edgeSmooth * 0.4) + srcData[s2 + 2] * (edgeSmooth * 0.4));

      const inv = 1 - weight;
      out[idx] = Math.round(out[idx] * inv + blendTargetR * weight);
      out[idx + 1] = Math.round(out[idx + 1] * inv + blendTargetG * weight);
      out[idx + 2] = Math.round(out[idx + 2] * inv + blendTargetB * weight);
    }
  }

  // Apply user's manual clone repair strokes if requested
  if (params._skipManualPatches !== true) {
    applyManualClonePatches(out, srcData, w, h, clonePatches);
  }

  return out;
}

export function applyManualClonePatches(targetData, srcData, w, h, clonePatches = []) {
  if (!clonePatches || !clonePatches.length) return targetData;
  for (const patch of clonePatches) {
    const r = Math.max(3, Math.round(patch.radius || 14));
    const cx = Math.round(patch.dstX * w);
    const cy = Math.round(patch.dstY * h);
    const sx0 = Math.round(patch.srcX * w);
    const sy0 = Math.round(patch.srcY * h);
    const pStrength = patch.strength ?? 0.9;

    for (let dy = -r; dy <= r; dy++) {
      const py = ((cy + dy) % h + h) % h;
      const sy = ((sy0 + dy) % h + h) % h;
      for (let dx = -r; dx <= r; dx++) {
        const dist = Math.hypot(dx, dy);
        if (dist > r) continue;
        const feather = (1 - smoothstep(0, r, dist)) * pStrength;
        const px = ((cx + dx) % w + w) % w;
        const sx = ((sx0 + dx) % w + w) % w;
        const dIdx = (py * w + px) * 4;
        const sIdx = (sy * w + sx) * 4;
        const inv = 1 - feather;
        targetData[dIdx] = Math.round(targetData[dIdx] * inv + srcData[sIdx] * feather);
        targetData[dIdx + 1] = Math.round(targetData[dIdx + 1] * inv + srcData[sIdx + 1] * feather);
        targetData[dIdx + 2] = Math.round(targetData[dIdx + 2] * inv + srcData[sIdx + 2] * feather);
      }
    }
  }
  return targetData;
}

function wrapBuffer(srcData, w, h, offsetX = 0, offsetY = 0) {
  const ox = ((Math.round(offsetX * w) % w) + w) % w;
  const oy = ((Math.round(offsetY * h) % h) + h) % h;
  if (ox === 0 && oy === 0) return srcData;

  const wrapped = new Uint8ClampedArray(srcData.length);
  for (let y = 0; y < h; y++) {
    const sy = (y + h - oy) % h;
    for (let x = 0; x < w; x++) {
      const sx = (x + w - ox) % w;
      const dIdx = (y * w + x) * 4;
      const sIdx = (sy * w + sx) * 4;
      wrapped[dIdx] = srcData[sIdx];
      wrapped[dIdx + 1] = srcData[sIdx + 1];
      wrapped[dIdx + 2] = srcData[sIdx + 2];
      wrapped[dIdx + 3] = srcData[sIdx + 3];
    }
  }
  return wrapped;
}

export function applySeamlessAlgorithm(srcData, w, h, seamlessConfig, clonePatches = []) {
  const wrappedSrc = seamlessConfig
    ? wrapBuffer(srcData, w, h, seamlessConfig.offsetX || 0, seamlessConfig.offsetY || 0)
    : srcData;

  if (!seamlessConfig || !seamlessConfig.enabled) {
    const out = new Uint8ClampedArray(wrappedSrc);
    applyManualClonePatches(out, wrappedSrc, w, h, clonePatches);
    return out;
  }

  let result;
  switch (seamlessConfig.method) {
    case 'collage':
      result = runSmoothedCollage(wrappedSrc, w, h, seamlessConfig);
      break;
    case 'scattered':
      result = runScatteredEdges(wrappedSrc, w, h, seamlessConfig);
      break;
    case 'offset':
      result = runOffsetAndBlend(wrappedSrc, w, h, seamlessConfig);
      break;
    case 'mirror':
      result = runMirrorAndBlend(wrappedSrc, w, h, seamlessConfig);
      break;
    case 'clone':
      result = runCloneSeamRepair(wrappedSrc, w, h, { ...seamlessConfig, _skipManualPatches: true }, clonePatches);
      break;
    default:
      result = runSmoothedCollage(wrappedSrc, w, h, seamlessConfig);
  }

  applyManualClonePatches(result, wrappedSrc, w, h, clonePatches);
  return result;
}
