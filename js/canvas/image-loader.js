// Local file system inputs (File System Access API + input fallback), strict validation, and ImageBitmap memory management
import { state, setActiveImage } from '../core/app-state.js';
import { events } from '../core/event-manager.js';
import { history } from '../core/history-manager.js';

export const MAX_SAFE_IMAGE_EDGE = 4096;

const SUPPORTED_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/jpg',
  'image/webp',
  'image/bmp',
  'image/x-ms-bmp',
  'image/gif',
]);

const SUPPORTED_EXT_RE = /\.(png|jpe?g|webp|bmp|gif)$/i;

// Track active ImageBitmaps for explicit GPU memory release
const activeBitmapRegistry = new Set();

export function isSupportedImageFile(file) {
  if (!file) return false;
  if (file.type && SUPPORTED_TYPES.has(file.type.toLowerCase())) return true;
  if (file.name && SUPPORTED_EXT_RE.test(file.name)) return true;
  return false;
}

function loadImageElement(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Unsupported or corrupted image file.'));
    img.src = src;
  });
}

function drawSourceToSafeCanvas(source, naturalW, naturalH) {
  const maxDim = Math.max(naturalW, naturalH);
  let targetW = naturalW;
  let targetH = naturalH;
  let downscaled = false;

  if (maxDim > MAX_SAFE_IMAGE_EDGE) {
    const scale = MAX_SAFE_IMAGE_EDGE / maxDim;
    targetW = Math.max(1, Math.round(naturalW * scale));
    targetH = Math.max(1, Math.round(naturalH * scale));
    downscaled = true;
  }

  const offscreen = document.createElement('canvas');
  offscreen.width = targetW;
  offscreen.height = targetH;
  const ctx = offscreen.getContext('2d', { willReadFrequently: true });
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(source, 0, 0, targetW, targetH);

  return { offscreen, width: targetW, height: targetH, downscaled };
}

function releaseImageResources(img) {
  if (!img) return;
  if (img.bitmap && typeof img.bitmap.close === 'function') {
    img.bitmap.close();
    activeBitmapRegistry.delete(img.bitmap);
    img.bitmap = null;
  }
  img._effectiveCache = null;
  img.offscreenCanvas = null;
}

export async function createSourceImageFromBlob(blob, name, mimeType = 'image/png', existingId = null) {
  let decodedBitmap = null;
  let htmlImg = null;
  let objectUrl = null;
  let naturalW = 0;
  let naturalH = 0;

  try {
    if (typeof createImageBitmap === 'function') {
      decodedBitmap = await createImageBitmap(blob);
      naturalW = decodedBitmap.width;
      naturalH = decodedBitmap.height;
    } else {
      objectUrl = URL.createObjectURL(blob);
      htmlImg = await loadImageElement(objectUrl);
      naturalW = htmlImg.naturalWidth || htmlImg.width;
      naturalH = htmlImg.naturalHeight || htmlImg.height;
    }

    if (!naturalW || !naturalH) {
      throw new Error(`Image "${name}" has invalid zero dimensions.`);
    }

    const { offscreen, width, height, downscaled } = drawSourceToSafeCanvas(
      decodedBitmap || htmlImg,
      naturalW,
      naturalH
    );

    // Retain an accurately sized ImageBitmap for fast GPU blitting if supported, closing oversized decode
    let managedBitmap = null;
    if (typeof createImageBitmap === 'function') {
      if (!downscaled && decodedBitmap) {
        managedBitmap = decodedBitmap;
        decodedBitmap = null; // transfer ownership
      } else {
        managedBitmap = await createImageBitmap(offscreen);
      }
      activeBitmapRegistry.add(managedBitmap);
    }

    const safeMime =
      mimeType && mimeType.startsWith('image/') && mimeType !== 'image/gif' && mimeType !== 'image/bmp'
        ? mimeType
        : 'image/png';
    const dataUrl = offscreen.toDataURL(safeMime, 0.94);

    return {
      id: existingId || `img_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      name,
      width,
      height,
      originalWidth: naturalW,
      originalHeight: naturalH,
      downscaled,
      mimeType: mimeType || 'image/png',
      dataUrl,
      bitmap: managedBitmap,
      offscreenCanvas: offscreen,
      rotation: 0,
      cropRect: null,
      _effectiveCache: null,
      _effectiveKey: '',
    };
  } finally {
    if (decodedBitmap && typeof decodedBitmap.close === 'function') {
      decodedBitmap.close();
    }
    if (objectUrl) {
      URL.revokeObjectURL(objectUrl);
    }
  }
}

export async function createSourceImageFromDataUrl(dataUrl, name, mimeType = 'image/png', existingId = null) {
  const htmlImg = await loadImageElement(dataUrl);
  const naturalW = htmlImg.naturalWidth || htmlImg.width;
  const naturalH = htmlImg.naturalHeight || htmlImg.height;
  if (!naturalW || !naturalH) {
    throw new Error(`Image "${name}" has invalid zero dimensions.`);
  }

  const { offscreen, width, height, downscaled } = drawSourceToSafeCanvas(htmlImg, naturalW, naturalH);
  let managedBitmap = null;
  if (typeof createImageBitmap === 'function') {
    managedBitmap = await createImageBitmap(offscreen);
    activeBitmapRegistry.add(managedBitmap);
  }

  return {
    id: existingId || `img_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    name,
    width,
    height,
    originalWidth: naturalW,
    originalHeight: naturalH,
    downscaled,
    mimeType,
    dataUrl: downscaled ? offscreen.toDataURL('image/png') : dataUrl,
    bitmap: managedBitmap,
    offscreenCanvas: offscreen,
    rotation: 0,
    cropRect: null,
    _effectiveCache: null,
    _effectiveKey: '',
  };
}

export async function openLocalImagesPicker(options = {}) {
  const multiple = !options.replaceImageId;
  if (typeof window.showOpenFilePicker === 'function') {
    try {
      const handles = await window.showOpenFilePicker({
        multiple,
        types: [
          {
            description: 'Reference Images (PNG, JPG, WebP, BMP, GIF)',
            accept: {
              'image/png': ['.png'],
              'image/jpeg': ['.jpg', '.jpeg'],
              'image/webp': ['.webp'],
              'image/bmp': ['.bmp'],
              'image/gif': ['.gif'],
            },
          },
        ],
      });
      const files = await Promise.all(handles.map((h) => h.getFile()));
      return await importImageFiles(files, options);
    } catch (err) {
      if (err && err.name === 'AbortError') return [];
      // Cross-origin iframe or unsupported restriction -> fall through to file input
    }
  }

  const inputId = options.replaceImageId ? 'file-input-replace' : 'file-input-images';
  document.getElementById(inputId)?.click();
  return [];
}

export function getEffectiveDimensions(img) {
  if (!img) return { width: 0, height: 0 };
  const rad = ((img.rotation || 0) * Math.PI) / 180;
  const cos = Math.abs(Math.cos(rad));
  const sin = Math.abs(Math.sin(rad));
  const rotW = Math.max(1, Math.round(img.width * cos + img.height * sin));
  const rotH = Math.max(1, Math.round(img.width * sin + img.height * cos));
  if (img.cropRect) {
    return {
      width: Math.max(1, Math.round(img.cropRect.w)),
      height: Math.max(1, Math.round(img.cropRect.h)),
      rotatedWidth: rotW,
      rotatedHeight: rotH,
    };
  }
  return { width: rotW, height: rotH, rotatedWidth: rotW, rotatedHeight: rotH };
}

export function getEffectiveCanvas(img) {
  if (!img) return null;
  const key = `${img.rotation || 0}|${img.cropRect ? `${img.cropRect.x},${img.cropRect.y},${img.cropRect.w},${img.cropRect.h}` : 'full'}`;
  if (img._effectiveCache && img._effectiveKey === key) {
    return img._effectiveCache;
  }

  const dims = getEffectiveDimensions(img);
  const rotCanvas = document.createElement('canvas');
  rotCanvas.width = dims.rotatedWidth;
  rotCanvas.height = dims.rotatedHeight;
  const rctx = rotCanvas.getContext('2d', { willReadFrequently: true });
  rctx.save();
  rctx.translate(dims.rotatedWidth / 2, dims.rotatedHeight / 2);
  rctx.rotate(((img.rotation || 0) * Math.PI) / 180);
  const drawSrc = img.bitmap || img.offscreenCanvas;
  rctx.drawImage(drawSrc, -img.width / 2, -img.height / 2);
  rctx.restore();

  let finalCanvas = rotCanvas;
  if (img.cropRect) {
    const cCanvas = document.createElement('canvas');
    cCanvas.width = dims.width;
    cCanvas.height = dims.height;
    const cctx = cCanvas.getContext('2d', { willReadFrequently: true });
    cctx.drawImage(
      rotCanvas,
      img.cropRect.x,
      img.cropRect.y,
      img.cropRect.w,
      img.cropRect.h,
      0,
      0,
      dims.width,
      dims.height
    );
    finalCanvas = cCanvas;
  }

  img._effectiveCache = finalCanvas;
  img._effectiveKey = key;
  return finalCanvas;
}

export async function importImageFiles(files, options = {}) {
  const fileList = Array.from(files || []);
  if (!fileList.length) return [];

  const imported = [];
  const errors = [];
  let anyDownscaled = false;

  for (const file of fileList) {
    if (!isSupportedImageFile(file)) {
      errors.push(`"${file.name}" is not a supported format (PNG, JPG, WebP, BMP, GIF).`);
      continue;
    }
    try {
      const srcImg = await createSourceImageFromBlob(file, file.name, file.type || 'image/png');
      if (srcImg.downscaled) anyDownscaled = true;

      if (options.replaceImageId) {
        const idx = state.images.findIndex((i) => i.id === options.replaceImageId);
        if (idx >= 0) {
          releaseImageResources(state.images[idx]);
          srcImg.id = options.replaceImageId;
          state.images[idx] = srcImg;
        } else {
          state.images.push(srcImg);
        }
      } else {
        state.images.push(srcImg);
      }
      imported.push(srcImg);
    } catch (err) {
      errors.push(err.message || `Could not decode "${file.name}".`);
    }
  }

  if (errors.length) {
    events.emit('toast', { type: 'error', message: errors[0] });
  }

  if (imported.length > 0) {
    setActiveImage(imported[imported.length - 1].id);
    events.emit('images:changed', state.images);
    events.emit('view:fit');
    history.push(options.replaceImageId ? `Replace image (${imported[0].name})` : `Import ${imported.length} image(s)`);
    events.emit('toast', {
      type: anyDownscaled ? 'warning' : 'success',
      message: anyDownscaled
        ? `Imported ${imported.length} image(s) — oversized textures clamped to ${MAX_SAFE_IMAGE_EDGE}px max edge`
        : `Imported ${imported.length} image${imported.length > 1 ? 's' : ''}`,
    });
  }

  return imported;
}

export function closeImage(imageId) {
  const idx = state.images.findIndex((i) => i.id === imageId);
  if (idx < 0) return;

  const removedRippers = state.rippers.filter((r) => r.sourceImageId === imageId);
  for (const r of removedRippers) {
    state.floatingPreviews.delete(r.id);
    r.cachedStages = null;
  }
  state.rippers = state.rippers.filter((r) => r.sourceImageId !== imageId);
  state.atlas.items = state.atlas.items.filter((item) => state.rippers.some((r) => r.id === item.ripperId));

  releaseImageResources(state.images[idx]);
  state.images.splice(idx, 1);

  if (state.activeImageId === imageId) {
    const next = state.images[Math.max(0, idx - 1)] || null;
    setActiveImage(next ? next.id : null);
  }
  events.emit('images:changed', state.images);
  events.emit('rippers:changed', state.rippers);
  history.push('Close source image');
}

export function rotateActiveImage(deltaDeg) {
  const img = state.images.find((i) => i.id === state.activeImageId);
  if (!img) return;
  img.rotation = ((img.rotation || 0) + deltaDeg + 360) % 360;
  img.cropRect = null;
  img._effectiveCache = null;
  events.emit('image:transformed', img);
  events.emit('view:fit');
  history.push(`Rotate image ${deltaDeg > 0 ? '+' : ''}${deltaDeg}°`);
}

export function setActiveImageCrop(cropRect) {
  const img = state.images.find((i) => i.id === state.activeImageId);
  if (!img) return;
  img.cropRect = cropRect ? { ...cropRect } : null;
  img._effectiveCache = null;
  events.emit('image:transformed', img);
  events.emit('view:fit');
  history.push(cropRect ? 'Crop source image' : 'Reset image crop');
}

// Optional procedural sample sheet (only triggered manually by user via File -> Load Sample Sheet)
export async function loadProceduralSampleImage() {
  const c = document.createElement('canvas');
  c.width = 1024;
  c.height = 768;
  const ctx = c.getContext('2d');

  ctx.fillStyle = '#2d3138';
  ctx.fillRect(0, 0, c.width, c.height);

  ctx.save();
  ctx.beginPath();
  ctx.moveTo(60, 110);
  ctx.lineTo(480, 65);
  ctx.lineTo(495, 430);
  ctx.lineTo(75, 495);
  ctx.closePath();
  ctx.clip();
  ctx.fillStyle = '#7c3f2e';
  ctx.fillRect(50, 50, 460, 460);
  for (let row = 0; row < 16; row++) {
    const y = 60 + row * 28;
    const offset = (row % 2) * 32;
    for (let col = -1; col < 10; col++) {
      const x = 60 + col * 64 + offset;
      const shade = ((row * 7 + col * 13) % 24) - 12;
      ctx.fillStyle = `rgb(${148 + shade}, ${72 + Math.floor(shade * 0.6)}, ${52 + Math.floor(shade * 0.4)})`;
      ctx.fillRect(x + 2, y + 2, 60, 24);
      ctx.fillStyle = 'rgba(0,0,0,0.16)';
      ctx.fillRect(x + 2, y + 22, 60, 4);
    }
  }
  ctx.restore();

  ctx.fillStyle = '#5c432c';
  ctx.fillRect(545, 65, 420, 320);
  for (let i = 0; i < 6; i++) {
    const py = 65 + i * 53;
    ctx.fillStyle = i % 2 === 0 ? '#6e5034' : '#5e442c';
    ctx.fillRect(545, py + 2, 420, 49);
    ctx.strokeStyle = 'rgba(30, 18, 8, 0.45)';
    ctx.lineWidth = 2;
    for (let g = 0; g < 5; g++) {
      ctx.beginPath();
      ctx.moveTo(548, py + 8 + g * 8);
      ctx.bezierCurveTo(680, py + 4 + g * 8, 820, py + 14 + g * 8, 962, py + 8 + g * 8);
      ctx.stroke();
    }
  }

  ctx.fillStyle = '#4f5866';
  ctx.fillRect(545, 415, 420, 290);
  for (let y = 425; y < 695; y += 24) {
    for (let x = 555; x < 955; x += 24) {
      ctx.fillStyle = '#6c7788';
      ctx.fillRect(x, y, 20, 20);
      ctx.fillStyle = '#363d47';
      ctx.fillRect(x + 4, y + 4, 12, 12);
    }
  }

  ctx.fillStyle = '#475049';
  ctx.fillRect(75, 520, 420, 185);
  for (let r = 0; r < 4; r++) {
    for (let col = 0; col < 8; col++) {
      const tx = 82 + col * 51;
      const ty = 526 + r * 44;
      const tone = ((r * 11 + col * 17) % 28) - 14;
      ctx.fillStyle = `rgb(${98 + tone}, ${106 + tone}, ${96 + tone})`;
      ctx.fillRect(tx, ty, 47, 40);
    }
  }

  const dataUrl = c.toDataURL('image/png');
  const srcImg = await createSourceImageFromDataUrl(dataUrl, 'sample_materials_sheet.png', 'image/png');
  state.images.push(srcImg);
  setActiveImage(srcImg.id);
  events.emit('images:changed', state.images);
  events.emit('view:fit');
  history.push('Load sample reference sheet');
  events.emit('toast', { type: 'info', message: 'Loaded generated sample materials sheet' });
}
