// Lighting flattening, contrast enhancement, RGB color balance, and pixel-art palette quantization + dithering

function clampByte(v) {
  return v < 0 ? 0 : v > 255 ? 255 : v | 0;
}

// Low-frequency illumination flattening (Lighting Correction)
export function applyColorAndLighting(data, w, h, colorCfg) {
  const contrast = (colorCfg.contrast ?? 0) / 100; // -1..1
  const lighting = Math.max(0, Math.min(1, (colorCfg.lighting ?? 0) / 100)); // 0..1
  const balR = 1 + (colorCfg.balanceR ?? 0) / 100;
  const balG = 1 + (colorCfg.balanceG ?? 0) / 100;
  const balB = 1 + (colorCfg.balanceB ?? 0) / 100;

  if (lighting <= 0.005 && Math.abs(contrast) <= 0.005 && balR === 1 && balG === 1 && balB === 1) {
    return new Uint8ClampedArray(data);
  }

  const out = new Uint8ClampedArray(data.length);

  // Compute global mean luminance + coarse local box average for lighting correction
  let lowFreq = null;
  let globalMean = 128;
  if (lighting > 0.005) {
    const rad = Math.max(6, Math.round(Math.min(w, h) * 0.12));
    const lum = new Float32Array(w * h);
    let totalLum = 0;
    for (let i = 0; i < w * h; i++) {
      const idx = i * 4;
      const l = 0.299 * data[idx] + 0.587 * data[idx + 1] + 0.114 * data[idx + 2];
      lum[i] = l;
      totalLum += l;
    }
    globalMean = totalLum / Math.max(1, w * h);

    // Separable stride-sampled coarse blur for fast O(N) low-frequency field
    const tmp = new Float32Array(w * h);
    const step = Math.max(1, Math.floor(rad / 6));
    for (let y = 0; y < h; y++) {
      const row = y * w;
      for (let x = 0; x < w; x++) {
        let sum = 0, cnt = 0;
        for (let k = -rad; k <= rad; k += step) {
          const sx = Math.max(0, Math.min(w - 1, x + k));
          sum += lum[row + sx];
          cnt++;
        }
        tmp[row + x] = sum / cnt;
      }
    }
    lowFreq = new Float32Array(w * h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let sum = 0, cnt = 0;
        for (let k = -rad; k <= rad; k += step) {
          const sy = Math.max(0, Math.min(h - 1, y + k));
          sum += tmp[sy * w + x];
          cnt++;
        }
        lowFreq[y * w + x] = sum / cnt;
      }
    }
  }

  const contrastFactor = contrast >= 0 ? 1 + contrast * 1.5 : 1 + contrast * 0.7;

  for (let i = 0; i < w * h; i++) {
    const idx = i * 4;
    let r = data[idx];
    let g = data[idx + 1];
    let b = data[idx + 2];

    if (lowFreq) {
      const localL = Math.max(8, lowFreq[i]);
      const targetScale = globalMean / localL;
      const scale = 1 + (targetScale - 1) * lighting;
      r *= scale;
      g *= scale;
      b *= scale;
    }

    r *= balR;
    g *= balG;
    b *= balB;

    if (contrast !== 0) {
      r = (r - 128) * contrastFactor + 128;
      g = (g - 128) * contrastFactor + 128;
      b = (b - 128) * contrastFactor + 128;
    }

    out[idx] = clampByte(r);
    out[idx + 1] = clampByte(g);
    out[idx + 2] = clampByte(b);
    out[idx + 3] = data[idx + 3];
  }

  return out;
}

// Median-Cut color quantization + Bayer 4x4 / Floyd-Steinberg dithering for Pixel-Art Workflow
function buildMedianCutPalette(data, maxColors) {
  const samples = [];
  const totalPixels = data.length / 4;
  const stride = Math.max(1, Math.floor(totalPixels / 4096));

  for (let i = 0; i < totalPixels; i += stride) {
    const idx = i * 4;
    if (data[idx + 3] < 16) continue;
    samples.push([data[idx], data[idx + 1], data[idx + 2]]);
  }
  if (!samples.length) return [[0, 0, 0]];

  let buckets = [samples];
  while (buckets.length < maxColors) {
    // Find bucket with largest color range
    let bestIdx = -1;
    let bestRange = -1;
    let bestChannel = 0;

    for (let b = 0; b < buckets.length; b++) {
      const bucket = buckets[b];
      if (bucket.length < 2) continue;
      let minR = 255, maxR = 0, minG = 255, maxG = 0, minB = 255, maxB = 0;
      for (const c of bucket) {
        if (c[0] < minR) minR = c[0]; if (c[0] > maxR) maxR = c[0];
        if (c[1] < minG) minG = c[1]; if (c[1] > maxG) maxG = c[1];
        if (c[2] < minB) minB = c[2]; if (c[2] > maxB) maxB = c[2];
      }
      const rR = maxR - minR;
      const rG = maxG - minG;
      const rB = maxB - minB;
      const range = Math.max(rR, rG, rB);
      if (range > bestRange) {
        bestRange = range;
        bestIdx = b;
        bestChannel = rR >= rG && rR >= rB ? 0 : rG >= rB ? 1 : 2;
      }
    }

    if (bestIdx === -1 || bestRange === 0) break;

    const target = buckets.splice(bestIdx, 1)[0];
    target.sort((a, b) => a[bestChannel] - b[bestChannel]);
    const mid = Math.floor(target.length / 2);
    buckets.push(target.slice(0, mid), target.slice(mid));
  }

  return buckets.map((bucket) => {
    let sr = 0, sg = 0, sb = 0;
    for (const c of bucket) {
      sr += c[0];
      sg += c[1];
      sb += c[2];
    }
    const len = Math.max(1, bucket.length);
    return [Math.round(sr / len), Math.round(sg / len), Math.round(sb / len)];
  });
}

function nearestPaletteColor(r, g, b, palette) {
  let best = palette[0];
  let bestDist = Infinity;
  for (let i = 0; i < palette.length; i++) {
    const p = palette[i];
    const dr = r - p[0];
    const dg = g - p[1];
    const db = b - p[2];
    const dist = dr * dr + dg * dg + db * db;
    if (dist < bestDist) {
      bestDist = dist;
      best = p;
    }
  }
  return best;
}

const BAYER_4X4 = [
  [0, 8, 2, 10],
  [12, 4, 14, 6],
  [3, 11, 1, 9],
  [15, 7, 13, 5],
];

export function applyPixelArtQuantization(data, w, h, pixelArtCfg) {
  if (!pixelArtCfg || !pixelArtCfg.enabled) {
    return new Uint8ClampedArray(data);
  }
  const colorCount = Math.max(2, Math.min(256, pixelArtCfg.paletteCount || 16));
  const dither = pixelArtCfg.dither || 'none';
  const palette = buildMedianCutPalette(data, colorCount);
  const out = new Uint8ClampedArray(data);

  if (dither === 'floyd') {
    const buf = new Float32Array(data.length);
    for (let i = 0; i < data.length; i++) buf[i] = data[i];

    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const idx = (y * w + x) * 4;
        if (buf[idx + 3] < 16) {
          out[idx + 3] = 0;
          continue;
        }
        const oldR = buf[idx];
        const oldG = buf[idx + 1];
        const oldB = buf[idx + 2];
        const [nr, ng, nb] = nearestPaletteColor(oldR, oldG, oldB, palette);
        out[idx] = nr;
        out[idx + 1] = ng;
        out[idx + 2] = nb;
        out[idx + 3] = data[idx + 3];

        const er = oldR - nr;
        const eg = oldG - ng;
        const eb = oldB - nb;

        const spread = (nx, ny, factor) => {
          if (nx < 0 || nx >= w || ny < 0 || ny >= h) return;
          const nIdx = (ny * w + nx) * 4;
          buf[nIdx] += er * factor;
          buf[nIdx + 1] += eg * factor;
          buf[nIdx + 2] += eb * factor;
        };
        spread(x + 1, y, 7 / 16);
        spread(x - 1, y + 1, 3 / 16);
        spread(x, y + 1, 5 / 16);
        spread(x + 1, y + 1, 1 / 16);
      }
    }
    return out;
  }

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const idx = (y * w + x) * 4;
      if (out[idx + 3] < 16) continue;
      let r = out[idx];
      let g = out[idx + 1];
      let b = out[idx + 2];

      if (dither === 'bayer') {
        const threshold = (BAYER_4X4[y & 3][x & 3] / 16 - 0.5) * 42;
        r = clampByte(r + threshold);
        g = clampByte(g + threshold);
        b = clampByte(b + threshold);
      }

      const [nr, ng, nb] = nearestPaletteColor(r, g, b, palette);
      out[idx] = nr;
      out[idx + 1] = ng;
      out[idx + 2] = nb;
    }
  }

  return out;
}
