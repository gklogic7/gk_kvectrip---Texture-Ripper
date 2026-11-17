// Export individual textures, specific pipeline stages, or multiple textures in PNG, JPEG, or WebP
import { state } from '../core/app-state.js';
import { events } from '../core/event-manager.js';

export function canvasToBlob(canvas, format = 'png', quality = 0.92, fillBg = '#000000') {
  return new Promise((resolve, reject) => {
    let target = canvas;
    const mime =
      format === 'jpeg' || format === 'jpg'
        ? 'image/jpeg'
        : format === 'webp'
        ? 'image/webp'
        : 'image/png';

    // JPEG does not support alpha; flatten onto background if needed
    if (mime === 'image/jpeg') {
      const flat = document.createElement('canvas');
      flat.width = canvas.width;
      flat.height = canvas.height;
      const ctx = flat.getContext('2d');
      ctx.fillStyle = fillBg;
      ctx.fillRect(0, 0, flat.width, flat.height);
      ctx.drawImage(canvas, 0, 0);
      target = flat;
    }

    target.toBlob(
      (blob) => {
        if (!blob) reject(new Error(`Failed to encode ${format.toUpperCase()} image.`));
        else resolve(blob);
      },
      mime,
      mime === 'image/png' ? undefined : quality
    );
  });
}

export function triggerBlobDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

export async function exportRipperStage(ripper, stage = 'final', format = 'png', quality = 0.92) {
  if (!ripper || !ripper.cachedStages) return;
  const canvas = ripper.cachedStages[stage] || ripper.cachedStages.final;
  if (!canvas) {
    events.emit('toast', { type: 'warning', message: `Texture "${ripper.name}" is not processed yet.` });
    return;
  }
  const ext = format === 'jpeg' ? 'jpg' : format;
  const blob = await canvasToBlob(canvas, format, quality);
  const safeName = ripper.name.replace(/[^a-z0-9_\-]+/gi, '_');
  triggerBlobDownload(blob, `${safeName}_${stage}.${ext}`);
  events.emit('toast', { type: 'success', message: `Exported ${safeName}_${stage}.${ext}` });
}

export async function exportAllRippers(stage = 'final', format = 'png', quality = 0.92) {
  const ready = state.rippers.filter((r) => r.enabled && (r.cachedStages?.[stage] || r.cachedStages?.final));
  if (!ready.length) {
    events.emit('toast', { type: 'warning', message: 'No processed textures available to export.' });
    return;
  }
  for (const r of ready) {
    await exportRipperStage(r, stage, format, quality);
  }
}
