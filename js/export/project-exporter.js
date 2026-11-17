// Pure-JS zero-dependency ZIP archive writer (CRC-32 + Store) & JSON Project Export/Import
import { state, setActiveImage, setTheme, createDefaultAtlasPostFx, createDefaultRipperFx } from '../core/app-state.js';
import { events } from '../core/event-manager.js';
import { history } from '../core/history-manager.js';
import { projectManager } from '../core/project-manager.js';
import { createSourceImageFromDataUrl } from '../canvas/image-loader.js';
import { textureManager } from '../texture/texture-manager.js';
import { triggerBlobDownload } from './image-exporter.js';

// Precompute CRC32 table
const CRC_TABLE = new Uint32Array(256);
for (let i = 0; i < 256; i++) {
  let c = i;
  for (let k = 0; k < 8; k++) {
    c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  CRC_TABLE[i] = c >>> 0;
}

function crc32(bytes) {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

export function buildZipBlob(files) {
  // files: [{ name: string, data: Uint8Array }]
  const encoder = new TextEncoder();
  const localParts = [];
  const centralParts = [];
  let offset = 0;

  for (const file of files) {
    const nameBytes = encoder.encode(file.name);
    const data = file.data instanceof Uint8Array ? file.data : new Uint8Array(file.data);
    const crc = crc32(data);

    // Local file header (30 bytes + name)
    const lh = new ArrayBuffer(30 + nameBytes.length);
    const lv = new DataView(lh);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true); // version needed
    lv.setUint16(6, 0x0800, true); // UTF-8 flag
    lv.setUint16(8, 0, true); // compression method: 0 = store
    lv.setUint16(10, 0, true); // mod time
    lv.setUint16(12, 0, true); // mod date
    lv.setUint32(14, crc, true);
    lv.setUint32(18, data.length, true);
    lv.setUint32(22, data.length, true);
    lv.setUint16(26, nameBytes.length, true);
    lv.setUint16(28, 0, true);
    new Uint8Array(lh, 30).set(nameBytes);

    localParts.push(new Uint8Array(lh), data);

    // Central directory header (46 bytes + name)
    const ch = new ArrayBuffer(46 + nameBytes.length);
    const cv = new DataView(ch);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(8, 0x0800, true);
    cv.setUint16(10, 0, true);
    cv.setUint16(12, 0, true);
    cv.setUint16(14, 0, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, data.length, true);
    cv.setUint32(24, data.length, true);
    cv.setUint16(28, nameBytes.length, true);
    cv.setUint16(30, 0, true);
    cv.setUint16(32, 0, true);
    cv.setUint16(34, 0, true);
    cv.setUint16(36, 0, true);
    cv.setUint32(38, 0, true);
    cv.setUint32(42, offset, true);
    new Uint8Array(ch, 46).set(nameBytes);

    centralParts.push(new Uint8Array(ch));
    offset += 30 + nameBytes.length + data.length;
  }

  let centralSize = 0;
  for (const cp of centralParts) centralSize += cp.length;

  // End of central directory (22 bytes)
  const eocd = new ArrayBuffer(22);
  const ev = new DataView(eocd);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(4, 0, true);
  ev.setUint16(6, 0, true);
  ev.setUint16(8, files.length, true);
  ev.setUint16(10, files.length, true);
  ev.setUint32(12, centralSize, true);
  ev.setUint32(16, offset, true);
  ev.setUint16(20, 0, true);

  return new Blob([...localParts, ...centralParts, new Uint8Array(eocd)], { type: 'application/zip' });
}

export function exportProjectFile(customName = null) {
  if (customName) state.projectName = customName;
  const payload = projectManager.serializeProject();
  const json = JSON.stringify(payload, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const safeName = (state.projectName || 'texture_ripper_project').replace(/[^a-z0-9_\-]+/gi, '_');
  triggerBlobDownload(blob, `${safeName}.json`);
  projectManager.saveToIndexedDB().catch(() => {});
  events.emit('toast', { type: 'success', message: `Saved project "${safeName}.json"` });
}

export async function restoreProjectPayload(payload) {
  if (!payload || payload.format !== 'texture-ripper-project') {
    throw new Error('Invalid Texture Ripper project file.');
  }

  // Clear existing state cleanly
  state.rippers = [];
  state.images = [];
  state.floatingPreviews.clear();
  history.clear();

  state.projectName = payload.projectName || 'Untitled Project';
  if (payload.theme) setTheme(payload.theme);
  if (payload.view) Object.assign(state.view, payload.view);

  for (const imgDef of payload.images || []) {
    const srcImg = await createSourceImageFromDataUrl(
      imgDef.dataUrl,
      imgDef.name,
      imgDef.mimeType || 'image/png',
      imgDef.id
    );
    srcImg.rotation = imgDef.rotation || 0;
    srcImg.cropRect = imgDef.cropRect || null;
    state.images.push(srcImg);
  }

  state.rippers = (payload.rippers || []).map((r) => {
    const defFx = createDefaultRipperFx();
    return {
      ...r,
      previewTransform: {
        offsetU: 0,
        offsetV: 0,
        repeatX: 1,
        repeatY: 1,
        applyFx: true,
        ...(r.previewTransform || {}),
      },
      fx: {
        ...defFx,
        ...(r.fx || {}),
        post: {
          ...defFx.post,
          ...(r.fx?.post || {}),
        },
      },
      cachedStages: {
        original: null,
        perspective: null,
        seamless: null,
        final: null,
        thumbnailUrl: '',
      },
    };
  });

  if (payload.seamlessEditorFx !== undefined) {
    state.seamlessEditor.applyFx = !!payload.seamlessEditorFx;
  }

  if (payload.atlas) {
    const prevFx = state.atlas.fx;
    const { fx: savedFx, ...restAtlas } = payload.atlas;
    Object.assign(state.atlas, restAtlas);
    state.atlas.arrayScale = state.atlas.arrayScale ?? 1;
    state.atlas.arrayScaleX = state.atlas.arrayScaleX ?? 1;
    state.atlas.arrayScaleY = state.atlas.arrayScaleY ?? 1;
    state.atlas.gizmoScaleMode = state.atlas.gizmoScaleMode || 'both';
    state.atlas.manualOverrides = payload.atlas.manualOverrides ? { ...payload.atlas.manualOverrides } : {};
    state.atlas.selectedPlacementId = null;
    state.atlas.packedResult = null;
    state.atlas.fx = {
      ...prevFx,
      ...(savedFx || {}),
      post: {
        ...createDefaultAtlasPostFx(),
        ...(savedFx?.post || {}),
      },
    };
  }

  setActiveImage(payload.activeImageId || state.images[0]?.id || null);
  state.activeRipperId = payload.activeRipperId || state.rippers[0]?.id || null;

  events.emit('images:changed', state.images);
  events.emit('rippers:changed', state.rippers);
  events.emit('ripper:selected', state.rippers.find((r) => r.id === state.activeRipperId) || null);
  events.emit('view:changed');
  events.emit('view:fit');
  history.push(`Load project (${state.projectName})`);

  for (const r of state.rippers) {
    textureManager.scheduleProcess(r.id, 30);
  }
}

export async function importProjectFile(file) {
  const text = await file.text();
  const payload = JSON.parse(text);
  await restoreProjectPayload(payload);
  events.emit('toast', { type: 'success', message: `Opened project "${state.projectName}"` });
}
