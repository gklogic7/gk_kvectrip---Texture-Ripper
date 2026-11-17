// Independent Texture Ripper model factory
import { state } from '../core/app-state.js';
import { computeNaturalQuadSize } from '../canvas/perspective-engine.js';

let ripperCounter = 1;

export function createTextureRipper({ sourceImageId, points, name = null, category = 'Other' }) {
  const natural = computeNaturalQuadSize(points);
  // Clamp default size sensibly while preserving aspect
  let outW = natural.width;
  let outH = natural.height;
  const maxDim = Math.max(outW, outH);
  if (maxDim > 512) {
    const s = 512 / maxDim;
    outW = Math.max(16, Math.round(outW * s));
    outH = Math.max(16, Math.round(outH * s));
  }

  const id = `rip_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  const ripperName = name || `Texture_${String(ripperCounter++).padStart(2, '0')}`;

  return {
    id,
    name: ripperName,
    sourceImageId,
    category,
    favorite: false,
    enabled: true,
    createdAt: Date.now(),
    points: points.map((p) => ({ x: p.x, y: p.y })),
    style: { ...state.defaultStyle },
    extraction: {
      mode: points.length === 4 ? 'perspective' : 'mask',
      outWidth: outW,
      outHeight: outH,
      lockAspect: true,
      aspectRatio: outW / Math.max(1, outH),
      resampling: 'bilinear', // 'bilinear' | 'nearest'
      maskFill: true,
    },
    seamless: {
      enabled: true,
      method: 'collage', // 'collage' | 'scattered' | 'offset' | 'mirror' | 'clone'
      seamBlending: 60,
      blendWidth: 25,
      edgeSmoothing: 35,
      randomization: 50,
      blendStrength: 85,
      offsetX: 0,
      offsetY: 0,
      seed: Math.floor(Math.random() * 9999) + 1,
    },
    detail: {
      strength: 45,
      sharpness: 20,
      edgePreserve: 50,
      grain: 25,
      noiseReduce: 0,
      localContrast: 15,
    },
    color: {
      contrast: 0,
      lighting: 0,
      balanceR: 0,
      balanceG: 0,
      balanceB: 0,
    },
    pixelArt: {
      enabled: false,
      paletteCount: 16,
      dither: 'none', // 'none' | 'bayer' | 'floyd'
    },
    clonePatches: [],
    cachedStages: {
      original: null, // HTMLCanvasElement
      perspective: null,
      seamless: null,
      final: null,
      thumbnailUrl: '',
    },
  };
}

export function resetRipperSeamlessDefaults(ripper) {
  ripper.seamless = {
    enabled: true,
    method: ripper.seamless.method || 'collage',
    seamBlending: 60,
    blendWidth: 25,
    edgeSmoothing: 35,
    randomization: 50,
    blendStrength: 85,
    offsetX: 0,
    offsetY: 0,
    seed: 42,
  };
  ripper.detail = {
    strength: 45,
    sharpness: 20,
    edgePreserve: 50,
    grain: 25,
    noiseReduce: 0,
    localContrast: 15,
  };
  ripper.color = {
    contrast: 0,
    lighting: 0,
    balanceR: 0,
    balanceG: 0,
    balanceB: 0,
  };
}
