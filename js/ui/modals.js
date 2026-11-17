// Modals, dialogs (Export, Crop/Rotate, Shortcuts Customizer, Help), and Toasts
import { state, getActiveImage, getActiveRipper } from '../core/app-state.js';
import { events } from '../core/event-manager.js';
import { shortcuts } from '../core/shortcuts-manager.js';
import { getEffectiveDimensions, setActiveImageCrop, rotateActiveImage } from '../canvas/image-loader.js';
import { exportRipperStage, exportAllRippers } from '../export/image-exporter.js';
import { exportAtlasImage, exportAtlasMetadata, exportAtlasZipPackage } from '../atlas/atlas-exporter.js';

class ModalController {
  constructor() {
    this.modalLayer = document.getElementById('modal-layer');
    this.toastLayer = document.getElementById('toast-layer');
    events.on('toast', (payload) => this.showToast(payload));
  }

  showToast({ type = 'info', message = '' }) {
    if (!message) return;
    const el = document.createElement('div');
    el.className = `toast toast-${type}`;
    el.textContent = message;
    this.toastLayer.appendChild(el);
    setTimeout(() => {
      el.remove();
    }, 3200);
  }

  close() {
    this.modalLayer.hidden = true;
    this.modalLayer.innerHTML = '';
  }

  openModal({ title, wide = false, bodyHtml, footerHtml, onMount }) {
    this.modalLayer.innerHTML = `
      <div class="modal-dialog ${wide ? 'modal-wide' : ''}" role="dialog" aria-modal="true">
        <div class="modal-header">
          <h2 class="modal-title">${title}</h2>
          <button type="button" class="btn-icon" id="modal-close-x" aria-label="Close">✕</button>
        </div>
        <div class="modal-body">${bodyHtml}</div>
        ${footerHtml ? `<div class="modal-footer">${footerHtml}</div>` : ''}
      </div>
    `;
    this.modalLayer.hidden = false;
    this.modalLayer.querySelector('#modal-close-x')?.addEventListener('click', () => this.close());
    this.modalLayer.onclick = (e) => {
      if (e.target === this.modalLayer) this.close();
    };
    if (onMount) onMount(this.modalLayer);
  }

  openExportDialog(defaultTarget = 'selected') {
    const active = getActiveRipper();
    this.openModal({
      title: 'Export Textures & Atlas',
      bodyHtml: `
        <div class="prop-row">
          <label class="prop-label" for="exp-target">Export Target</label>
          <select id="exp-target" class="select">
            <option value="selected" ${defaultTarget === 'selected' ? 'selected' : ''}>Selected Texture (${active ? active.name : 'None'})</option>
            <option value="all" ${defaultTarget === 'all' ? 'selected' : ''}>All Enabled Textures (${state.rippers.filter((r) => r.enabled).length})</option>
            <option value="atlas" ${defaultTarget === 'atlas' ? 'selected' : ''}>Complete Texture Atlas</option>
            <option value="atlas-preview">Atlas Preview (with overlays)</option>
            <option value="metadata">Atlas Metadata (.json)</option>
            <option value="zip" ${defaultTarget === 'zip' ? 'selected' : ''}>Complete ZIP Package (Atlas + Textures + JSON)</option>
          </select>
        </div>
        <div class="prop-row" id="exp-stage-row">
          <label class="prop-label" for="exp-stage">Pipeline Stage</label>
          <select id="exp-stage" class="select">
            <option value="final" selected>Processed Final</option>
            <option value="seamless">Seamless Result</option>
            <option value="perspective">Perspective-Corrected</option>
            <option value="original">Original Extraction</option>
          </select>
        </div>
        <div class="prop-row" id="exp-format-row">
          <label class="prop-label" for="exp-format">Image Format</label>
          <select id="exp-format" class="select">
            <option value="png">PNG (Lossless + Alpha)</option>
            <option value="jpeg">JPEG (Compressed)</option>
            <option value="webp">WebP (Modern Compact)</option>
          </select>
        </div>
        <div class="prop-slider-group" id="exp-quality-row">
          <div class="prop-slider-header">
            <span>Compression Quality</span>
            <span class="prop-value" id="exp-quality-val">92%</span>
          </div>
          <input type="range" id="exp-quality" class="slider" min="10" max="100" value="92" />
        </div>
      `,
      footerHtml: `
        <button type="button" class="btn" id="exp-cancel">Cancel</button>
        <button type="button" class="btn btn-primary" id="exp-run">Export Now</button>
      `,
      onMount: (root) => {
        const targetEl = root.querySelector('#exp-target');
        const stageRow = root.querySelector('#exp-stage-row');
        const formatRow = root.querySelector('#exp-format-row');
        const qualityEl = root.querySelector('#exp-quality');
        const qualityVal = root.querySelector('#exp-quality-val');
        const qualityRow = root.querySelector('#exp-quality-row');
        const formatEl = root.querySelector('#exp-format');

        const syncVisibility = () => {
          const t = targetEl.value;
          stageRow.style.display = t === 'selected' || t === 'all' ? 'flex' : 'none';
          formatRow.style.display = t === 'metadata' ? 'none' : 'flex';
          qualityRow.style.display = t === 'metadata' || formatEl.value === 'png' ? 'none' : 'flex';
        };
        targetEl.addEventListener('change', syncVisibility);
        formatEl.addEventListener('change', syncVisibility);
        qualityEl.addEventListener('input', () => {
          qualityVal.textContent = `${qualityEl.value}%`;
        });
        syncVisibility();

        root.querySelector('#exp-cancel').addEventListener('click', () => this.close());
        root.querySelector('#exp-run').addEventListener('click', async () => {
          const t = targetEl.value;
          const stage = root.querySelector('#exp-stage').value;
          const fmt = formatEl.value;
          const q = Number(qualityEl.value) / 100;
          this.close();

          if (t === 'selected') {
            if (!active) {
              this.showToast({ type: 'warning', message: 'Select a texture ripper first.' });
              return;
            }
            await exportRipperStage(active, stage, fmt, q);
          } else if (t === 'all') {
            await exportAllRippers(stage, fmt, q);
          } else if (t === 'atlas') {
            await exportAtlasImage(fmt, q, false);
          } else if (t === 'atlas-preview') {
            await exportAtlasImage(fmt, q, true);
          } else if (t === 'metadata') {
            exportAtlasMetadata();
          } else if (t === 'zip') {
            await exportAtlasZipPackage(fmt, q);
          }
        });
      },
    });
  }

  openCropRotateDialog() {
    const img = getActiveImage();
    if (!img) {
      this.showToast({ type: 'warning', message: 'Import an image first.' });
      return;
    }
    const dims = getEffectiveDimensions(img);
    const curCrop = img.cropRect || { x: 0, y: 0, w: dims.rotatedWidth, h: dims.rotatedHeight };

    this.openModal({
      title: `Transform Source Image (${img.name})`,
      bodyHtml: `
        <div class="prop-row">
          <span class="prop-label">Quick Rotate</span>
          <div class="btn-grid-3">
            <button type="button" class="btn btn-sm" id="tf-rot-m90">-90°</button>
            <button type="button" class="btn btn-sm" id="tf-rot-p90">+90°</button>
            <button type="button" class="btn btn-sm" id="tf-rot-180">180°</button>
          </div>
        </div>
        <div class="prop-row">
          <span class="prop-label">Crop Region (px)</span>
          <span class="mono" style="color:var(--text-muted)">Max ${dims.rotatedWidth}×${dims.rotatedHeight}</span>
        </div>
        <div class="btn-grid-2">
          <label class="prop-row"><span class="prop-label">X</span><input type="number" id="crop-x" class="input input-num" min="0" value="${curCrop.x}"></label>
          <label class="prop-row"><span class="prop-label">Y</span><input type="number" id="crop-y" class="input input-num" min="0" value="${curCrop.y}"></label>
          <label class="prop-row"><span class="prop-label">Width</span><input type="number" id="crop-w" class="input input-num" min="8" value="${curCrop.w}"></label>
          <label class="prop-row"><span class="prop-label">Height</span><input type="number" id="crop-h" class="input input-num" min="8" value="${curCrop.h}"></label>
        </div>
      `,
      footerHtml: `
        <button type="button" class="btn" id="tf-reset-crop">Reset Crop</button>
        <button type="button" class="btn btn-primary" id="tf-apply-crop">Apply Crop</button>
      `,
      onMount: (root) => {
        root.querySelector('#tf-rot-m90').addEventListener('click', () => {
          rotateActiveImage(-90);
          this.close();
        });
        root.querySelector('#tf-rot-p90').addEventListener('click', () => {
          rotateActiveImage(90);
          this.close();
        });
        root.querySelector('#tf-rot-180').addEventListener('click', () => {
          rotateActiveImage(180);
          this.close();
        });
        root.querySelector('#tf-reset-crop').addEventListener('click', () => {
          setActiveImageCrop(null);
          this.close();
        });
        root.querySelector('#tf-apply-crop').addEventListener('click', () => {
          const x = Math.max(0, Math.min(dims.rotatedWidth - 8, Number(root.querySelector('#crop-x').value) || 0));
          const y = Math.max(0, Math.min(dims.rotatedHeight - 8, Number(root.querySelector('#crop-y').value) || 0));
          const w = Math.max(8, Math.min(dims.rotatedWidth - x, Number(root.querySelector('#crop-w').value) || dims.rotatedWidth));
          const h = Math.max(8, Math.min(dims.rotatedHeight - y, Number(root.querySelector('#crop-h').value) || dims.rotatedHeight));
          setActiveImageCrop({ x, y, w, h });
          this.close();
        });
      },
    });
  }

  openShortcutsModal() {
    const rows = Object.entries(shortcuts.bindings)
      .map(
        ([id, def]) => `
        <tr>
          <td>${def.label}</td>
          <td style="text-align:right">
            <button type="button" class="btn btn-sm mono shortcut-edit-btn" data-action-id="${id}">${def.combo}</button>
          </td>
        </tr>
      `
      )
      .join('');

    this.openModal({
      title: 'Customize Keyboard Shortcuts',
      bodyHtml: `
        <p style="margin:0;color:var(--text-secondary)">Click any shortcut button and press your desired key combination.</p>
        <table class="kv-table">
          <thead><tr><th>Action</th><th style="text-align:right">Shortcut</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      `,
      footerHtml: `
        <button type="button" class="btn" id="sc-reset">Reset Defaults</button>
        <button type="button" class="btn btn-primary" id="sc-done">Done</button>
      `,
      onMount: (root) => {
        root.querySelector('#sc-done').addEventListener('click', () => this.close());
        root.querySelector('#sc-reset').addEventListener('click', () => {
          shortcuts.resetDefaults();
          this.openShortcutsModal();
        });
        root.querySelectorAll('.shortcut-edit-btn').forEach((btn) => {
          btn.addEventListener('click', () => {
            const actionId = btn.dataset.actionId;
            btn.textContent = 'Press keys...';
            const capture = (e) => {
              e.preventDefault();
              e.stopPropagation();
              const combo = shortcuts.eventToCombo(e);
              if (combo) {
                shortcuts.setBinding(actionId, combo);
                btn.textContent = combo;
                window.removeEventListener('keydown', capture, true);
              }
            };
            window.addEventListener('keydown', capture, true);
          });
        });
      },
    });
  }

  openSaveAsDialog(onConfirm) {
    this.openModal({
      title: 'Save Project As',
      bodyHtml: `
        <div class="prop-row">
          <label class="prop-label" for="saveas-name">Project Name</label>
          <input type="text" id="saveas-name" class="input" style="width:240px" value="${state.projectName}" />
        </div>
      `,
      footerHtml: `
        <button type="button" class="btn" id="saveas-cancel">Cancel</button>
        <button type="button" class="btn btn-primary" id="saveas-ok">Save Project (.json)</button>
      `,
      onMount: (root) => {
        const inp = root.querySelector('#saveas-name');
        inp.focus();
        inp.select();
        root.querySelector('#saveas-cancel').addEventListener('click', () => this.close());
        const submit = () => {
          const val = inp.value.trim();
          this.close();
          if (val) onConfirm(val);
        };
        root.querySelector('#saveas-ok').addEventListener('click', submit);
        inp.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') submit();
        });
      },
    });
  }

  openHelpModal(defaultTab = 'guide') {
    let activeTab = defaultTab === 'credits' ? 'credits' : 'guide';

    const renderBody = () => {
      if (activeTab === 'credits') {
        return `
          <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;padding:10px 12px;background:var(--bg-panel-alt);border:1px solid var(--border-hairline)">
            <div>
              <div style="font-size:15px;font-weight:700;color:var(--text-primary)">KVectRip | by KVECT</div>
              <div style="font-size:11px;color:var(--text-muted);margin-top:2px">Offline-first Texture Extraction, Seamless Authoring &amp; Atlas Packing Studio</div>
            </div>
          </div>
          <div class="section-heading" style="margin-top:2px"><span>Tools &amp; Technology Stack Used</span></div>
          <table class="kv-table">
            <thead>
              <tr>
                <th style="width:170px">Layer / Tool</th>
                <th>Implementation &amp; Technology</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td><strong>Core Platform</strong></td>
                <td>HTML5, CSS3 (Semantic Theme Tokens), Vanilla JavaScript (ES6+ Modules)</td>
              </tr>
              <tr>
                <td><strong>2D Rendering &amp; Memory</strong></td>
                <td>HTML5 Canvas 2D API, HiDPI Rulers, <code>ImageBitmap</code> Decoding &amp; Lifecycle Cleanup</td>
              </tr>
              <tr>
                <td><strong>Parallel Processing</strong></td>
                <td>Native Module Web Workers with Transferable <code>ArrayBuffer</code>s</td>
              </tr>
              <tr>
                <td><strong>Geometry &amp; Extraction</strong></td>
                <td>4-Corner Projective 2D Homography &amp; Scanline Polygon Mask Extraction</td>
              </tr>
              <tr>
                <td><strong>Seamless Synthesis</strong></td>
                <td>Smoothed Collage, Scattered Edges, 50% Offset &amp; Blend, Mirror &amp; Blend, Toroidal Wrap-Offset &amp; Clone-Stamp Brush</td>
              </tr>
              <tr>
                <td><strong>Detail &amp; Pixel Art</strong></td>
                <td>Unsharp Mask &amp; Lighting Balance, Median-Cut Quantization, Bayer 4×4 &amp; Floyd-Steinberg Dithering</td>
              </tr>
              <tr>
                <td><strong>Atlas &amp; Packaging</strong></td>
                <td>MaxRects / Shelf / Guillotine Packing, Free-Move Gizmo (Move/Scale/Rotate + Grid/Edge Snap), Pure-JS CRC-32 ZIP &amp; JSON UV Export</td>
              </tr>
              <tr>
                <td><strong>Offline Persistence &amp; Build</strong></td>
                <td>IndexedDB Local Autosave, File System Access API (with File Input Fallback), Vite</td>
              </tr>
            </tbody>
          </table>
        `;
      }

      return `
        <p style="margin:0;color:var(--text-secondary)">
          <strong>1. Import Reference Images:</strong> Drag &amp; drop PNG, JPG, WebP, BMP, or GIF files onto the canvas, paste from clipboard, or use File &rarr; Open Reference Image.
        </p>
        <p style="margin:0;color:var(--text-secondary)">
          <strong>2. Polygon Extraction &amp; Selection Layers:</strong> Trace polygons, rectangles, or freeform shapes. Manage overlapping polygons in the Properties Inspector <strong>Selection Layers</strong> stack using <strong>Eye (Hide/Show)</strong> and <strong>Edit</strong>. Four-point quads automatically apply projective perspective rectification.
        </p>
        <p style="margin:0;color:var(--text-secondary)">
          <strong>3. Seamless Editor &amp; Detail Restoration:</strong> Open the <strong>Seamless Editor</strong> tab to preview 1×1 / 2×2 / 3×3 tiling with Seam Guides, Split Compare, Wrap-Offset dragging, and Clone-Stamp seam repair across Methods A–E.
        </p>
        <p style="margin:0;color:var(--text-secondary)">
          <strong>4. Pixel-Art, Atlas Packing &amp; Full Size View:</strong> Enable Pixel-Art Mode for quantized dithering, pack textures into custom aspect-ratio atlases with the Free-Move Gizmo &amp; Snap, and toggle <strong>Full Size</strong> on any bottom panel tab for expanded studio workspace editing.
        </p>
      `;
    };

    this.openModal({
      title: 'KVectRip — Help & Credits',
      wide: true,
      bodyHtml: `
        <div class="segmented-control" style="max-width:300px">
          <button type="button" class="seg-btn ${activeTab === 'guide' ? 'active' : ''}" data-help-tab="guide">Workflow Guide</button>
          <button type="button" class="seg-btn ${activeTab === 'credits' ? 'active' : ''}" data-help-tab="credits">Credits &amp; Tech Stack</button>
        </div>
        <div id="help-modal-content" style="display:flex;flex-direction:column;gap:10px">${renderBody()}</div>
      `,
      footerHtml: `<button type="button" class="btn btn-primary" id="help-ok">Close</button>`,
      onMount: (root) => {
        const contentEl = root.querySelector('#help-modal-content');
        root.querySelectorAll('[data-help-tab]').forEach((btn) => {
          btn.addEventListener('click', () => {
            activeTab = btn.dataset.helpTab;
            root.querySelectorAll('[data-help-tab]').forEach((b) => {
              b.classList.toggle('active', b.dataset.helpTab === activeTab);
            });
            contentEl.innerHTML = renderBody();
          });
        });
        root.querySelector('#help-ok').addEventListener('click', () => this.close());
      },
    });
  }
}

export const modals = new ModalController();
