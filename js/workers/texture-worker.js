// Web Worker for non-blocking texture extraction, perspective warp, seamless synthesis, detail restoration, and pixel-art quantization
import { computeRectToQuadHomography, computePolygonBounds, pointInPolygon } from '../canvas/perspective-engine.js';
import { applySeamlessAlgorithm } from '../texture/seamless-engine.js';
import { applyColorAndLighting, applyPixelArtQuantization } from '../texture/color-correction.js';
import { applyDetailRestoration } from '../texture/detail-restoration.js';

const cancelledJobs = new Set();

function sampleBilinear(src, sw, sh, x, y) {
  const cx = Math.max(0, Math.min(sw - 1.001, x));
  const cy = Math.max(0, Math.min(sh - 1.001, y));
  const x0 = Math.floor(cx);
  const y0 = Math.floor(cy);
  const x1 = Math.min(sw - 1, x0 + 1);
  const y1 = Math.min(sh - 1, y0 + 1);
  const fx = cx - x0;
  const fy = cy - y0;

  const i00 = (y0 * sw + x0) * 4;
  const i10 = (y0 * sw + x1) * 4;
  const i01 = (y1 * sw + x0) * 4;
  const i11 = (y1 * sw + x1) * 4;

  const w00 = (1 - fx) * (1 - fy);
  const w10 = fx * (1 - fy);
  const w01 = (1 - fx) * fy;
  const w11 = fx * fy;

  return [
    Math.round(src[i00] * w00 + src[i10] * w10 + src[i01] * w01 + src[i11] * w11),
    Math.round(src[i00 + 1] * w00 + src[i10 + 1] * w10 + src[i01 + 1] * w01 + src[i11 + 1] * w11),
    Math.round(src[i00 + 2] * w00 + src[i10 + 2] * w10 + src[i01 + 2] * w01 + src[i11 + 2] * w11),
    Math.round(src[i00 + 3] * w00 + src[i10 + 3] * w10 + src[i01 + 3] * w01 + src[i11 + 3] * w11),
  ];
}

function sampleNearest(src, sw, sh, x, y) {
  const ix = Math.max(0, Math.min(sw - 1, Math.round(x)));
  const iy = Math.max(0, Math.min(sh - 1, Math.round(y)));
  const i = (iy * sw + ix) * 4;
  return [src[i], src[i + 1], src[i + 2], src[i + 3]];
}

function extractMaskedOriginal(srcData, sw, sh, points, fillOutside) {
  const bounds = computePolygonBounds(points);
  const minX = Math.max(0, Math.floor(bounds.minX));
  const minY = Math.max(0, Math.floor(bounds.minY));
  const maxX = Math.min(sw, Math.ceil(bounds.maxX));
  const maxY = Math.min(sh, Math.ceil(bounds.maxY));
  const ow = Math.max(1, maxX - minX);
  const oh = Math.max(1, maxY - minY);
  const out = new Uint8ClampedArray(ow * oh * 4);

  // Average color inside polygon for optional outside edge fill
  let avgR = 0, avgG = 0, avgB = 0, cnt = 0;
  for (let y = 0; y < oh; y++) {
    const sy = minY + y;
    for (let x = 0; x < ow; x++) {
      const sx = minX + x;
      const oIdx = (y * ow + x) * 4;
      const sIdx = (sy * sw + sx) * 4;
      if (pointInPolygon(sx + 0.5, sy + 0.5, points)) {
        out[oIdx] = srcData[sIdx];
        out[oIdx + 1] = srcData[sIdx + 1];
        out[oIdx + 2] = srcData[sIdx + 2];
        out[oIdx + 3] = srcData[sIdx + 3];
        avgR += srcData[sIdx];
        avgG += srcData[sIdx + 1];
        avgB += srcData[sIdx + 2];
        cnt++;
      } else {
        out[oIdx + 3] = 0;
      }
    }
  }

  if (fillOutside && cnt > 0) {
    const mr = Math.round(avgR / cnt);
    const mg = Math.round(avgG / cnt);
    const mb = Math.round(avgB / cnt);
    // Simple radial fill from nearest inside pixel on row/col or mean fallback
    for (let y = 0; y < oh; y++) {
      let lastR = mr, lastG = mg, lastB = mb;
      for (let x = 0; x < ow; x++) {
        const idx = (y * ow + x) * 4;
        if (out[idx + 3] > 0) {
          lastR = out[idx];
          lastG = out[idx + 1];
          lastB = out[idx + 2];
        } else {
          out[idx] = lastR;
          out[idx + 1] = lastG;
          out[idx + 2] = lastB;
          out[idx + 3] = 255;
        }
      }
    }
  }

  return { data: out, width: ow, height: oh };
}

function extractPerspective(srcData, sw, sh, points, outW, outH, resampling, maskFill) {
  // If 4 points, compute exact projective homography
  if (points.length === 4) {
    const H = computeRectToQuadHomography(outW, outH, points);
    if (H) {
      const out = new Uint8ClampedArray(outW * outH * 4);
      const sampler = resampling === 'nearest' ? sampleNearest : sampleBilinear;
      for (let y = 0; y < outH; y++) {
        for (let x = 0; x < outW; x++) {
          const denom = H[6] * x + H[7] * y + H[8];
          const sx = (H[0] * x + H[1] * y + H[2]) / denom;
          const sy = (H[3] * x + H[4] * y + H[5]) / denom;
          const [r, g, b, a] = sampler(srcData, sw, sh, sx, sy);
          const idx = (y * outW + x) * 4;
          out[idx] = r;
          out[idx + 1] = g;
          out[idx + 2] = b;
          out[idx + 3] = a;
        }
      }
      return { data: out, width: outW, height: outH };
    }
  }

  // Fallback for irregular N-polygons: resample masked bounding box to outW x outH
  const masked = extractMaskedOriginal(srcData, sw, sh, points, maskFill);
  const out = new Uint8ClampedArray(outW * outH * 4);
  const sampler = resampling === 'nearest' ? sampleNearest : sampleBilinear;
  for (let y = 0; y < outH; y++) {
    const sy = (y / Math.max(1, outH)) * masked.height;
    for (let x = 0; x < outW; x++) {
      const sx = (x / Math.max(1, outW)) * masked.width;
      const [r, g, b, a] = sampler(masked.data, masked.width, masked.height, sx, sy);
      const idx = (y * outW + x) * 4;
      out[idx] = r;
      out[idx + 1] = g;
      out[idx + 2] = b;
      out[idx + 3] = a;
    }
  }
  return { data: out, width: outW, height: outH };
}

self.onmessage = (e) => {
  const msg = e.data;
  if (!msg) return;

  if (msg.type === 'cancel') {
    cancelledJobs.add(msg.jobId);
    return;
  }

  if (msg.type !== 'process') return;
  const { jobId, ripperId, sourceWidth, sourceHeight, sourceBuffer, config } = msg;

  const isCancelled = () => {
    if (cancelledJobs.has(jobId)) {
      cancelledJobs.delete(jobId);
      return true;
    }
    return false;
  };

  try {
    const srcData = new Uint8ClampedArray(sourceBuffer);
    const { points, extraction, seamless, detail, color, pixelArt, clonePatches } = config;

    self.postMessage({ type: 'progress', jobId, ripperId, progress: 15, stageLabel: 'Extracting selection' });
    const origStage = extractMaskedOriginal(srcData, sourceWidth, sourceHeight, points, false);
    if (isCancelled()) return;

    self.postMessage({ type: 'progress', jobId, ripperId, progress: 38, stageLabel: 'Perspective transform' });
    const outW = Math.max(8, Math.min(2048, Math.round(extraction.outWidth || origStage.width)));
    const outH = Math.max(8, Math.min(2048, Math.round(extraction.outHeight || origStage.height)));
    const resampling = pixelArt?.enabled ? 'nearest' : (extraction.resampling || 'bilinear');

    let perspStage;
    if (extraction.mode === 'mask' && points.length !== 4) {
      perspStage = extractPerspective(srcData, sourceWidth, sourceHeight, points, outW, outH, resampling, extraction.maskFill);
    } else if (extraction.mode === 'perspective' || points.length === 4) {
      perspStage = extractPerspective(srcData, sourceWidth, sourceHeight, points, outW, outH, resampling, extraction.maskFill);
    } else {
      perspStage = extractPerspective(srcData, sourceWidth, sourceHeight, points, outW, outH, resampling, extraction.maskFill);
    }
    if (isCancelled()) return;

    self.postMessage({ type: 'progress', jobId, ripperId, progress: 65, stageLabel: 'Seamless synthesis' });
    const seamlessPixels = applySeamlessAlgorithm(perspStage.data, outW, outH, seamless, clonePatches || []);
    if (isCancelled()) return;

    self.postMessage({ type: 'progress', jobId, ripperId, progress: 85, stageLabel: 'Detail & color pass' });
    let finalPixels = applyColorAndLighting(seamlessPixels, outW, outH, color || {});
    finalPixels = applyDetailRestoration(finalPixels, perspStage.data, outW, outH, detail || {});
    if (pixelArt?.enabled) {
      finalPixels = applyPixelArtQuantization(finalPixels, outW, outH, pixelArt);
    }
    if (isCancelled()) return;

    self.postMessage({ type: 'progress', jobId, ripperId, progress: 100, stageLabel: 'Complete' });

    const origBuf = origStage.data.buffer;
    const perspBuf = perspStage.data.buffer;
    const seamBuf = seamlessPixels.buffer;
    const finalBuf = finalPixels.buffer;

    self.postMessage(
      {
        type: 'result',
        jobId,
        ripperId,
        stages: {
          original: { width: origStage.width, height: origStage.height, buffer: origBuf },
          perspective: { width: outW, height: outH, buffer: perspBuf },
          seamless: { width: outW, height: outH, buffer: seamBuf },
          final: { width: outW, height: outH, buffer: finalBuf },
        },
      },
      [origBuf, perspBuf, seamBuf, finalBuf]
    );
  } catch (err) {
    self.postMessage({
      type: 'error',
      jobId,
      ripperId,
      message: err?.message || 'Texture processing error',
    });
  }
};
