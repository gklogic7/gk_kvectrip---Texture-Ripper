// Atlas Exporter: exports full atlas image, atlas preview, individual tiles, metadata JSON, and ZIP bundle
import { state } from '../core/app-state.js';
import { events } from '../core/event-manager.js';
import { atlasManager } from './atlas-manager.js';
import { canvasToBlob, triggerBlobDownload } from '../export/image-exporter.js';
import { buildAtlasMetadata } from '../export/metadata-exporter.js';
import { buildZipBlob } from '../export/project-exporter.js';

export async function exportAtlasImage(format = 'png', quality = 0.92, withOverlays = false) {
  const res = state.atlas.packedResult || atlasManager.rebuildAtlas();
  if (!res) {
    events.emit('toast', { type: 'warning', message: 'No textures packed in atlas.' });
    return;
  }
  const canvas = withOverlays ? res.previewCanvas : res.cleanCanvas;
  const ext = format === 'jpeg' ? 'jpg' : format;
  const blob = await canvasToBlob(canvas, format, quality, state.atlas.bgColor || '#000000');
  const suffix = withOverlays ? '_preview' : '';
  triggerBlobDownload(blob, `texture_atlas${suffix}.${ext}`);
  events.emit('toast', { type: 'success', message: `Exported texture_atlas${suffix}.${ext}` });
}

export function exportAtlasMetadata() {
  const res = state.atlas.packedResult || atlasManager.rebuildAtlas();
  if (!res) {
    events.emit('toast', { type: 'warning', message: 'No atlas metadata to export.' });
    return;
  }
  const meta = buildAtlasMetadata(res);
  const blob = new Blob([JSON.stringify(meta, null, 2)], { type: 'application/json' });
  triggerBlobDownload(blob, 'texture_atlas_metadata.json');
  events.emit('toast', { type: 'success', message: 'Exported texture_atlas_metadata.json' });
}

export async function exportAtlasZipPackage(format = 'png', quality = 0.92) {
  const res = state.atlas.packedResult || atlasManager.rebuildAtlas();
  if (!res) {
    events.emit('toast', { type: 'warning', message: 'No atlas textures available for ZIP export.' });
    return;
  }

  const ext = format === 'jpeg' ? 'jpg' : format;
  const files = [];

  // 1. Complete Atlas image
  const atlasBlob = await canvasToBlob(res.cleanCanvas, format, quality, state.atlas.bgColor || '#000000');
  files.push({
    name: `atlas/texture_atlas.${ext}`,
    data: new Uint8Array(await atlasBlob.arrayBuffer()),
  });

  // 2. Atlas metadata JSON
  const meta = buildAtlasMetadata(res);
  const encoder = new TextEncoder();
  files.push({
    name: 'atlas/texture_atlas_metadata.json',
    data: encoder.encode(JSON.stringify(meta, null, 2)),
  });

  // 3. Individual textures
  for (const p of res.placements) {
    const ripper = state.rippers.find((r) => r.id === p.ripperId);
    const texCanvas = ripper?.cachedStages?.final || p.sourceCanvas;
    if (!texCanvas) continue;
    const texBlob = await canvasToBlob(texCanvas, format, quality);
    const safeName = p.name.replace(/[^a-z0-9_\-]+/gi, '_');
    files.push({
      name: `textures/${safeName}.${ext}`,
      data: new Uint8Array(await texBlob.arrayBuffer()),
    });
  }

  const zipBlob = buildZipBlob(files);
  const safeProject = (state.projectName || 'texture_ripper').replace(/[^a-z0-9_\-]+/gi, '_');
  triggerBlobDownload(zipBlob, `${safeProject}_atlas_bundle.zip`);
  events.emit('toast', { type: 'success', message: `Exported ZIP bundle (${files.length} files)` });
}
