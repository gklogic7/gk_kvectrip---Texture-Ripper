// Atlas FX Engine: Array Tile-Repeat composer, 20 Overlay/Shader Filters (default None), and Full Post-Processing Stack with Sharpness

export const ATLAS_OVERLAY_FILTERS = [
  { id: 'none', name: 'None (Original)', category: 'Default', desc: 'Bypass overlay filter' },
  { id: 'ps1', name: 'PS1 Hardware', category: 'Console', desc: '15-bit RGB555 color + 4x4 Bayer dither + texel grid' },
  { id: 'ps2', name: 'PS2 Broadcast', category: 'Console', desc: 'Warm half-res interlace scan + soft highlight bloom' },
  { id: 'retro_crt', name: 'Retro CRT', category: 'Display', desc: 'Aperture phosphor grille + scanlines + vignette' },
  { id: 'vhs', name: 'VHS Tape', category: 'Analog', desc: 'Chroma bleed shift + tape noise + scan jitter' },
  { id: 'gameboy', name: 'Game Boy DMG', category: 'Console', desc: '4-shade olive LCD palette + dot matrix' },
  { id: 'nes', name: '8-Bit NES', category: 'Console', desc: 'Quantized palette + crisp 2x pixel blockiness' },
  { id: 'arcade_scan', name: 'Arcade RGB', category: 'Display', desc: 'High-contrast RGB subpixel triad + pop' },
  { id: 'dither_bayer', name: 'Bayer Dither', category: 'Retro', desc: 'Hard 4x4 ordered matrix color quantization' },
  { id: 'halftone', name: 'Print Halftone', category: 'Print', desc: 'Angled luminance dot screen pattern' },
  { id: 'cel_toon', name: 'Cel / Toon', category: 'Shader', desc: 'Stepped luminance bands + crisp Sobel ink edges' },
  { id: 'comic_ink', name: 'Comic Ink', category: 'Shader', desc: 'Heavy ink outlines + flat posterized fill' },
  { id: 'outline_glow', name: 'Neon Edge', category: 'Shader', desc: 'Sobel edge wireframe over darkened base' },
  { id: 'emboss', name: 'Relief Emboss', category: 'Surface', desc: 'Directional 3x3 normal height-relief shading' },
  { id: 'thermal', name: 'Thermal IR', category: 'Sensor', desc: 'False-color infrared heat-map ramp' },
  { id: 'night_vision', name: 'Night Vision', category: 'Sensor', desc: 'Amplified phosphor green + grain + optic ring' },
  { id: 'blueprint', name: 'Blueprint CAD', category: 'Technical', desc: 'Cyanotype grid & inverted edge lines' },
  { id: 'sepia_vintage', name: 'Vintage Sepia', category: 'Film', desc: 'Warm silver-gelatin toning + film grain' },
  { id: 'cyber_duotone', name: 'Synth Duotone', category: 'Color', desc: 'Split teal shadow & magenta highlight curve' },
  { id: 'glitch_rgb', name: 'RGB Glitch', category: 'Analog', desc: 'Horizontal slice displacement + channel split' },
  { id: 'oil_poster', name: 'Gouache / Oil', category: 'Paint', desc: 'Softened brushwork + clustered palette levels' },
];

const BAYER_4X4 = [
  [0, 8, 2, 10],
  [12, 4, 14, 6],
  [3, 11, 1, 9],
  [15, 7, 13, 5],
];

const DMG_PALETTE = [
  [15, 56, 15],
  [48, 98, 48],
  [139, 172, 15],
  [155, 188, 15],
];

function clamp255(v) {
  return v < 0 ? 0 : v > 255 ? 255 : v | 0;
}

function mixChannel(a, b, t) {
  return clamp255(a + (b - a) * t);
}

function luma(r, g, b) {
  return 0.299 * r + 0.587 * g + 0.114 * b;
}

function hash2(x, y, seed = 1337) {
  let n = (x * 374761393 + y * 668265263 + seed * 1442695041) | 0;
  n = ((n ^ (n >>> 13)) * 1274126177) | 0;
  return ((n ^ (n >>> 16)) >>> 0) / 4294967295;
}

function cloneCanvas(src) {
  const c = document.createElement('canvas');
  c.width = Math.max(1, src.width);
  c.height = Math.max(1, src.height);
  const ctx = c.getContext('2d');
  ctx.drawImage(src, 0, 0);
  return c;
}

/**
 * Composes a placement sourceCanvas into targetW x targetH.
 * When arrayEnabled is true, tiles/repeats the source texture (scaled by tileScaleX/Y for Whole + Array mode) instead of stretching.
 */
export function buildPlacementSurface(
  sourceCanvas,
  targetW,
  targetH,
  arrayEnabled,
  pixelArt = false,
  tileScaleX = 1,
  tileScaleY = 1
) {
  const w = Math.max(1, Math.round(targetW));
  const h = Math.max(1, Math.round(targetH));
  const out = document.createElement('canvas');
  out.width = w;
  out.height = h;
  const ctx = out.getContext('2d');
  ctx.imageSmoothingEnabled = !pixelArt;

  if (!arrayEnabled) {
    ctx.drawImage(sourceCanvas, 0, 0, w, h);
    return out;
  }

  const sx = Math.max(0.15, Math.min(8, Number(tileScaleX) || 1));
  const sy = Math.max(0.15, Math.min(8, Number(tileScaleY) || 1));
  const tileW = Math.max(2, Math.round(sourceCanvas.width * sx));
  const tileH = Math.max(2, Math.round(sourceCanvas.height * sy));

  for (let y = 0; y < h; y += tileH) {
    for (let x = 0; x < w; x += tileW) {
      ctx.drawImage(sourceCanvas, x, y, tileW, tileH);
    }
  }
  return out;
}

function boxBlur(srcData, w, h, radius) {
  const dst = new Uint8ClampedArray(srcData.length);
  const tmp = new Float32Array(srcData.length);
  const r = Math.max(1, radius | 0);
  const diam = r * 2 + 1;

  for (let y = 0; y < h; y++) {
    const rowOff = y * w * 4;
    for (let x = 0; x < w; x++) {
      let sr = 0;
      let sg = 0;
      let sb = 0;
      let sa = 0;
      for (let kx = -r; kx <= r; kx++) {
        const sx = Math.max(0, Math.min(w - 1, x + kx));
        const idx = rowOff + sx * 4;
        sr += srcData[idx];
        sg += srcData[idx + 1];
        sb += srcData[idx + 2];
        sa += srcData[idx + 3];
      }
      const o = rowOff + x * 4;
      tmp[o] = sr / diam;
      tmp[o + 1] = sg / diam;
      tmp[o + 2] = sb / diam;
      tmp[o + 3] = sa / diam;
    }
  }

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let sr = 0;
      let sg = 0;
      let sb = 0;
      let sa = 0;
      for (let ky = -r; ky <= r; ky++) {
        const sy = Math.max(0, Math.min(h - 1, y + ky));
        const idx = (sy * w + x) * 4;
        sr += tmp[idx];
        sg += tmp[idx + 1];
        sb += tmp[idx + 2];
        sa += tmp[idx + 3];
      }
      const o = (y * w + x) * 4;
      dst[o] = sr / diam;
      dst[o + 1] = sg / diam;
      dst[o + 2] = sb / diam;
      dst[o + 3] = srcData[o + 3];
    }
  }

  return dst;
}

function computeSobelEdge(src, w, h, x, y) {
  const lumAt = (px, py) => {
    const cx = px < 0 ? 0 : px >= w ? w - 1 : px;
    const cy = py < 0 ? 0 : py >= h ? h - 1 : py;
    const idx = (cy * w + cx) * 4;
    return 0.299 * src[idx] + 0.587 * src[idx + 1] + 0.114 * src[idx + 2];
  };
  const tl = lumAt(x - 1, y - 1);
  const t = lumAt(x, y - 1);
  const tr = lumAt(x + 1, y - 1);
  const l = lumAt(x - 1, y);
  const r = lumAt(x + 1, y);
  const bl = lumAt(x - 1, y + 1);
  const b = lumAt(x, y + 1);
  const br = lumAt(x + 1, y + 1);
  const gx = -tl - 2 * l - bl + tr + 2 * r + br;
  const gy = -tl - 2 * t - tr + bl + 2 * b + br;
  return Math.min(255, Math.hypot(gx, gy));
}

function thermalRamp(t) {
  // 0..1 -> deep indigo -> purple -> red -> orange -> yellow -> white
  if (t < 0.2) {
    const k = t / 0.2;
    return [mixChannel(10, 88, k), mixChannel(8, 12, k), mixChannel(54, 148, k)];
  }
  if (t < 0.45) {
    const k = (t - 0.2) / 0.25;
    return [mixChannel(88, 210, k), mixChannel(12, 32, k), mixChannel(148, 56, k)];
  }
  if (t < 0.72) {
    const k = (t - 0.45) / 0.27;
    return [mixChannel(210, 250, k), mixChannel(32, 165, k), mixChannel(56, 16, k)];
  }
  const k = (t - 0.72) / 0.28;
  return [255, mixChannel(165, 255, k), mixChannel(16, 220, k)];
}

/**
 * Applies any of the 20 stylized overlay filters to a canvas (non-destructive: returns new canvas if active).
 */
export function applyOverlayFilterToCanvas(canvas, filterId = 'none', intensity = 1) {
  if (!canvas || !filterId || filterId === 'none' || intensity <= 0.001) {
    return canvas;
  }

  const w = canvas.width;
  const h = canvas.height;
  const out = cloneCanvas(canvas);
  const ctx = out.getContext('2d');
  const imgData = ctx.getImageData(0, 0, w, h);
  const src = new Uint8ClampedArray(imgData.data);
  const dst = imgData.data;
  const mix = Math.max(0, Math.min(1, intensity));

  // Precompute optional blur buffer for filters that benefit from softness/oil/bloom
  let softBuf = null;
  if (filterId === 'ps2' || filterId === 'oil_poster') {
    softBuf = boxBlur(src, w, h, filterId === 'oil_poster' ? 2 : 1);
  }

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const idx = (y * w + x) * 4;
      const a = src[idx + 3];
      if (a === 0) continue;

      const r = src[idx];
      const g = src[idx + 1];
      const b = src[idx + 2];
      let nr = r;
      let ng = g;
      let nb = b;

      switch (filterId) {
        case 'ps1': {
          // 15-bit RGB555 quantization + Bayer 4x4 ordered dither + subtle affine texel snap
          const sx = (x >> 1) << 1;
          const sy = (y >> 1) << 1;
          const sIdx = (sy * w + sx) * 4;
          const dither = (BAYER_4X4[y & 3][x & 3] / 16 - 0.5) * 14;
          nr = Math.round(clamp255(src[sIdx] + dither) / 8) * 8;
          ng = Math.round(clamp255(src[sIdx + 1] + dither) / 8) * 8;
          nb = Math.round(clamp255(src[sIdx + 2] + dither) / 8) * 8;
          break;
        }
        case 'ps2': {
          // Warm broadcast soft bloom + interlace field line darkening
          const br = softBuf[idx];
          const bg = softBuf[idx + 1];
          const bb = softBuf[idx + 2];
          const hl = Math.max(0, (luma(br, bg, bb) - 140) / 115);
          const scan = (y & 1) === 0 ? 1.04 : 0.88;
          nr = clamp255((r * 0.85 + br * 0.25 + hl * 36) * 1.03 * scan);
          ng = clamp255((g * 0.85 + bg * 0.22 + hl * 30) * 1.0 * scan);
          nb = clamp255((b * 0.82 + bb * 0.2 + hl * 22) * 0.94 * scan);
          break;
        }
        case 'retro_crt': {
          const scan = (y % 3 === 0) ? 0.68 : 1.08;
          const sub = x % 3;
          const mr = sub === 0 ? 1.18 : 0.88;
          const mg = sub === 1 ? 1.18 : 0.88;
          const mb = sub === 2 ? 1.18 : 0.88;
          const nx = (x / Math.max(1, w)) * 2 - 1;
          const ny = (y / Math.max(1, h)) * 2 - 1;
          const vig = Math.max(0.55, 1 - (nx * nx + ny * ny) * 0.28);
          nr = clamp255(r * scan * mr * vig);
          ng = clamp255(g * scan * mg * vig);
          nb = clamp255(b * scan * mb * vig);
          break;
        }
        case 'vhs': {
          const band = Math.sin(y * 0.14) * 2.5 + (hash2(0, y, 71) > 0.96 ? 6 : 0);
          const rx = Math.max(0, Math.min(w - 1, Math.round(x - 3 + band)));
          const bx = Math.max(0, Math.min(w - 1, Math.round(x + 3 + band)));
          const rIdx = (y * w + rx) * 4;
          const bIdx = (y * w + bx) * 4;
          const noise = (hash2(x, y, 91) - 0.5) * 26;
          const track = (y % 7 === 0) ? 0.9 : 1.02;
          nr = clamp255((src[rIdx] * 1.06 + noise) * track);
          ng = clamp255((g * 0.98 + noise) * track);
          nb = clamp255((src[bIdx + 2] * 1.05 + noise) * track);
          break;
        }
        case 'gameboy': {
          const sx = (x >> 1) << 1;
          const sy = (y >> 1) << 1;
          const sIdx = (sy * w + sx) * 4;
          const lum = luma(src[sIdx], src[sIdx + 1], src[sIdx + 2]) / 255;
          const d = (BAYER_4X4[y & 3][x & 3] / 16 - 0.5) * 0.12;
          const q = Math.max(0, Math.min(3, Math.round((lum + d) * 3)));
          const grid = (x % 2 === 0 && y % 2 === 0) ? 1.0 : 0.92;
          nr = clamp255(DMG_PALETTE[q][0] * grid);
          ng = clamp255(DMG_PALETTE[q][1] * grid);
          nb = clamp255(DMG_PALETTE[q][2] * grid);
          break;
        }
        case 'nes': {
          const sx = (x >> 1) << 1;
          const sy = (y >> 1) << 1;
          const sIdx = (sy * w + sx) * 4;
          nr = Math.round(src[sIdx] / 64) * 64;
          ng = Math.round(src[sIdx + 1] / 64) * 64;
          nb = Math.round(src[sIdx + 2] / 85) * 85;
          break;
        }
        case 'arcade_scan': {
          const scan = (y & 1) === 0 ? 1.16 : 0.72;
          const cr = clamp255((r - 128) * 1.28 + 128);
          const cg = clamp255((g - 128) * 1.28 + 128);
          const cb = clamp255((b - 128) * 1.28 + 128);
          nr = clamp255(cr * scan);
          ng = clamp255(cg * scan);
          nb = clamp255(cb * scan);
          break;
        }
        case 'dither_bayer': {
          const bVal = (BAYER_4X4[y & 3][x & 3] / 16 - 0.5) * 64;
          nr = Math.round(clamp255(r + bVal) / 85) * 85;
          ng = Math.round(clamp255(g + bVal) / 85) * 85;
          nb = Math.round(clamp255(b + bVal) / 85) * 85;
          break;
        }
        case 'halftone': {
          const cell = 6;
          const cx = Math.floor(x / cell) * cell + cell / 2;
          const cy = Math.floor(y / cell) * cell + cell / 2;
          const cIdx = (Math.min(h - 1, Math.floor(cy)) * w + Math.min(w - 1, Math.floor(cx))) * 4;
          const lum = luma(src[cIdx], src[cIdx + 1], src[cIdx + 2]) / 255;
          const dist = Math.hypot(x - cx, y - cy) / (cell * 0.72);
          const dot = dist < (1 - lum) ? 0.2 : 1.05;
          nr = clamp255(src[cIdx] * dot);
          ng = clamp255(src[cIdx + 1] * dot);
          nb = clamp255(src[cIdx + 2] * dot);
          break;
        }
        case 'cel_toon': {
          const edge = computeSobelEdge(src, w, h, x, y);
          const bands = 4;
          const qr = Math.round((r / 255) * bands) * (255 / bands);
          const qg = Math.round((g / 255) * bands) * (255 / bands);
          const qb = Math.round((b / 255) * bands) * (255 / bands);
          const ink = edge > 95 ? 0.18 : 1.0;
          nr = clamp255(qr * ink);
          ng = clamp255(qg * ink);
          nb = clamp255(qb * ink);
          break;
        }
        case 'comic_ink': {
          const edge = computeSobelEdge(src, w, h, x, y);
          const lum = luma(r, g, b);
          if (edge > 78 || lum < 36) {
            nr = 16;
            ng = 16;
            nb = 22;
          } else {
            const satBoost = 1.25;
            const qr = Math.round((r / 255) * 3) * 85;
            const qg = Math.round((g / 255) * 3) * 85;
            const qb = Math.round((b / 255) * 3) * 85;
            const avg = (qr + qg + qb) / 3;
            nr = clamp255(avg + (qr - avg) * satBoost);
            ng = clamp255(avg + (qg - avg) * satBoost);
            nb = clamp255(avg + (qb - avg) * satBoost);
          }
          break;
        }
        case 'outline_glow': {
          const edge = computeSobelEdge(src, w, h, x, y);
          const glow = Math.min(1, edge / 110);
          nr = clamp255(r * 0.14 + (r * 0.6 + 80) * glow);
          ng = clamp255(g * 0.14 + (g * 0.6 + 190) * glow);
          nb = clamp255(b * 0.2 + 255 * glow);
          break;
        }
        case 'emboss': {
          const tlIdx = (Math.max(0, y - 1) * w + Math.max(0, x - 1)) * 4;
          const brIdx = (Math.min(h - 1, y + 1) * w + Math.min(w - 1, x + 1)) * 4;
          const dl =
            luma(src[brIdx], src[brIdx + 1], src[brIdx + 2]) -
            luma(src[tlIdx], src[tlIdx + 1], src[tlIdx + 2]);
          const val = clamp255(128 + dl * 1.45);
          nr = clamp255(val * 0.72 + r * 0.28);
          ng = clamp255(val * 0.72 + g * 0.28);
          nb = clamp255(val * 0.72 + b * 0.28);
          break;
        }
        case 'thermal': {
          const t = Math.max(0, Math.min(1, luma(r, g, b) / 255));
          const [tr, tg, tb] = thermalRamp(t);
          nr = tr;
          ng = tg;
          nb = tb;
          break;
        }
        case 'night_vision': {
          const lum = luma(r, g, b);
          const noise = (hash2(x, y, 421) - 0.5) * 32;
          const nx = (x / Math.max(1, w)) * 2 - 1;
          const ny = (y / Math.max(1, h)) * 2 - 1;
          const vig = Math.max(0.25, 1 - (nx * nx + ny * ny) * 0.48);
          const amp = clamp255((lum * 1.35 + noise) * vig);
          nr = clamp255(amp * 0.22);
          ng = clamp255(amp * 1.15);
          nb = clamp255(amp * 0.34);
          break;
        }
        case 'blueprint': {
          const edge = computeSobelEdge(src, w, h, x, y) / 255;
          const grid = x % 16 === 0 || y % 16 === 0 ? 0.14 : 0;
          const lum = luma(r, g, b) / 255;
          const ink = Math.min(1, edge * 1.4 + grid + lum * 0.18);
          nr = mixChannel(12, 224, ink);
          ng = mixChannel(48, 242, ink);
          nb = mixChannel(122, 255, ink);
          break;
        }
        case 'sepia_vintage': {
          const grain = (hash2(x, y, 777) - 0.5) * 18;
          nr = clamp255(r * 0.393 + g * 0.769 + b * 0.189 + grain);
          ng = clamp255(r * 0.349 + g * 0.686 + b * 0.168 + grain);
          nb = clamp255(r * 0.272 + g * 0.534 + b * 0.131 + grain);
          break;
        }
        case 'cyber_duotone': {
          const t = Math.max(0, Math.min(1, (luma(r, g, b) - 20) / 215));
          nr = mixChannel(14, 244, t);
          ng = mixChannel(182, 58, t);
          nb = mixChannel(212, 198, t);
          break;
        }
        case 'glitch_rgb': {
          const band = Math.floor(y / 10);
          const shift = hash2(band, 1, 909) > 0.72 ? Math.round((hash2(band, 2, 909) - 0.5) * 18) : 0;
          const rx = Math.max(0, Math.min(w - 1, x + shift + 3));
          const gx = Math.max(0, Math.min(w - 1, x + shift));
          const bx = Math.max(0, Math.min(w - 1, x + shift - 3));
          nr = src[(y * w + rx) * 4];
          ng = src[(y * w + gx) * 4 + 1];
          nb = src[(y * w + bx) * 4 + 2];
          break;
        }
        case 'oil_poster': {
          const br = softBuf[idx];
          const bg = softBuf[idx + 1];
          const bb = softBuf[idx + 2];
          nr = Math.round(br / 36) * 36;
          ng = Math.round(bg / 36) * 36;
          nb = Math.round(bb / 36) * 36;
          break;
        }
        default:
          break;
      }

      dst[idx] = mixChannel(r, nr, mix);
      dst[idx + 1] = mixChannel(g, ng, mix);
      dst[idx + 2] = mixChannel(b, nb, mix);
      dst[idx + 3] = a;
    }
  }

  ctx.putImageData(imgData, 0, 0);
  return out;
}

export function hasActivePostFx(post) {
  if (!post || !post.enabled) return false;
  return (
    (post.sharpness || 0) > 0 ||
    (post.bloom || 0) > 0 ||
    Math.abs(post.exposure || 0) > 0 ||
    Math.abs(post.contrast || 0) > 0 ||
    Math.abs(post.saturation || 0) > 0 ||
    Math.abs((post.gamma ?? 1) - 1) > 0.01 ||
    (post.chromaticAberration || 0) > 0 ||
    (post.vignette || 0) > 0 ||
    (post.grain || 0) > 0 ||
    (post.edgeSoften || 0) > 0
  );
}

/**
 * Applies the full Post-Processing Stack (Sharpness, Edge Soften, Bloom, Chromatic Aberration, Exposure, Contrast, Saturation, Gamma, Vignette, Film Grain)
 */
export function applyPostProcessingStack(canvas, post) {
  if (!canvas || !hasActivePostFx(post)) return canvas;

  const w = canvas.width;
  const h = canvas.height;
  const out = cloneCanvas(canvas);
  const ctx = out.getContext('2d');
  const imgData = ctx.getImageData(0, 0, w, h);
  let src = new Uint8ClampedArray(imgData.data);
  const dst = imgData.data;

  // 1. Optional Edge Soften (FXAA-style mild spatial pre-pass)
  const softenAmt = Math.max(0, Math.min(1, (post.edgeSoften || 0) / 100));
  let softenBuf = softenAmt > 0.01 ? boxBlur(src, w, h, 1) : null;

  // 2. Optional Bloom buffer
  const bloomAmt = Math.max(0, Math.min(1, (post.bloom || 0) / 100));
  let bloomBuf = null;
  if (bloomAmt > 0.01) {
    const bright = new Uint8ClampedArray(src.length);
    for (let i = 0; i < src.length; i += 4) {
      const a = src[i + 3];
      if (!a) continue;
      const lum = luma(src[i], src[i + 1], src[i + 2]);
      const k = Math.max(0, (lum - 155) / 100);
      bright[i] = src[i] * k;
      bright[i + 1] = src[i + 1] * k;
      bright[i + 2] = src[i + 2] * k;
      bright[i + 3] = a;
    }
    bloomBuf = boxBlur(bright, w, h, 3);
  }

  // 3. Color / Tone parameters
  const sharpAmt = Math.max(0, Math.min(2, (post.sharpness || 0) / 45));
  const expMul = Math.pow(2, (post.exposure || 0) / 55);
  const conFactor = 1 + (post.contrast || 0) / 100;
  const satFactor = 1 + (post.saturation || 0) / 100;
  const invGamma = 1 / Math.max(0.25, post.gamma ?? 1);
  const caPx = Math.max(0, post.chromaticAberration || 0);
  const vigAmt = Math.max(0, Math.min(1, (post.vignette || 0) / 100));
  const grainAmt = Math.max(0, Math.min(1, (post.grain || 0) / 100));

  for (let y = 0; y < h; y++) {
    const ny = (y / Math.max(1, h)) * 2 - 1;
    for (let x = 0; x < w; x++) {
      const idx = (y * w + x) * 4;
      const a = src[idx + 3];
      if (a === 0) continue;

      const nx = (x / Math.max(1, w)) * 2 - 1;
      const rad2 = nx * nx + ny * ny;

      let r = src[idx];
      let g = src[idx + 1];
      let b = src[idx + 2];

      // Chromatic Aberration (radial R/B channel shift)
      if (caPx > 0.1) {
        const shiftX = nx * caPx;
        const shiftY = ny * caPx;
        const rx = Math.max(0, Math.min(w - 1, Math.round(x + shiftX)));
        const ry = Math.max(0, Math.min(h - 1, Math.round(y + shiftY)));
        const bx = Math.max(0, Math.min(w - 1, Math.round(x - shiftX)));
        const by = Math.max(0, Math.min(h - 1, Math.round(y - shiftY)));
        r = src[(ry * w + rx) * 4];
        b = src[(by * w + bx) * 4 + 2];
      }

      // Edge Soften blend
      if (softenBuf) {
        r = r + (softenBuf[idx] - r) * softenAmt * 0.65;
        g = g + (softenBuf[idx + 1] - g) * softenAmt * 0.65;
        b = b + (softenBuf[idx + 2] - b) * softenAmt * 0.65;
      }

      // Sharpness (3x3 Unsharp Mask Laplacian)
      if (sharpAmt > 0.01) {
        const lIdx = (y * w + Math.max(0, x - 1)) * 4;
        const rIdx = (y * w + Math.min(w - 1, x + 1)) * 4;
        const tIdx = (Math.max(0, y - 1) * w + x) * 4;
        const bIdx = (Math.min(h - 1, y + 1) * w + x) * 4;
        const avgR = (src[lIdx] + src[rIdx] + src[tIdx] + src[bIdx]) * 0.25;
        const avgG = (src[lIdx + 1] + src[rIdx + 1] + src[tIdx + 1] + src[bIdx + 1]) * 0.25;
        const avgB = (src[lIdx + 2] + src[rIdx + 2] + src[tIdx + 2] + src[bIdx + 2]) * 0.25;
        r += (r - avgR) * sharpAmt;
        g += (g - avgG) * sharpAmt;
        b += (b - avgB) * sharpAmt;
      }

      // Bloom additive highlight
      if (bloomBuf) {
        r += bloomBuf[idx] * bloomAmt * 1.4;
        g += bloomBuf[idx + 1] * bloomAmt * 1.4;
        b += bloomBuf[idx + 2] * bloomAmt * 1.4;
      }

      // Exposure
      if (Math.abs(expMul - 1) > 0.005) {
        r *= expMul;
        g *= expMul;
        b *= expMul;
      }

      // Contrast
      if (Math.abs(conFactor - 1) > 0.005) {
        r = (r - 128) * conFactor + 128;
        g = (g - 128) * conFactor + 128;
        b = (b - 128) * conFactor + 128;
      }

      // Saturation
      if (Math.abs(satFactor - 1) > 0.005) {
        const lum = luma(r, g, b);
        r = lum + (r - lum) * satFactor;
        g = lum + (g - lum) * satFactor;
        b = lum + (b - lum) * satFactor;
      }

      // Gamma
      if (Math.abs(invGamma - 1) > 0.005) {
        r = Math.pow(Math.max(0, r / 255), invGamma) * 255;
        g = Math.pow(Math.max(0, g / 255), invGamma) * 255;
        b = Math.pow(Math.max(0, b / 255), invGamma) * 255;
      }

      // Vignette
      if (vigAmt > 0.005) {
        const vFactor = Math.max(0, 1 - rad2 * vigAmt * 0.62);
        r *= vFactor;
        g *= vFactor;
        b *= vFactor;
      }

      // Film Grain
      if (grainAmt > 0.005) {
        const n = (hash2(x, y, 503) - 0.5) * grainAmt * 48;
        r += n;
        g += n;
        b += n;
      }

      dst[idx] = clamp255(r);
      dst[idx + 1] = clamp255(g);
      dst[idx + 2] = clamp255(b);
      dst[idx + 3] = a;
    }
  }

  ctx.putImageData(imgData, 0, 0);
  return out;
}

/**
 * Shared helper that applies a Ripper's Overlay Filter + Per-Texture Post-Processing Stack onto a canvas.
 */
export function applyRipperFxToCanvas(canvas, fxCfg) {
  if (!canvas || !fxCfg) return canvas;
  let result = canvas;
  if (fxCfg.filter && fxCfg.filter !== 'none' && (fxCfg.filterIntensity ?? 1) > 0.001) {
    result = applyOverlayFilterToCanvas(result, fxCfg.filter, fxCfg.filterIntensity ?? 1);
  }
  if (fxCfg.post && fxCfg.post.enabled) {
    result = applyPostProcessingStack(result, fxCfg.post);
  }
  return result;
}
