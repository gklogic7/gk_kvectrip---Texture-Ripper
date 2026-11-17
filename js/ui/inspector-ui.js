// Right Properties Inspector: Selection, Texture/Perspective, Seamless (A-E), Detail & Color, Pixel-Art Workflow
import {
  state,
  TOOL_IDS,
  getActiveRipper,
  getRippersForActiveImage,
  setActiveRipper,
  setActiveTool,
  MATERIAL_CATEGORIES,
} from '../core/app-state.js';
import { events } from '../core/event-manager.js';
import { history } from '../core/history-manager.js';
import { projectManager } from '../core/project-manager.js';
import { computeNaturalQuadSize } from '../canvas/perspective-engine.js';
import { textureManager } from '../texture/texture-manager.js';
import { ensureRipperFx, resetRipperSeamlessDefaults } from '../texture/texture-ripper.js';
import { applyRipperFxToCanvas } from '../atlas/atlas-fx-engine.js';
import { exportRipperStage } from '../export/image-exporter.js';
import { ICONS } from './icons.js';
import { floatingPreviews, renderWrappedTiledCanvas } from './preview-window.js';

export class InspectorUI {
  constructor() {
    this.el = document.getElementById('right-inspector');
    this._ignoreSeamlessSync = false;
    this.render();

    events.on('ripper:selected', () => this.render());
    events.on('rippers:changed', () => this.render());
    events.on('image:selected', () => this.render());
    events.on('ripper:seamlessChanged', (r) => {
      if (this._ignoreSeamlessSync) return;
      if (r && r.id === state.activeRipperId && state.inspectorTab === 'seamless') {
        this.render();
      }
    });
    events.on('ripper:processed', (r) => {
      if (r && r.id === state.activeRipperId) {
        this._drawMiniPreview(r);
      }
    });
    events.on('preview:transformChanged', ({ ripperId, source } = {}) => {
      if (source === 'inspector' || ripperId !== state.activeRipperId) return;
      const active = getActiveRipper();
      if (active) this._drawMiniPreview(active);
    });
    events.on('ripper:fxChanged', ({ ripperId } = {}) => {
      if (ripperId && ripperId !== state.activeRipperId) return;
      const active = getActiveRipper();
      if (active) this._drawMiniPreview(active);
    });
    events.on('worker:progress', ({ ripperId, progress, stageLabel, done }) => {
      if (ripperId !== state.activeRipperId) return;
      const box = this.el.querySelector('#insp-progress');
      if (!box) return;
      if (done) {
        box.style.display = 'none';
      } else {
        box.style.display = 'flex';
        box.querySelector('.worker-progress-fill').style.width = `${progress}%`;
        box.querySelector('#insp-progress-label').textContent = stageLabel || 'Processing';
      }
    });
  }

  render() {
    const collapsed = state.panels.rightCollapsed;
    this.el.classList.toggle('collapsed', collapsed);
    const ripper = getActiveRipper();

    this.el.innerHTML = `
      <div class="panel-header">
        <span class="panel-title">Properties Inspector</span>
        <button type="button" class="btn-icon" id="btn-collapse-right" title="${collapsed ? 'Expand inspector' : 'Collapse inspector'}">
          ${collapsed ? '«' : '»'}
        </button>
      </div>
      <div class="inspector-tabs">
        <button type="button" class="tab-btn ${state.inspectorTab === 'selection' ? 'active' : ''}" data-tab="selection">Selection</button>
        <button type="button" class="tab-btn ${state.inspectorTab === 'texture' ? 'active' : ''}" data-tab="texture">Texture</button>
        <button type="button" class="tab-btn ${state.inspectorTab === 'seamless' ? 'active' : ''}" data-tab="seamless">Seamless</button>
        <button type="button" class="tab-btn ${state.inspectorTab === 'detail' ? 'active' : ''}" data-tab="detail">Detail/Color</button>
        <button type="button" class="tab-btn ${state.inspectorTab === 'pixel' ? 'active' : ''}" data-tab="pixel">Pixel Art</button>
      </div>
      <div class="inspector-body" id="inspector-scroll-body">
        ${ripper ? this._renderRipperInspector(ripper) : this._renderEmptyInspector()}
      </div>
    `;

    this.el.querySelector('#btn-collapse-right').addEventListener('click', () => {
      state.panels.rightCollapsed = !state.panels.rightCollapsed;
      this.render();
    });

    this.el.querySelectorAll('.inspector-tabs .tab-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        state.inspectorTab = btn.dataset.tab;
        this.render();
      });
    });

    if (ripper) {
      this._wireRipperHandlers(ripper);
      this._drawMiniPreview(ripper);
    } else {
      this._wireEmptyHandlers();
    }
  }

  _renderSelectionLayersSection() {
    const layers = getRippersForActiveImage();
    if (!layers.length) {
      return `
        <div class="inspector-section">
          <div class="section-heading"><span>Selection Layers (0)</span></div>
          <p style="margin:0;font-size:11px;color:var(--text-muted)">No polygon selection layers on this image yet.</p>
        </div>
      `;
    }

    const rows = layers
      .map((layer, idx) => {
        const isActive = layer.id === state.activeRipperId;
        const isHidden = !layer.style.visible;
        return `
          <div class="layer-row ${isActive ? 'active' : ''} ${isHidden ? 'hidden-layer' : ''}" data-layer-id="${layer.id}">
            <span class="layer-swatch" style="background:${layer.style.outlineColor}" title="Selection color"></span>
            <div class="layer-info">
              <div class="layer-name" title="${layer.name}">${layer.name}</div>
              <div class="layer-meta tabular-nums">${layer.points.length} pts · ${layer.extraction.outWidth}×${layer.extraction.outHeight}${isHidden ? ' · Hidden' : ''}</div>
            </div>
            <div class="layer-actions">
              <button type="button" class="btn-icon layer-eye" data-layer-eye="${layer.id}" title="${isHidden ? 'Show layer' : 'Hide layer'}" aria-label="${isHidden ? 'Show layer' : 'Hide layer'}">
                ${isHidden ? ICONS.eyeOff : ICONS.eye}
              </button>
              <button type="button" class="btn btn-sm layer-edit-btn" data-layer-edit="${layer.id}" title="Select and Edit polygon vertices">
                ${ICONS.edit}
                <span>Edit</span>
              </button>
              <button type="button" class="btn-icon layer-up" data-layer-up="${layer.id}" ${idx === 0 ? 'disabled' : ''} title="Move layer up">↑</button>
              <button type="button" class="btn-icon layer-down" data-layer-down="${layer.id}" ${idx === layers.length - 1 ? 'disabled' : ''} title="Move layer down">↓</button>
              <button type="button" class="btn-icon layer-del" data-layer-del="${layer.id}" title="Delete layer" aria-label="Delete layer">${ICONS.trash}</button>
            </div>
          </div>
        `;
      })
      .join('');

    return `
      <div class="inspector-section">
        <div class="section-heading">
          <span>Selection Layers (${layers.length})</span>
          <div style="display:flex;gap:4px">
            <button type="button" class="btn btn-sm" id="layers-show-all" title="Show all selection layers">Show All</button>
            <button type="button" class="btn btn-sm" id="layers-hide-all" title="Hide all selection layers">Hide All</button>
          </div>
        </div>
        <div class="layer-list">${rows}</div>
      </div>
    `;
  }

  _renderEmptyInspector() {
    const layersSection = state.activeImageId ? this._renderSelectionLayersSection() : '';
    return `
      ${layersSection}
      <div class="empty-state-inline">
        <p style="margin:0 0 8px">No texture ripper selected.</p>
        <p style="margin:0;color:var(--text-muted)">Import an image and trace a polygon or rectangle on the canvas to inspect and process a material.</p>
      </div>
      <div class="inspector-section">
        <div class="section-heading"><span>Workspace Grid &amp; Snap</span></div>
        <div class="prop-row">
          <span class="prop-label">Grid Size (px)</span>
          <input type="number" id="empty-grid-size" class="input input-num" min="4" max="256" value="${state.view.gridSize}" />
        </div>
        <label class="check-label"><input type="checkbox" id="empty-snap-grid" ${state.view.snapGrid ? 'checked' : ''} /> Snap vertices to grid</label>
        <label class="check-label"><input type="checkbox" id="empty-snap-edge" ${state.view.snapEdges ? 'checked' : ''} /> Snap vertices to image edges</label>
      </div>
    `;
  }

  _renderRipperInspector(r) {
    const headerPreview = `
      <div class="inspector-section">
        <div class="section-heading">
          <span>${r.name}</span>
          <div style="display:flex;gap:4px">
            <button type="button" class="btn btn-sm" id="insp-float-preview">Float Preview</button>
            <button type="button" class="btn btn-sm btn-primary" id="insp-export-tex">Export</button>
          </div>
        </div>
        <div class="mini-preview-box checkerboard-bg">
          <canvas id="insp-mini-canvas"></canvas>
        </div>
        <div class="insp-preview-meta">
          <span class="mono" id="insp-preview-transform-info">1×1 · X:0px Y:0px (U:0.00 V:0.00)</span>
          <button type="button" class="btn btn-sm" id="insp-uv-reset" title="Reset preview X/Y, U/V, and Repeat to 1×1">Reset UV</button>
        </div>
        <div class="worker-progress" id="insp-progress" style="display:none">
          <span id="insp-progress-label">Processing</span>
          <div class="worker-progress-bar"><div class="worker-progress-fill" style="width:0%"></div></div>
          <button type="button" class="btn btn-sm" id="insp-cancel-job">Cancel</button>
        </div>
      </div>
    `;

    let tabBody = '';
    if (state.inspectorTab === 'selection') {
      tabBody = `
        ${this._renderSelectionLayersSection()}
        <div class="inspector-section">
          <div class="section-heading"><span>Ripper Identity</span></div>
          <div class="prop-row">
            <span class="prop-label">Name</span>
            <input type="text" id="rip-name" class="input" style="width:155px" value="${r.name}" />
          </div>
          <div class="prop-row">
            <span class="prop-label">Category</span>
            <select id="rip-category" class="select" style="width:155px">
              ${MATERIAL_CATEGORIES.map((c) => `<option value="${c}" ${r.category === c ? 'selected' : ''}>${c}</option>`).join('')}
            </select>
          </div>
          <label class="check-label"><input type="checkbox" id="rip-enabled" ${r.enabled ? 'checked' : ''} /> Include in Atlas &amp; Batch Export</label>
          <div class="btn-grid-2">
            <button type="button" class="btn btn-sm" id="rip-duplicate">Duplicate</button>
            <button type="button" class="btn btn-sm btn-danger" id="rip-delete">Delete</button>
          </div>
        </div>

        <div class="inspector-section">
          <div class="section-heading"><span>Polygon Overlay Style</span></div>
          <label class="check-label"><input type="checkbox" id="rip-visible" ${r.style.visible ? 'checked' : ''} /> Selection visible</label>
          ${this._sliderHtml('rip-opacity', 'Polygon Opacity', Math.round(r.style.opacity * 100), 0, 90, '%')}
          ${this._sliderHtml('rip-outline-w', 'Outline Thickness', r.style.outlineWidth, 1, 6, 'px')}
          ${this._sliderHtml('rip-vertex-s', 'Vertex Size', r.style.vertexSize, 4, 14, 'px')}
          <div class="prop-row">
            <span class="prop-label">Outline / Fill Color</span>
            <div style="display:flex;gap:6px">
              <input type="color" id="rip-outline-col" class="color-swatch" value="${r.style.outlineColor}" title="Outline color" />
              <input type="color" id="rip-fill-col" class="color-swatch" value="${r.style.fillColor}" title="Fill color" />
            </div>
          </div>
        </div>

        <div class="inspector-section">
          <div class="section-heading"><span>Grid &amp; Snapping</span></div>
          <div class="prop-row">
            <span class="prop-label">Grid Size (px)</span>
            <input type="number" id="view-grid-size" class="input input-num" min="4" max="256" value="${state.view.gridSize}" />
          </div>
          <label class="check-label"><input type="checkbox" id="view-snap-grid" ${state.view.snapGrid ? 'checked' : ''} /> Snap to grid</label>
          <label class="check-label"><input type="checkbox" id="view-snap-edge" ${state.view.snapEdges ? 'checked' : ''} /> Snap to image edges</label>
        </div>
      `;
    } else if (state.inspectorTab === 'texture') {
      tabBody = `
        <div class="inspector-section">
          <div class="section-heading"><span>Perspective &amp; Extraction</span></div>
          <div class="prop-row">
            <span class="prop-label">Mode (${r.points.length} vertices)</span>
            <select id="ext-mode" class="select">
              <option value="perspective" ${r.extraction.mode === 'perspective' ? 'selected' : ''}>4-Corner Perspective</option>
              <option value="mask" ${r.extraction.mode === 'mask' ? 'selected' : ''}>Polygon Mask</option>
            </select>
          </div>
          <div class="btn-grid-2">
            <label class="prop-row"><span class="prop-label">Width</span><input type="number" id="ext-w" class="input input-num" min="8" max="2048" value="${r.extraction.outWidth}" /></label>
            <label class="prop-row"><span class="prop-label">Height</span><input type="number" id="ext-h" class="input input-num" min="8" max="2048" value="${r.extraction.outHeight}" /></label>
          </div>
          <label class="check-label"><input type="checkbox" id="ext-lock" ${r.extraction.lockAspect ? 'checked' : ''} /> Maintain aspect ratio</label>
          <button type="button" class="btn btn-sm" id="ext-natural">Match Natural Quad Proportions</button>
          <div class="prop-row">
            <span class="prop-label">Resampling</span>
            <select id="ext-resample" class="select">
              <option value="bilinear" ${r.extraction.resampling === 'bilinear' ? 'selected' : ''}>Bilinear (Smooth)</option>
              <option value="nearest" ${r.extraction.resampling === 'nearest' ? 'selected' : ''}>Nearest-Neighbor (Sharp)</option>
            </select>
          </div>
          <label class="check-label"><input type="checkbox" id="ext-mask-fill" ${r.extraction.maskFill ? 'checked' : ''} /> Fill outside irregular polygon</label>
        </div>

        <div class="inspector-section">
          <div class="section-heading"><span>Quick Stage Export</span></div>
          <div class="btn-grid-2">
            <button type="button" class="btn btn-sm stage-exp-btn" data-stage="original">Export Original</button>
            <button type="button" class="btn btn-sm stage-exp-btn" data-stage="perspective">Export Perspective</button>
            <button type="button" class="btn btn-sm stage-exp-btn" data-stage="seamless">Export Seamless</button>
            <button type="button" class="btn btn-sm stage-exp-btn" data-stage="final">Export Final</button>
          </div>
        </div>
      `;
    } else if (state.inspectorTab === 'seamless') {
      tabBody = `
        <div class="inspector-section">
          <div class="section-heading"><span>Seamless Generation</span></div>
          <label class="check-label"><input type="checkbox" id="seam-enabled" ${r.seamless.enabled ? 'checked' : ''} /> Enable seamless synthesis</label>
          <div class="prop-row">
            <span class="prop-label">Algorithm</span>
            <select id="seam-method" class="select" style="width:165px">
              <option value="collage" ${r.seamless.method === 'collage' ? 'selected' : ''}>A: Smoothed Collage</option>
              <option value="scattered" ${r.seamless.method === 'scattered' ? 'selected' : ''}>B: Scattered Edges</option>
              <option value="offset" ${r.seamless.method === 'offset' ? 'selected' : ''}>C: Offset &amp; Blend</option>
              <option value="mirror" ${r.seamless.method === 'mirror' ? 'selected' : ''}>D: Mirror &amp; Blend</option>
              <option value="clone" ${r.seamless.method === 'clone' ? 'selected' : ''}>E: Clone Seam Repair</option>
            </select>
          </div>
          ${this._sliderHtml('seam-blending', 'Seam Blending', r.seamless.seamBlending, 0, 100, '%')}
          ${this._sliderHtml('seam-width', 'Blend Width', r.seamless.blendWidth, 5, 45, '%')}
          ${this._sliderHtml('seam-smooth', 'Edge Smoothing', r.seamless.edgeSmoothing, 0, 100, '%')}
          ${this._sliderHtml('seam-random', 'Randomization', r.seamless.randomization, 0, 100, '%')}
          ${this._sliderHtml('seam-strength', 'Blend Strength', r.seamless.blendStrength, 0, 100, '%')}
          <div class="prop-row">
            <span class="prop-label">Seed</span>
            <input type="number" id="seam-seed" class="input input-num" value="${r.seamless.seed}" />
          </div>
          <div class="btn-grid-2">
            <button type="button" class="btn btn-sm" id="seam-randomize">Randomize</button>
            <button type="button" class="btn btn-sm" id="seam-reset">Reset</button>
            <button type="button" class="btn btn-sm btn-primary" id="seam-generate">Generate</button>
            <button type="button" class="btn btn-sm" id="seam-clear-clone">Clear Clones (${r.clonePatches.length})</button>
          </div>
        </div>
      `;
    } else if (state.inspectorTab === 'detail') {
      tabBody = `
        <div class="inspector-section">
          <div class="section-heading"><span>Detail Restoration</span></div>
          ${this._sliderHtml('det-strength', 'Detail Restoration', r.detail.strength, 0, 150, '%')}
          ${this._sliderHtml('det-sharp', 'Texture Sharpness', r.detail.sharpness, 0, 150, '%')}
          ${this._sliderHtml('det-edge', 'Edge Preservation', r.detail.edgePreserve, 0, 100, '%')}
          ${this._sliderHtml('det-grain', 'Fine Grain Preserve', r.detail.grain, 0, 100, '%')}
          ${this._sliderHtml('det-noise', 'Noise Reduction', r.detail.noiseReduce, 0, 100, '%')}
          ${this._sliderHtml('det-local', 'Local Contrast', r.detail.localContrast, 0, 100, '%')}
        </div>

        <div class="inspector-section">
          <div class="section-heading"><span>Lighting &amp; Color Correction</span></div>
          ${this._sliderHtml('col-lighting', 'Lighting Correction', r.color.lighting, 0, 100, '%')}
          ${this._sliderHtml('col-contrast', 'Contrast Enhancement', r.color.contrast, -50, 80, '%')}
          ${this._sliderHtml('col-r', 'Red Balance', r.color.balanceR, -50, 50, '%')}
          ${this._sliderHtml('col-g', 'Green Balance', r.color.balanceG, -50, 50, '%')}
          ${this._sliderHtml('col-b', 'Blue Balance', r.color.balanceB, -50, 50, '%')}
        </div>
      `;
    } else if (state.inspectorTab === 'pixel') {
      tabBody = `
        <div class="inspector-section">
          <div class="section-heading"><span>Pixel-Art Workflow</span></div>
          <label class="check-label"><input type="checkbox" id="px-enabled" ${r.pixelArt.enabled ? 'checked' : ''} /> Enable Pixel-Art Mode (Nearest-Neighbor + Quantize)</label>
          ${this._sliderHtml('px-colors', 'Palette Color Count', r.pixelArt.paletteCount, 2, 128, '')}
          <div class="prop-row">
            <span class="prop-label">Dithering</span>
            <select id="px-dither" class="select">
              <option value="none" ${r.pixelArt.dither === 'none' ? 'selected' : ''}>None (Crisp Flat)</option>
              <option value="bayer" ${r.pixelArt.dither === 'bayer' ? 'selected' : ''}>Ordered Bayer 4x4</option>
              <option value="floyd" ${r.pixelArt.dither === 'floyd' ? 'selected' : ''}>Floyd-Steinberg</option>
            </select>
          </div>
          <label class="check-label"><input type="checkbox" id="px-grid" ${state.view.pixelGrid ? 'checked' : ''} /> Show Pixel Grid &amp; Integer Zoom</label>
          <div class="section-heading" style="margin-top:4px"><span>Low-Resolution Presets</span></div>
          <div class="btn-grid-2">
            <button type="button" class="btn btn-sm px-res-btn" data-res="16">16 × 16</button>
            <button type="button" class="btn btn-sm px-res-btn" data-res="32">32 × 32</button>
            <button type="button" class="btn btn-sm px-res-btn" data-res="64">64 × 64</button>
            <button type="button" class="btn btn-sm px-res-btn" data-res="128">128 × 128</button>
          </div>
        </div>
      `;
    }

    return headerPreview + tabBody;
  }

  _sliderHtml(id, label, value, min, max, unit) {
    return `
      <div class="prop-slider-group">
        <div class="prop-slider-header">
          <span class="prop-label">${label}</span>
          <span class="prop-value" id="${id}-val">${value}${unit}</span>
        </div>
        <input type="range" id="${id}" class="slider" min="${min}" max="${max}" value="${value}" data-unit="${unit}" />
      </div>
    `;
  }

  _drawMiniPreview(ripper) {
    const canvas = this.el.querySelector('#insp-mini-canvas');
    if (!canvas) return;
    const rawSrc = ripper.cachedStages?.final || ripper.cachedStages?.perspective;
    if (!rawSrc) return;

    const pt = ripper.previewTransform || { offsetU: 0, offsetV: 0, repeatX: 1, repeatY: 1, applyFx: true };
    const ripFx = ensureRipperFx(ripper);
    const fxActive = pt.applyFx !== false && ((ripFx.filter && ripFx.filter !== 'none') || !!ripFx.post?.enabled);
    const src = fxActive ? applyRipperFxToCanvas(rawSrc, ripFx) : rawSrc;

    const u = Number(pt.offsetU) || 0;
    const v = Number(pt.offsetV) || 0;
    const rx = Math.max(0.25, Math.min(8, Number(pt.repeatX) || 1));
    const ry = Math.max(0.25, Math.min(8, Number(pt.repeatY) || 1));
    const hasTransform = Math.abs(u) >= 0.0005 || Math.abs(v) >= 0.0005 || Math.abs(rx - 1) >= 0.01 || Math.abs(ry - 1) >= 0.01;

    const drawSource = hasTransform
      ? renderWrappedTiledCanvas(src, u, v, rx, ry, !!ripper.pixelArt?.enabled) || src
      : src;

    canvas.width = drawSource.width;
    canvas.height = drawSource.height;
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = !ripper.pixelArt?.enabled;
    ctx.drawImage(drawSource, 0, 0);

    const xPx = Math.round(u * rawSrc.width);
    const yPx = Math.round(v * rawSrc.height);
    const info = this.el.querySelector('#insp-preview-transform-info');
    if (info) {
      info.textContent = `${rx}×${ry} · X:${xPx}px Y:${yPx}px (U:${u.toFixed(2)} V:${v.toFixed(2)})${fxActive ? ' · FX' : ''}`;
    }
    const resetBtn = this.el.querySelector('#insp-uv-reset');
    if (resetBtn) {
      resetBtn.disabled = !hasTransform;
    }
  }

  _wireLayerHandlers() {
    const body = this.el;
    body.querySelector('#layers-show-all')?.addEventListener('click', () => {
      for (const l of getRippersForActiveImage()) l.style.visible = true;
      events.emit('canvas:redrawOverlay');
      history.push('Show all selection layers');
      projectManager.scheduleAutosave();
      this.render();
    });
    body.querySelector('#layers-hide-all')?.addEventListener('click', () => {
      for (const l of getRippersForActiveImage()) l.style.visible = false;
      events.emit('canvas:redrawOverlay');
      history.push('Hide all selection layers');
      projectManager.scheduleAutosave();
      this.render();
    });

    body.querySelectorAll('.layer-row').forEach((row) => {
      row.addEventListener('click', (e) => {
        if (e.target.closest('button')) return;
        setActiveRipper(row.dataset.layerId);
        events.emit('canvas:redrawOverlay');
      });
    });

    body.querySelectorAll('[data-layer-eye]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const layer = state.rippers.find((x) => x.id === btn.dataset.layerEye);
        if (!layer) return;
        layer.style.visible = !layer.style.visible;
        events.emit('canvas:redrawOverlay');
        history.push(`${layer.style.visible ? 'Show' : 'Hide'} ${layer.name}`);
        projectManager.scheduleAutosave();
        this.render();
      });
    });

    body.querySelectorAll('[data-layer-edit]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const layer = state.rippers.find((x) => x.id === btn.dataset.layerEdit);
        if (!layer) return;
        if (!layer.style.visible) layer.style.visible = true;
        state.inspectorTab = 'selection';
        setActiveRipper(layer.id);
        setActiveTool(TOOL_IDS.VERTEX);
        events.emit('canvas:redrawOverlay');
        this.render();
        this.el.querySelector('#rip-name')?.focus();
      });
    });

    const moveLayer = (id, dir) => {
      const imgLayers = getRippersForActiveImage();
      const idx = imgLayers.findIndex((x) => x.id === id);
      const targetIdx = idx + dir;
      if (idx < 0 || targetIdx < 0 || targetIdx >= imgLayers.length) return;
      const globalA = state.rippers.indexOf(imgLayers[idx]);
      const globalB = state.rippers.indexOf(imgLayers[targetIdx]);
      if (globalA < 0 || globalB < 0) return;
      [state.rippers[globalA], state.rippers[globalB]] = [state.rippers[globalB], state.rippers[globalA]];
      events.emit('rippers:changed', state.rippers);
      events.emit('canvas:redrawOverlay');
      history.push(`Reorder ${imgLayers[idx].name}`);
      projectManager.scheduleAutosave();
    };

    body.querySelectorAll('[data-layer-up]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        moveLayer(btn.dataset.layerUp, -1);
      });
    });
    body.querySelectorAll('[data-layer-down]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        moveLayer(btn.dataset.layerDown, 1);
      });
    });
    body.querySelectorAll('[data-layer-del]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        textureManager.deleteRipper(btn.dataset.layerDel);
      });
    });
  }

  _wireEmptyHandlers() {
    this._wireLayerHandlers();
    const body = this.el;
    body.querySelector('#empty-grid-size')?.addEventListener('change', (e) => {
      state.view.gridSize = Math.max(4, Math.min(256, Number(e.target.value) || 16));
      events.emit('view:changed');
    });
    body.querySelector('#empty-snap-grid')?.addEventListener('change', (e) => {
      state.view.snapGrid = e.target.checked;
      events.emit('view:changed');
    });
    body.querySelector('#empty-snap-edge')?.addEventListener('change', (e) => {
      state.view.snapEdges = e.target.checked;
      events.emit('view:changed');
    });
  }

  _wireRipperHandlers(r) {
    const body = this.el;
    body.querySelector('#insp-float-preview')?.addEventListener('click', () => floatingPreviews.openWindow(r.id));
    body.querySelector('#insp-export-tex')?.addEventListener('click', () => exportRipperStage(r, 'final', 'png', 0.92));
    body.querySelector('#insp-uv-reset')?.addEventListener('click', () => {
      const keepFx = r.previewTransform?.applyFx ?? true;
      r.previewTransform = { offsetU: 0, offsetV: 0, repeatX: 1, repeatY: 1, applyFx: keepFx };
      this._drawMiniPreview(r);
      events.emit('preview:transformChanged', { ripperId: r.id, source: 'inspector' });
      projectManager.scheduleAutosave();
    });
    body.querySelector('#insp-cancel-job')?.addEventListener('click', () => textureManager.cancelProcess(r.id));

    const emitSeamlessSync = (rip) => {
      this._ignoreSeamlessSync = true;
      try {
        events.emit('ripper:seamlessChanged', rip);
      } finally {
        this._ignoreSeamlessSync = false;
      }
    };

    const bindSlider = (id, getter, setter, reprocess = true, seamlessSync = false) => {
      const el = body.querySelector(`#${id}`);
      const valEl = body.querySelector(`#${id}-val`);
      if (!el) return;
      el.addEventListener('input', () => {
        const v = Number(el.value);
        setter(v);
        if (valEl) valEl.textContent = `${v}${el.dataset.unit || ''}`;
        if (seamlessSync) emitSeamlessSync(r);
        if (reprocess) textureManager.scheduleProcess(r.id, 90);
        else events.emit('canvas:redrawOverlay');
      });
      el.addEventListener('change', () => {
        history.push(`Update ${id} (${r.name})`);
        projectManager.scheduleAutosave();
      });
    };

    if (state.inspectorTab === 'selection') {
      this._wireLayerHandlers();
      body.querySelector('#rip-name')?.addEventListener('change', (e) => {
        r.name = e.target.value.trim() || r.name;
        events.emit('rippers:changed', state.rippers);
        events.emit('canvas:redrawOverlay');
        history.push(`Rename ripper to ${r.name}`);
      });
      body.querySelector('#rip-category')?.addEventListener('change', (e) => {
        r.category = e.target.value;
        events.emit('rippers:changed', state.rippers);
        history.push(`Change category (${r.name})`);
      });
      body.querySelector('#rip-enabled')?.addEventListener('change', (e) => {
        r.enabled = e.target.checked;
        events.emit('rippers:changed', state.rippers);
        events.emit('canvas:redrawOverlay');
      });
      body.querySelector('#rip-duplicate')?.addEventListener('click', () => textureManager.duplicateRipper(r.id));
      body.querySelector('#rip-delete')?.addEventListener('click', () => textureManager.deleteRipper(r.id));
      body.querySelector('#rip-visible')?.addEventListener('change', (e) => {
        r.style.visible = e.target.checked;
        events.emit('canvas:redrawOverlay');
      });
      bindSlider('rip-opacity', () => r.style.opacity * 100, (v) => { r.style.opacity = v / 100; }, false);
      bindSlider('rip-outline-w', () => r.style.outlineWidth, (v) => { r.style.outlineWidth = v; }, false);
      bindSlider('rip-vertex-s', () => r.style.vertexSize, (v) => { r.style.vertexSize = v; }, false);

      body.querySelector('#rip-outline-col')?.addEventListener('input', (e) => {
        r.style.outlineColor = e.target.value;
        events.emit('canvas:redrawOverlay');
      });
      body.querySelector('#rip-fill-col')?.addEventListener('input', (e) => {
        r.style.fillColor = e.target.value;
        events.emit('canvas:redrawOverlay');
      });
      body.querySelector('#view-grid-size')?.addEventListener('change', (e) => {
        state.view.gridSize = Math.max(4, Math.min(256, Number(e.target.value) || 16));
        events.emit('view:changed');
      });
      body.querySelector('#view-snap-grid')?.addEventListener('change', (e) => {
        state.view.snapGrid = e.target.checked;
        events.emit('view:changed');
      });
      body.querySelector('#view-snap-edge')?.addEventListener('change', (e) => {
        state.view.snapEdges = e.target.checked;
        events.emit('view:changed');
      });
    } else if (state.inspectorTab === 'texture') {
      body.querySelector('#ext-mode')?.addEventListener('change', (e) => {
        r.extraction.mode = e.target.value;
        textureManager.scheduleProcess(r.id, 30);
        events.emit('canvas:redrawOverlay');
      });
      const wInput = body.querySelector('#ext-w');
      const hInput = body.querySelector('#ext-h');
      wInput?.addEventListener('change', () => {
        const w = Math.max(8, Math.min(2048, Number(wInput.value) || 64));
        r.extraction.outWidth = w;
        if (r.extraction.lockAspect) {
          r.extraction.outHeight = Math.max(8, Math.round(w / Math.max(0.1, r.extraction.aspectRatio)));
          if (hInput) hInput.value = r.extraction.outHeight;
        } else {
          r.extraction.aspectRatio = r.extraction.outWidth / Math.max(1, r.extraction.outHeight);
        }
        textureManager.scheduleProcess(r.id, 40);
      });
      hInput?.addEventListener('change', () => {
        const h = Math.max(8, Math.min(2048, Number(hInput.value) || 64));
        r.extraction.outHeight = h;
        if (r.extraction.lockAspect) {
          r.extraction.outWidth = Math.max(8, Math.round(h * Math.max(0.1, r.extraction.aspectRatio)));
          if (wInput) wInput.value = r.extraction.outWidth;
        } else {
          r.extraction.aspectRatio = r.extraction.outWidth / Math.max(1, r.extraction.outHeight);
        }
        textureManager.scheduleProcess(r.id, 40);
      });
      body.querySelector('#ext-lock')?.addEventListener('change', (e) => {
        r.extraction.lockAspect = e.target.checked;
        r.extraction.aspectRatio = r.extraction.outWidth / Math.max(1, r.extraction.outHeight);
      });
      body.querySelector('#ext-natural')?.addEventListener('click', () => {
        const nat = computeNaturalQuadSize(r.points);
        r.extraction.outWidth = Math.min(2048, nat.width);
        r.extraction.outHeight = Math.min(2048, nat.height);
        r.extraction.aspectRatio = r.extraction.outWidth / Math.max(1, r.extraction.outHeight);
        this.render();
        textureManager.scheduleProcess(r.id, 20);
      });
      body.querySelector('#ext-resample')?.addEventListener('change', (e) => {
        r.extraction.resampling = e.target.value;
        textureManager.scheduleProcess(r.id, 20);
      });
      body.querySelector('#ext-mask-fill')?.addEventListener('change', (e) => {
        r.extraction.maskFill = e.target.checked;
        textureManager.scheduleProcess(r.id, 20);
      });
      body.querySelectorAll('.stage-exp-btn').forEach((btn) => {
        btn.addEventListener('click', () => exportRipperStage(r, btn.dataset.stage, 'png', 0.92));
      });
    } else if (state.inspectorTab === 'seamless') {
      body.querySelector('#seam-enabled')?.addEventListener('change', (e) => {
        r.seamless.enabled = e.target.checked;
        emitSeamlessSync(r);
        textureManager.scheduleProcess(r.id, 20);
      });
      body.querySelector('#seam-method')?.addEventListener('change', (e) => {
        r.seamless.method = e.target.value;
        emitSeamlessSync(r);
        textureManager.scheduleProcess(r.id, 20);
        history.push(`Seamless algorithm: ${r.seamless.method}`);
      });
      bindSlider('seam-blending', () => r.seamless.seamBlending, (v) => { r.seamless.seamBlending = v; }, true, true);
      bindSlider('seam-width', () => r.seamless.blendWidth, (v) => { r.seamless.blendWidth = v; }, true, true);
      bindSlider('seam-smooth', () => r.seamless.edgeSmoothing, (v) => { r.seamless.edgeSmoothing = v; }, true, true);
      bindSlider('seam-random', () => r.seamless.randomization, (v) => { r.seamless.randomization = v; }, true, true);
      bindSlider('seam-strength', () => r.seamless.blendStrength, (v) => { r.seamless.blendStrength = v; }, true, true);
      body.querySelector('#seam-seed')?.addEventListener('change', (e) => {
        r.seamless.seed = Number(e.target.value) || 42;
        emitSeamlessSync(r);
        textureManager.scheduleProcess(r.id, 20);
      });
      body.querySelector('#seam-randomize')?.addEventListener('click', () => {
        r.seamless.seed = Math.floor(Math.random() * 99999) + 1;
        this.render();
        emitSeamlessSync(r);
        textureManager.scheduleProcess(r.id, 10);
      });
      body.querySelector('#seam-reset')?.addEventListener('click', () => {
        resetRipperSeamlessDefaults(r);
        this.render();
        emitSeamlessSync(r);
        textureManager.scheduleProcess(r.id, 10);
        history.push(`Reset seamless (${r.name})`);
      });
      body.querySelector('#seam-generate')?.addEventListener('click', () => textureManager.processNow(r.id));
      body.querySelector('#seam-clear-clone')?.addEventListener('click', () => {
        r.clonePatches = [];
        this.render();
        emitSeamlessSync(r);
        textureManager.scheduleProcess(r.id, 10);
      });
    } else if (state.inspectorTab === 'detail') {
      bindSlider('det-strength', () => r.detail.strength, (v) => { r.detail.strength = v; });
      bindSlider('det-sharp', () => r.detail.sharpness, (v) => { r.detail.sharpness = v; });
      bindSlider('det-edge', () => r.detail.edgePreserve, (v) => { r.detail.edgePreserve = v; });
      bindSlider('det-grain', () => r.detail.grain, (v) => { r.detail.grain = v; });
      bindSlider('det-noise', () => r.detail.noiseReduce, (v) => { r.detail.noiseReduce = v; });
      bindSlider('det-local', () => r.detail.localContrast, (v) => { r.detail.localContrast = v; });
      bindSlider('col-lighting', () => r.color.lighting, (v) => { r.color.lighting = v; });
      bindSlider('col-contrast', () => r.color.contrast, (v) => { r.color.contrast = v; });
      bindSlider('col-r', () => r.color.balanceR, (v) => { r.color.balanceR = v; });
      bindSlider('col-g', () => r.color.balanceG, (v) => { r.color.balanceG = v; });
      bindSlider('col-b', () => r.color.balanceB, (v) => { r.color.balanceB = v; });
    } else if (state.inspectorTab === 'pixel') {
      body.querySelector('#px-enabled')?.addEventListener('change', (e) => {
        r.pixelArt.enabled = e.target.checked;
        if (r.pixelArt.enabled) r.extraction.resampling = 'nearest';
        textureManager.scheduleProcess(r.id, 20);
      });
      bindSlider('px-colors', () => r.pixelArt.paletteCount, (v) => { r.pixelArt.paletteCount = v; });
      body.querySelector('#px-dither')?.addEventListener('change', (e) => {
        r.pixelArt.dither = e.target.value;
        textureManager.scheduleProcess(r.id, 20);
      });
      body.querySelector('#px-grid')?.addEventListener('change', (e) => {
        state.view.pixelGrid = e.target.checked;
        state.view.integerZoom = e.target.checked;
        events.emit('view:changed');
      });
      body.querySelectorAll('.px-res-btn').forEach((btn) => {
        btn.addEventListener('click', () => {
          const res = Number(btn.dataset.res);
          r.pixelArt.enabled = true;
          r.extraction.resampling = 'nearest';
          r.extraction.outWidth = res;
          r.extraction.outHeight = res;
          this.render();
          textureManager.scheduleProcess(r.id, 10);
        });
      });
    }

    // Empty state snap controls if present
    body.querySelector('#empty-grid-size')?.addEventListener('change', (e) => {
      state.view.gridSize = Math.max(4, Math.min(256, Number(e.target.value) || 16));
      events.emit('view:changed');
    });
    body.querySelector('#empty-snap-grid')?.addEventListener('change', (e) => {
      state.view.snapGrid = e.target.checked;
      events.emit('view:changed');
    });
    body.querySelector('#empty-snap-edge')?.addEventListener('change', (e) => {
      state.view.snapEdges = e.target.checked;
      events.emit('view:changed');
    });
  }
}
