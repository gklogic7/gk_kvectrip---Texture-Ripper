// Bottom Panel: Extracted Texture Library, Interactive Texture Atlas Editor (with Aspect Ratios, Free-Move Gizmo & Snap), and Processing History
import {
  state,
  getActiveRipper,
  setActiveRipper,
  setActiveImage,
  MATERIAL_CATEGORIES,
} from '../core/app-state.js';
import { events } from '../core/event-manager.js';
import { history } from '../core/history-manager.js';
import { projectManager } from '../core/project-manager.js';
import { shortcuts } from '../core/shortcuts-manager.js';
import { textureManager } from '../texture/texture-manager.js';
import { resetRipperSeamlessDefaults } from '../texture/texture-ripper.js';
import { atlasManager } from '../atlas/atlas-manager.js';
import { exportRipperStage } from '../export/image-exporter.js';
import { exportAtlasImage, exportAtlasMetadata, exportAtlasZipPackage } from '../atlas/atlas-exporter.js';
import { ICONS } from './icons.js';
import { floatingPreviews } from './preview-window.js';

export class BottomPanelUI {
  constructor() {
    this.el = document.getElementById('bottom-panel');
    this._atlasDrag = null;
    this._seDrag = null;
    this._seHoverPt = null;
    this._liveWrapDelta = null;
    this._ignoreSeamlessSync = false;
    this._navCleanups = [];
    this.render();

    events.on('rippers:changed', () => this.render());
    events.on('ripper:selected', () => this.render());
    events.on('ripper:seamlessChanged', () => {
      if (this._ignoreSeamlessSync) return;
      if (state.bottomTab === 'seamless') this.render();
    });
    events.on('ripper:processed', () => {
      if (state.bottomTab === 'library') this.render();
      else if (state.bottomTab === 'seamless') {
        this._drawSeamlessEditorPreview();
        this._updateSeamlessStatus();
      }
    });
    events.on('atlas:updated', () => {
      if (state.bottomTab === 'atlas') {
        this._drawAtlasPreview();
        this._updateAtlasStatus();
      }
    });
    events.on('history:changed', () => {
      if (state.bottomTab === 'history') this.render();
    });
    events.on('bottom:tabChanged', () => this.render());
    events.on('panel:layoutChanged', () => this.render());
  }

  _cleanupNav() {
    while (this._navCleanups.length) {
      const fn = this._navCleanups.pop();
      try {
        fn();
      } catch {
        // ignore cleanup errors
      }
    }
  }

  _clampFloatRect(rect) {
    const minW = 480;
    const minH = 220;
    const vw = Math.max(minW + 16, window.innerWidth);
    const vh = Math.max(minH + 40, window.innerHeight);
    const width = Math.max(minW, Math.min(vw - 24, rect?.width || 920));
    const height = Math.max(minH, Math.min(vh - 48, rect?.height || 400));
    const x = Math.max(8, Math.min(vw - width - 8, rect?.x ?? 56));
    const y = Math.max(32, Math.min(vh - 40, rect?.y ?? 72));
    return { x, y, width, height };
  }

  render() {
    this._cleanupNav();

    const collapsed = state.panels.bottomCollapsed;
    const mode = ['docked', 'floating', 'fullsize'].includes(state.panels.bottomMode)
      ? state.panels.bottomMode
      : state.panels.bottomExpanded
        ? 'fullsize'
        : 'docked';
    state.panels.bottomMode = mode;
    state.panels.bottomExpanded = mode === 'fullsize' && !collapsed;

    this.el.classList.toggle('collapsed', collapsed);
    const root = document.getElementById('app-root');
    root?.classList.toggle('bottom-expanded', mode === 'fullsize' && !collapsed);
    root?.classList.toggle('bottom-floating', mode === 'floating');

    if (mode === 'floating') {
      const r = this._clampFloatRect(state.panels.bottomFloatRect);
      state.panels.bottomFloatRect = r;
      this.el.style.left = `${r.x}px`;
      this.el.style.top = `${r.y}px`;
      this.el.style.width = `${r.width}px`;
      this.el.style.height = collapsed ? '' : `${r.height}px`;
    } else if (mode === 'docked') {
      this.el.style.left = '';
      this.el.style.top = '';
      this.el.style.width = '';
      this.el.style.height = collapsed ? '' : `${state.panels.bottomHeight}px`;
    } else {
      this.el.style.left = '';
      this.el.style.top = '';
      this.el.style.width = '';
      this.el.style.height = '';
    }

    this.el.innerHTML = `
      <div class="bottom-header" title="${mode === 'floating' ? 'Drag header to reposition floating window' : ''}">
        <div class="drawer-tabs" style="padding:0;border:none;background:transparent">
          <button type="button" class="tab-btn ${state.bottomTab === 'library' ? 'active' : ''}" data-btab="library">
            Extracted Textures (${state.rippers.length})
          </button>
          <button type="button" class="tab-btn ${state.bottomTab === 'seamless' ? 'active' : ''}" data-btab="seamless">
            Seamless Editor
          </button>
          <button type="button" class="tab-btn ${state.bottomTab === 'atlas' ? 'active' : ''}" data-btab="atlas">
            Texture Atlas
          </button>
          <button type="button" class="tab-btn ${state.bottomTab === 'history' ? 'active' : ''}" data-btab="history">
            Processing History (${history.entries.length})
          </button>
        </div>
        <div style="display:flex;align-items:center;gap:6px;flex-shrink:0">
          <div class="segmented-control" aria-label="Window layout mode">
            <button type="button" class="seg-btn ${mode === 'docked' ? 'active' : ''}" data-bmode="docked" title="Dock drawer to bottom of workspace">Docked</button>
            <button type="button" class="seg-btn ${mode === 'floating' ? 'active' : ''}" data-bmode="floating" title="Undock as draggable &amp; resizable floating window">Floating</button>
            <button type="button" class="seg-btn ${mode === 'fullsize' ? 'active' : ''}" data-bmode="fullsize" title="Expand across full workspace (Esc to restore)">Full Size</button>
          </div>
          <button type="button" class="btn-icon" id="btn-collapse-bottom" title="${collapsed ? 'Expand panel' : 'Shade / collapse panel'}">
            ${collapsed ? '▲' : '▼'}
          </button>
        </div>
      </div>
      <div class="bottom-content">
        ${this._renderBody()}
      </div>
      <div class="bottom-float-resize" id="bottom-float-resize" title="Drag corner to resize floating window"></div>
    `;

    this.el.querySelectorAll('[data-bmode]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const nextMode = btn.dataset.bmode;
        state.panels.bottomMode = nextMode;
        state.panels.bottomCollapsed = false;
        state.panels.bottomExpanded = nextMode === 'fullsize';
        events.emit('panel:layoutChanged');
      });
    });

    this.el.querySelector('#btn-collapse-bottom').addEventListener('click', () => {
      state.panels.bottomCollapsed = !state.panels.bottomCollapsed;
      state.panels.bottomExpanded = state.panels.bottomMode === 'fullsize' && !state.panels.bottomCollapsed;
      events.emit('panel:layoutChanged');
    });

    this.el.querySelectorAll('[data-btab]').forEach((btn) => {
      btn.addEventListener('click', () => {
        state.bottomTab = btn.dataset.btab;
        if (state.panels.bottomCollapsed) state.panels.bottomCollapsed = false;
        this.render();
        if (state.bottomTab === 'atlas') atlasManager.rebuildAtlas({ clearManual: false });
      });
    });

    // Floating window header drag
    const header = this.el.querySelector('.bottom-header');
    header?.addEventListener('pointerdown', (e) => {
      if (state.panels.bottomMode !== 'floating') return;
      if (e.button !== 0) return;
      if (e.target.closest('button, input, select, .segmented-control, .drawer-tabs')) return;
      e.preventDefault();
      const startX = e.clientX;
      const startY = e.clientY;
      const rect = state.panels.bottomFloatRect;
      const origX = rect.x;
      const origY = rect.y;
      const onMove = (me) => {
        const vw = window.innerWidth;
        const vh = window.innerHeight;
        rect.x = Math.max(8, Math.min(vw - rect.width - 8, origX + (me.clientX - startX)));
        rect.y = Math.max(32, Math.min(vh - 38, origY + (me.clientY - startY)));
        this.el.style.left = `${rect.x}px`;
        this.el.style.top = `${rect.y}px`;
      };
      const onUp = () => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
      };
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
    });

    // Floating window bottom-right corner resize
    const floatResize = this.el.querySelector('#bottom-float-resize');
    floatResize?.addEventListener('pointerdown', (e) => {
      if (state.panels.bottomMode !== 'floating' || e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      const startX = e.clientX;
      const startY = e.clientY;
      const rect = state.panels.bottomFloatRect;
      const origW = rect.width;
      const origH = rect.height;
      const onMove = (me) => {
        rect.width = Math.max(480, Math.min(window.innerWidth - rect.x - 8, origW + (me.clientX - startX)));
        rect.height = Math.max(220, Math.min(window.innerHeight - rect.y - 8, origH + (me.clientY - startY)));
        this.el.style.width = `${rect.width}px`;
        this.el.style.height = `${rect.height}px`;
      };
      const onUp = () => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
      };
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
    });

    this._wireBodyHandlers();
    if (state.bottomTab === 'atlas' && !collapsed) {
      this._drawAtlasPreview();
    } else if (state.bottomTab === 'seamless' && !collapsed) {
      this._drawSeamlessEditorPreview();
    }
  }

  _renderBody() {
    if (state.bottomTab === 'library') return this._renderLibrary();
    if (state.bottomTab === 'seamless') return this._renderSeamlessEditor();
    if (state.bottomTab === 'atlas') return this._renderAtlas();
    return this._renderHistory();
  }

  _getFilteredRippers() {
    const f = state.libraryFilter;
    const q = f.search.trim().toLowerCase();
    const list = state.rippers.filter((r) => {
      if (f.favoritesOnly && !r.favorite) return false;
      if (f.category !== 'All' && r.category !== f.category) return false;
      if (q && !r.name.toLowerCase().includes(q) && !r.category.toLowerCase().includes(q)) return false;
      return true;
    });

    if (f.sortBy === 'name') {
      list.sort((a, b) => a.name.localeCompare(b.name));
    } else if (f.sortBy === 'resolution') {
      list.sort((a, b) => b.extraction.outWidth * b.extraction.outHeight - a.extraction.outWidth * a.extraction.outHeight);
    } else {
      list.sort((a, b) => a.createdAt - b.createdAt);
    }
    return list;
  }

  _renderLibrary() {
    const f = state.libraryFilter;
    const filtered = this._getFilteredRippers();

    const cards = filtered.length
      ? filtered
          .map((r) => {
            const isSel = r.id === state.activeRipperId;
            const thumb = r.cachedStages?.thumbnailUrl;
            return `
            <div class="texture-card ${isSel ? 'selected' : ''} ${!r.enabled ? 'disabled' : ''}" data-rip-id="${r.id}">
              <div class="texture-thumb-wrap checkerboard-bg">
                ${
                  thumb
                    ? `<img src="${thumb}" alt="${r.name}" />`
                    : `<span style="font-size:10px;color:var(--text-muted)">Processing...</span>`
                }
              </div>
              <div class="texture-card-meta">
                <span class="texture-card-name" title="${r.name}">${r.name}</span>
                <button type="button" class="btn-icon lib-fav" data-fav="${r.id}" title="Favorite">${r.favorite ? ICONS.starFilled : ICONS.star}</button>
              </div>
              <div class="texture-card-sub">
                <span>${r.category}</span>
                <span>·</span>
                <span class="mono">${r.extraction.outWidth}×${r.extraction.outHeight}</span>
              </div>
              <div class="texture-card-actions">
                <button type="button" class="btn-icon lib-toggle" data-toggle="${r.id}" title="${r.enabled ? 'Disable' : 'Enable'}">${r.enabled ? ICONS.eye : ICONS.eyeOff}</button>
                <button type="button" class="btn-icon lib-prev" data-prev="${r.id}" title="Open floating preview">${ICONS.preview}</button>
                <button type="button" class="btn-icon lib-dup" data-dup="${r.id}" title="Duplicate">${ICONS.duplicate}</button>
                <button type="button" class="btn-icon lib-exp" data-exp="${r.id}" title="Export PNG">${ICONS.export}</button>
                <button type="button" class="btn-icon lib-del" data-del="${r.id}" title="Delete">${ICONS.trash}</button>
              </div>
            </div>`;
          })
          .join('')
      : `<div class="empty-state-inline" style="grid-column:1/-1">No extracted textures match the current filter. Draw a polygon on an imported image to extract your first material.</div>`;

    return `
      <div class="library-toolbar">
        <input type="search" id="lib-search" class="input" placeholder="Search textures..." value="${f.search}" style="width:170px" />
        <select id="lib-cat" class="select">
          <option value="All" ${f.category === 'All' ? 'selected' : ''}>All Materials</option>
          ${MATERIAL_CATEGORIES.map((c) => `<option value="${c}" ${f.category === c ? 'selected' : ''}>${c}</option>`).join('')}
        </select>
        <select id="lib-sort" class="select">
          <option value="created" ${f.sortBy === 'created' ? 'selected' : ''}>Sort: Created</option>
          <option value="name" ${f.sortBy === 'name' ? 'selected' : ''}>Sort: Name</option>
          <option value="resolution" ${f.sortBy === 'resolution' ? 'selected' : ''}>Sort: Resolution</option>
        </select>
        <label class="check-label"><input type="checkbox" id="lib-favs" ${f.favoritesOnly ? 'checked' : ''} /> Favorites only</label>
      </div>
      <div class="library-grid">${cards}</div>
    `;
  }

  _formatAtlasStatus() {
    const a = state.atlas;
    const res = a.packedResult;
    if (!res) return 'No textures packed';
    let base = `${res.width}×${res.height} · Ratio: ${a.aspectRatio} · Efficiency ${res.efficiency}% · ${res.placements.length} packed`;
    if (a.freeMoveGizmo && a.selectedPlacementId) {
      const sel = res.placements.find((p) => p.ripperId === a.selectedPlacementId);
      if (sel) {
        base += ` · [${sel.name}] X:${Math.round(sel.x)} Y:${Math.round(sel.y)} ${sel.innerW}×${sel.innerH} ${Math.round(sel.angleDeg || 0)}°`;
      }
    }
    return base;
  }

  _updateAtlasStatus() {
    const el = this.el.querySelector('#atlas-status-readout');
    if (el) el.textContent = this._formatAtlasStatus();
  }

  _renderAtlas() {
    const a = state.atlas;
    const items = atlasManager.getActiveItems();

    return `
      <div class="atlas-workspace">
        <div class="atlas-sidebar">
          <div class="section-heading">
            <span>Packing Settings</span>
            <button type="button" class="btn btn-sm btn-primary" id="atl-rebuild">Regenerate</button>
          </div>
          <div class="prop-row">
            <span class="prop-label">Algorithm</span>
            <select id="atl-algo" class="select">
              <option value="maxrects" ${a.algorithm === 'maxrects' ? 'selected' : ''}>MaxRects</option>
              <option value="shelf" ${a.algorithm === 'shelf' ? 'selected' : ''}>Shelf Packing</option>
              <option value="guillotine" ${a.algorithm === 'guillotine' ? 'selected' : ''}>Guillotine</option>
            </select>
          </div>
          <div class="prop-row">
            <span class="prop-label">Aspect Ratio</span>
            <select id="atl-ratio" class="select">
              <option value="auto" ${a.aspectRatio === 'auto' ? 'selected' : ''}>Auto (Free)</option>
              <option value="1:1" ${a.aspectRatio === '1:1' ? 'selected' : ''}>1:1 (Square)</option>
              <option value="16:9" ${a.aspectRatio === '16:9' ? 'selected' : ''}>16:9 (Landscape)</option>
              <option value="9:16" ${a.aspectRatio === '9:16' ? 'selected' : ''}>9:16 (Portrait)</option>
              <option value="4:3" ${a.aspectRatio === '4:3' ? 'selected' : ''}>4:3</option>
              <option value="3:4" ${a.aspectRatio === '3:4' ? 'selected' : ''}>3:4</option>
            </select>
          </div>
          <div class="btn-grid-2">
            <label class="prop-row"><span class="prop-label">Max W</span><input type="number" id="atl-maxw" class="input input-num" min="128" max="4096" step="64" value="${a.maxWidth}" /></label>
            <label class="prop-row"><span class="prop-label">Max H</span><input type="number" id="atl-maxh" class="input input-num" min="128" max="4096" step="64" value="${a.maxHeight}" /></label>
            <label class="prop-row"><span class="prop-label">Pad</span><input type="number" id="atl-pad" class="input input-num" min="0" max="64" value="${a.padding}" /></label>
            <label class="prop-row"><span class="prop-label">Space</span><input type="number" id="atl-space" class="input input-num" min="0" max="64" value="${a.spacing}" /></label>
          </div>
          <div class="btn-grid-2">
            <label class="check-label"><input type="checkbox" id="atl-rot" ${a.allowRotate ? 'checked' : ''} /> Rotate</label>
            <label class="check-label"><input type="checkbox" id="atl-pot" ${a.powerOfTwo ? 'checked' : ''} /> Power of 2</label>
            <label class="check-label"><input type="checkbox" id="atl-auto" ${a.autoSize ? 'checked' : ''} /> Auto-size</label>
            <label class="check-label" title="Enable Move, Scale & Rotate Gizmo on Atlas canvas">
              <input type="checkbox" id="atl-gizmo" ${a.freeMoveGizmo ? 'checked' : ''} /> Free Move Gizmo
            </label>
          </div>
          <div class="prop-row">
            <label class="check-label" title="Snap to Atlas Grid and Neighbor Texture Edges">
              <input type="checkbox" id="atl-snap" ${a.snapEnabled ? 'checked' : ''} /> Snap (Grid + Edges)
            </label>
            <input type="number" id="atl-snap-grid" class="input input-num" min="2" max="128" value="${a.snapGridSize}" style="width:52px" title="Snap grid size (px)" />
          </div>
          <div class="prop-row">
            <label class="check-label"><input type="checkbox" id="atl-trans" ${a.transparent ? 'checked' : ''} /> Transparent BG</label>
            <input type="color" id="atl-bg" class="color-swatch" value="${a.bgColor}" ${a.transparent ? 'disabled' : ''} />
          </div>
          <div class="btn-grid-3">
            <label class="check-label"><input type="checkbox" id="atl-bounds" ${a.showBounds ? 'checked' : ''} /> Bounds</label>
            <label class="check-label"><input type="checkbox" id="atl-names" ${a.showNames ? 'checked' : ''} /> Names</label>
            <label class="check-label"><input type="checkbox" id="atl-uvs" ${a.showUVs ? 'checked' : ''} /> UVs</label>
          </div>
          <div class="btn-grid-3">
            <button type="button" class="btn btn-sm" id="atl-exp-img">Atlas PNG</button>
            <button type="button" class="btn btn-sm" id="atl-exp-json">JSON UV</button>
            <button type="button" class="btn btn-sm btn-primary" id="atl-exp-zip">ZIP Pack</button>
          </div>
          <div class="section-heading" style="margin-top:4px"><span>Included Textures (${items.length})</span></div>
          <div class="atlas-item-list">
            ${items
              .map((it, idx) => {
                const cfg = state.atlas.items.find((x) => x.ripperId === it.ripperId);
                return `
                <div class="atlas-item-row">
                  <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:90px">${it.name}</span>
                  <div style="display:flex;align-items:center;gap:4px">
                    <input type="number" class="input input-num atl-item-scale" data-id="${it.ripperId}" min="0.25" max="4" step="0.25" value="${cfg?.scale || 1}" style="width:48px;height:20px" title="Scale multiplier" ${cfg?.locked ? 'disabled' : ''} />
                    <button type="button" class="btn btn-sm atl-item-lock ${cfg?.locked ? 'btn-primary' : ''}" data-id="${it.ripperId}" title="Lock size">${cfg?.locked ? 'Lock' : 'Free'}</button>
                    <button type="button" class="btn btn-sm atl-item-up" data-idx="${idx}" title="Move earlier">↑</button>
                  </div>
                </div>`;
              })
              .join('')}
          </div>
        </div>
        <div class="nav-preview-shell">
          ${this._renderNavPreviewToolbar('atl', 'atlas-status-readout', this._formatAtlasStatus())}
          <div class="nav-preview-stage checkerboard-bg" id="atl-nav-stage">
            <canvas id="atlas-preview-canvas"></canvas>
          </div>
        </div>
      </div>
    `;
  }

  _renderNavPreviewToolbar(prefix, statusId, statusText) {
    return `
      <div class="nav-preview-bar">
        <div class="mono nav-preview-status" id="${statusId}">${statusText}</div>
        <div class="nav-preview-controls">
          <button type="button" class="btn btn-sm" id="${prefix}-nav-pan" title="Toggle Pan mode (or hold Space / Middle-Mouse drag)">Pan</button>
          <button type="button" class="btn btn-sm" id="${prefix}-nav-out" title="Zoom Out">−</button>
          <button type="button" class="btn btn-sm" id="${prefix}-nav-fit" title="Fit Preview to Viewport">Fit</button>
          <button type="button" class="btn btn-sm" id="${prefix}-nav-100" title="Zoom 100% (1:1 pixels)">100%</button>
          <button type="button" class="btn btn-sm" id="${prefix}-nav-in" title="Zoom In">+</button>
          <span class="mono nav-zoom-readout" id="${prefix}-nav-zoom">100%</span>
        </div>
      </div>
    `;
  }

  _fitViewToStage(stageEl, canvas, view) {
    const sw = stageEl.clientWidth;
    const sh = stageEl.clientHeight;
    if (sw <= 0 || sh <= 0 || !canvas.width || !canvas.height) return;
    const pad = 16;
    const fitZoom = Math.max(0.12, Math.min(4, Math.min((sw - pad * 2) / canvas.width, (sh - pad * 2) / canvas.height)));
    view.zoom = fitZoom;
    view.panX = Math.round((sw - canvas.width * fitZoom) / 2);
    view.panY = Math.round((sh - canvas.height * fitZoom) / 2);
    view.isFit = true;
  }

  _applyNavTransform(stageEl, canvas, view, prefix, isPixelated = false) {
    if (!stageEl || !canvas) return;
    if (view.isFit) {
      this._fitViewToStage(stageEl, canvas, view);
    }
    canvas.style.transform = `translate(${view.panX}px, ${view.panY}px) scale(${view.zoom})`;
    canvas.style.imageRendering = isPixelated || view.zoom >= 2 ? 'pixelated' : 'auto';

    const zoomEl = this.el.querySelector(`#${prefix}-nav-zoom`);
    if (zoomEl) zoomEl.textContent = `${Math.round(view.zoom * 100)}%`;

    const panBtn = this.el.querySelector(`#${prefix}-nav-pan`);
    if (panBtn) panBtn.classList.toggle('btn-primary', !!view.panMode);

    const fitBtn = this.el.querySelector(`#${prefix}-nav-fit`);
    if (fitBtn) fitBtn.classList.toggle('btn-primary', !!view.isFit);

    const z100Btn = this.el.querySelector(`#${prefix}-nav-100`);
    if (z100Btn) z100Btn.classList.toggle('btn-primary', !view.isFit && Math.abs(view.zoom - 1) < 0.01);
  }

  _initNavigableStage({ stageEl, canvas, view, prefix, isPixelated, getToolCursor, onDown, onMove, onUp, onLeave }) {
    if (!stageEl || !canvas) return;

    const getPixelFlag = () => (typeof isPixelated === 'function' ? isPixelated() : !!isPixelated);
    const apply = () => this._applyNavTransform(stageEl, canvas, view, prefix, getPixelFlag());

    const zoomAt = (nextZoom, clientX = null, clientY = null) => {
      const clamped = Math.max(0.12, Math.min(12, nextZoom));
      const rect = stageEl.getBoundingClientRect();
      const sx = clientX == null ? rect.width / 2 : clientX - rect.left;
      const sy = clientY == null ? rect.height / 2 : clientY - rect.top;
      const wx = (sx - view.panX) / Math.max(0.01, view.zoom);
      const wy = (sy - view.panY) / Math.max(0.01, view.zoom);
      view.zoom = clamped;
      view.isFit = false;
      view.panX = sx - wx * clamped;
      view.panY = sy - wy * clamped;
      apply();
    };

    const clientToCanvas = (clientX, clientY) => {
      const rect = stageEl.getBoundingClientRect();
      return {
        x: (clientX - rect.left - view.panX) / Math.max(0.01, view.zoom),
        y: (clientY - rect.top - view.panY) / Math.max(0.01, view.zoom),
      };
    };

    let panDrag = null;
    const syncCursor = (pt) => {
      if (panDrag) {
        stageEl.style.cursor = 'grabbing';
      } else if (view.panMode || shortcuts.spacePressed) {
        stageEl.style.cursor = 'grab';
      } else {
        stageEl.style.cursor = getToolCursor ? getToolCursor(pt) : 'default';
      }
    };

    this.el.querySelector(`#${prefix}-nav-pan`)?.addEventListener('click', () => {
      view.panMode = !view.panMode;
      apply();
      syncCursor(null);
    });
    this.el.querySelector(`#${prefix}-nav-out`)?.addEventListener('click', () => zoomAt(view.zoom / 1.25));
    this.el.querySelector(`#${prefix}-nav-in`)?.addEventListener('click', () => zoomAt(view.zoom * 1.25));
    this.el.querySelector(`#${prefix}-nav-fit`)?.addEventListener('click', () => {
      view.isFit = true;
      apply();
    });
    this.el.querySelector(`#${prefix}-nav-100`)?.addEventListener('click', () => {
      view.isFit = false;
      view.zoom = 1;
      view.panX = Math.round((stageEl.clientWidth - canvas.width) / 2);
      view.panY = Math.round((stageEl.clientHeight - canvas.height) / 2);
      apply();
    });

    stageEl.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        const sensitivity = e.ctrlKey ? 0.01 : 0.0018;
        const factor = Math.max(0.5, Math.min(2, Math.exp(-e.deltaY * sensitivity)));
        zoomAt(view.zoom * factor, e.clientX, e.clientY);
      },
      { passive: false }
    );

    stageEl.addEventListener('pointerdown', (e) => {
      const isPanGesture = e.button === 1 || (e.button === 0 && (view.panMode || shortcuts.spacePressed));
      if (isPanGesture) {
        e.preventDefault();
        view.isFit = false;
        panDrag = {
          startX: e.clientX,
          startY: e.clientY,
          origPanX: view.panX,
          origPanY: view.panY,
        };
        stageEl.setPointerCapture(e.pointerId);
        syncCursor(null);
        apply();
        return;
      }

      const pt = clientToCanvas(e.clientX, e.clientY);
      if (onDown && onDown(e, pt, stageEl)) {
        stageEl.setPointerCapture(e.pointerId);
      }
      syncCursor(pt);
    });

    stageEl.addEventListener('pointermove', (e) => {
      if (panDrag) {
        view.panX = panDrag.origPanX + (e.clientX - panDrag.startX);
        view.panY = panDrag.origPanY + (e.clientY - panDrag.startY);
        apply();
        return;
      }
      const pt = clientToCanvas(e.clientX, e.clientY);
      onMove?.(e, pt, stageEl);
      syncCursor(pt);
    });

    const endStagePointer = (e) => {
      if (panDrag) {
        panDrag = null;
        syncCursor(null);
        return;
      }
      onUp?.(e, stageEl);
      syncCursor(null);
    };

    stageEl.addEventListener('pointerup', endStagePointer);
    stageEl.addEventListener('pointercancel', endStagePointer);
    stageEl.addEventListener('pointerleave', () => {
      if (!panDrag) onLeave?.();
    });
    stageEl.addEventListener('contextmenu', (e) => e.preventDefault());

    const offSpace = events.on('viewport:space', () => syncCursor(null));
    this._navCleanups.push(offSpace);

    if (typeof ResizeObserver !== 'undefined') {
      const ro = new ResizeObserver(() => {
        if (view.isFit) apply();
      });
      ro.observe(stageEl);
      this._navCleanups.push(() => ro.disconnect());
    }

    syncCursor(null);
    apply();
  }

  _getSeamlessRipper() {
    return getActiveRipper() || state.rippers[0] || null;
  }

  _formatSeamlessStatus(r) {
    if (!r) return 'No extracted texture available — trace a polygon on an image first';
    const se = state.seamlessEditor;
    const offX = Math.round((r.seamless.offsetX || 0) * r.extraction.outWidth);
    const offY = Math.round((r.seamless.offsetY || 0) * r.extraction.outHeight);
    return `${r.name} · ${r.extraction.outWidth}×${r.extraction.outHeight} · ${se.tileCount}×${se.tileCount} Tiled · Wrap (${offX}px, ${offY}px) · Patches: ${r.clonePatches.length}`;
  }

  _updateSeamlessStatus() {
    const el = this.el.querySelector('#se-status-readout');
    if (el) el.textContent = this._formatSeamlessStatus(this._getSeamlessRipper());
  }

  _renderSeamlessSlider(id, label, value, min, max, unit) {
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

  _renderSeamlessEditor() {
    const r = this._getSeamlessRipper();
    if (!r) {
      return `
        <div class="empty-state-inline">
          No extracted textures available for Seamless Editing. Import a reference image and trace a polygon selection first.
        </div>
      `;
    }

    const se = state.seamlessEditor;
    const offX = Math.round((r.seamless.offsetX || 0) * 100);
    const offY = Math.round((r.seamless.offsetY || 0) * 100);

    return `
      <div class="atlas-workspace">
        <div class="atlas-sidebar">
          <div class="section-heading">
            <span>Seamless Editor</span>
            <button type="button" class="btn btn-sm btn-primary" id="se-generate">Generate</button>
          </div>
          <div class="prop-row">
            <span class="prop-label">Target Texture</span>
            <select id="se-ripper-select" class="select" style="width:155px">
              ${state.rippers.map((it) => `<option value="${it.id}" ${it.id === r.id ? 'selected' : ''}>${it.name}</option>`).join('')}
            </select>
          </div>
          <div class="btn-grid-3">
            <button type="button" class="btn btn-sm" id="se-randomize" title="Randomize seamless seed">Randomize</button>
            <button type="button" class="btn btn-sm" id="se-reset" title="Reset seamless defaults">Reset</button>
            <button type="button" class="btn btn-sm" id="se-reset-offset" title="Reset wrap offset to (0, 0)">Center</button>
          </div>

          <div class="section-heading" style="margin-top:2px"><span>Canvas Tool</span></div>
          <div class="segmented-control">
            <button type="button" class="seg-btn ${se.tool === 'offset' ? 'active' : ''}" data-se-tool="offset">Wrap-Offset</button>
            <button type="button" class="seg-btn ${se.tool === 'clone' ? 'active' : ''}" data-se-tool="clone">Clone-Stamp</button>
          </div>

          ${
            se.tool === 'clone'
              ? `
            <p style="margin:0;font-size:10px;color:var(--text-muted)">Shift+Click canvas to set source crosshair · Drag across seams to paint wrapped patches.</p>
            ${this._renderSeamlessSlider('se-brush-rad', 'Brush Radius', se.brushRadius, 4, 48, 'px')}
            ${this._renderSeamlessSlider('se-brush-str', 'Brush Strength', Math.round(se.brushStrength * 100), 20, 100, '%')}
            <div class="btn-grid-2">
              <button type="button" class="btn btn-sm" id="se-undo-patch" ${r.clonePatches.length ? '' : 'disabled'}>Undo Patch</button>
              <button type="button" class="btn btn-sm" id="se-clear-clone" ${r.clonePatches.length ? '' : 'disabled'}>Clear (${r.clonePatches.length})</button>
            </div>
          `
              : `
            <p style="margin:0;font-size:10px;color:var(--text-muted)">Drag tiled canvas to wrap borders into view. Current wrap: <span class="mono">${offX}%, ${offY}%</span></p>
          `
          }

          <div class="section-heading" style="margin-top:2px"><span>Tiled Preview &amp; Guides</span></div>
          <div class="prop-row">
            <span class="prop-label">Tiling</span>
            <div class="segmented-control" style="width:140px">
              <button type="button" class="seg-btn ${se.tileCount === 1 ? 'active' : ''}" data-se-tile="1">1×1</button>
              <button type="button" class="seg-btn ${se.tileCount === 2 ? 'active' : ''}" data-se-tile="2">2×2</button>
              <button type="button" class="seg-btn ${se.tileCount === 3 ? 'active' : ''}" data-se-tile="3">3×3</button>
            </div>
          </div>
          <div class="prop-row">
            <span class="prop-label">Stage</span>
            <select id="se-stage" class="select" style="width:140px">
              <option value="seamless" ${se.stagePreview === 'seamless' ? 'selected' : ''}>Seamless Output</option>
              <option value="final" ${se.stagePreview === 'final' ? 'selected' : ''}>Final (Detail+Color)</option>
            </select>
          </div>
          <div class="btn-grid-2">
            <label class="check-label"><input type="checkbox" id="se-guides" ${se.showGuides ? 'checked' : ''} /> Seam Guides</label>
            <label class="check-label"><input type="checkbox" id="se-split" ${se.splitCompare ? 'checked' : ''} /> Split Compare</label>
          </div>
          ${
            se.splitCompare
              ? this._renderSeamlessSlider('se-split-ratio', 'Compare Split', Math.round(se.splitRatio * 100), 5, 95, '%')
              : ''
          }

          <div class="section-heading" style="margin-top:2px"><span>Seamless Parameters</span></div>
          <label class="check-label"><input type="checkbox" id="se-enabled" ${r.seamless.enabled ? 'checked' : ''} /> Enable seamless synthesis</label>
          <div class="prop-row">
            <span class="prop-label">Algorithm</span>
            <select id="se-method" class="select" style="width:155px">
              <option value="collage" ${r.seamless.method === 'collage' ? 'selected' : ''}>A: Smoothed Collage</option>
              <option value="scattered" ${r.seamless.method === 'scattered' ? 'selected' : ''}>B: Scattered Edges</option>
              <option value="offset" ${r.seamless.method === 'offset' ? 'selected' : ''}>C: Offset &amp; Blend</option>
              <option value="mirror" ${r.seamless.method === 'mirror' ? 'selected' : ''}>D: Mirror &amp; Blend</option>
              <option value="clone" ${r.seamless.method === 'clone' ? 'selected' : ''}>E: Clone Seam Repair</option>
            </select>
          </div>
          ${this._renderSeamlessSlider('se-blending', 'Seam Blending', r.seamless.seamBlending, 0, 100, '%')}
          ${this._renderSeamlessSlider('se-width', 'Blend Width', r.seamless.blendWidth, 5, 45, '%')}
          ${this._renderSeamlessSlider('se-smooth', 'Edge Smoothing', r.seamless.edgeSmoothing, 0, 100, '%')}
          ${this._renderSeamlessSlider('se-random', 'Randomization', r.seamless.randomization, 0, 100, '%')}
          ${this._renderSeamlessSlider('se-strength', 'Blend Strength', r.seamless.blendStrength, 0, 100, '%')}
          <div class="prop-row">
            <span class="prop-label">Seed</span>
            <input type="number" id="se-seed" class="input input-num" value="${r.seamless.seed}" />
          </div>
        </div>
        <div class="nav-preview-shell">
          ${this._renderNavPreviewToolbar('se', 'se-status-readout', this._formatSeamlessStatus(r))}
          <div class="nav-preview-stage checkerboard-bg" id="se-nav-stage">
            <canvas id="seamless-editor-canvas"></canvas>
          </div>
        </div>
      </div>
    `;
  }

  _drawWrappedTile(ctx, srcCanvas, dx, dy, tw, th, normOffX, normOffY) {
    const ox = (((normOffX % 1) + 1) % 1) * tw;
    const oy = (((normOffY % 1) + 1) % 1) * th;
    ctx.save();
    ctx.beginPath();
    ctx.rect(dx, dy, tw, th);
    ctx.clip();
    for (let sx = -1; sx <= 1; sx++) {
      for (let sy = -1; sy <= 1; sy++) {
        const px = dx + ox + sx * tw;
        const py = dy + oy + sy * th;
        if (px + tw < dx || px > dx + tw || py + th < dy || py > dy + th) continue;
        ctx.drawImage(srcCanvas, px, py, tw, th);
      }
    }
    ctx.restore();
  }

  _drawSeamlessEditorPreview() {
    const canvas = this.el.querySelector('#seamless-editor-canvas');
    if (!canvas) return;
    const r = this._getSeamlessRipper();
    const ctx = canvas.getContext('2d');
    if (!r) return;

    const se = state.seamlessEditor;
    const tiles = se.tileCount || 2;
    const mainSrc =
      se.stagePreview === 'final'
        ? r.cachedStages?.final || r.cachedStages?.seamless || r.cachedStages?.perspective
        : r.cachedStages?.seamless || r.cachedStages?.final || r.cachedStages?.perspective;
    const rawSrc = r.cachedStages?.perspective || mainSrc;

    if (!mainSrc) {
      canvas.width = 256;
      canvas.height = 128;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      const stage = this.el.querySelector('#se-nav-stage');
      if (stage) this._applyNavTransform(stage, canvas, se.view, 'se', !!r.pixelArt?.enabled);
      return;
    }

    const scale = Math.min(1, 720 / (Math.max(mainSrc.width, mainSrc.height) * tiles));
    const tileW = Math.max(16, Math.round(mainSrc.width * scale));
    const tileH = Math.max(16, Math.round(mainSrc.height * scale));
    canvas.width = tileW * tiles;
    canvas.height = tileH * tiles;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.imageSmoothingEnabled = !r.pixelArt?.enabled;

    const liveDx = this._liveWrapDelta ? this._liveWrapDelta.x : 0;
    const liveDy = this._liveWrapDelta ? this._liveWrapDelta.y : 0;

    if (se.splitCompare && rawSrc) {
      const splitX = Math.round(canvas.width * se.splitRatio);
      // Left: Raw Perspective
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, 0, splitX, canvas.height);
      ctx.clip();
      for (let ty = 0; ty < tiles; ty++) {
        for (let tx = 0; tx < tiles; tx++) {
          this._drawWrappedTile(
            ctx,
            rawSrc,
            tx * tileW,
            ty * tileH,
            tileW,
            tileH,
            r.seamless.offsetX || 0,
            r.seamless.offsetY || 0
          );
        }
      }
      ctx.restore();

      // Right: Seamless Result
      ctx.save();
      ctx.beginPath();
      ctx.rect(splitX, 0, canvas.width - splitX, canvas.height);
      ctx.clip();
      for (let ty = 0; ty < tiles; ty++) {
        for (let tx = 0; tx < tiles; tx++) {
          this._drawWrappedTile(ctx, mainSrc, tx * tileW, ty * tileH, tileW, tileH, liveDx, liveDy);
        }
      }
      ctx.restore();

      // Split Divider & Labels
      ctx.save();
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(splitX, 0);
      ctx.lineTo(splitX, canvas.height);
      ctx.stroke();

      ctx.fillStyle = '#3b82f6';
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(splitX, canvas.height / 2, 7, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

      ctx.font = '600 10px "JetBrains Mono", monospace';
      ctx.fillStyle = 'rgba(15, 23, 42, 0.78)';
      ctx.fillRect(6, 6, 36, 16);
      ctx.fillRect(canvas.width - 66, 6, 60, 16);
      ctx.fillStyle = '#ffffff';
      ctx.fillText('RAW', 11, 17);
      ctx.fillText('SEAMLESS', canvas.width - 61, 17);
      ctx.restore();
    } else {
      for (let ty = 0; ty < tiles; ty++) {
        for (let tx = 0; tx < tiles; tx++) {
          this._drawWrappedTile(ctx, mainSrc, tx * tileW, ty * tileH, tileW, tileH, liveDx, liveDy);
        }
      }
    }

    // Seam Guides (Tile boundaries + subtle cross center)
    if (se.showGuides && tiles > 1) {
      ctx.save();
      ctx.strokeStyle = 'rgba(56, 189, 248, 0.85)';
      ctx.lineWidth = 1;
      ctx.setLineDash([5, 4]);
      for (let i = 1; i < tiles; i++) {
        const gx = i * tileW + 0.5;
        const gy = i * tileH + 0.5;
        ctx.beginPath();
        ctx.moveTo(gx, 0);
        ctx.lineTo(gx, canvas.height);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(0, gy);
        ctx.lineTo(canvas.width, gy);
        ctx.stroke();
      }
      ctx.restore();
    }

    // Clone-Stamp Source Crosshair & Brush Ring
    if (se.tool === 'clone') {
      ctx.save();
      for (let ty = 0; ty < tiles; ty++) {
        for (let tx = 0; tx < tiles; tx++) {
          const sx = (tx + se.cloneSource.x) * tileW;
          const sy = (ty + se.cloneSource.y) * tileH;
          ctx.strokeStyle = '#f59e0b';
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.moveTo(sx - 6, sy);
          ctx.lineTo(sx + 6, sy);
          ctx.moveTo(sx, sy - 6);
          ctx.lineTo(sx, sy + 6);
          ctx.stroke();
          ctx.beginPath();
          ctx.arc(sx, sy, 4, 0, Math.PI * 2);
          ctx.stroke();
        }
      }

      if (this._seHoverPt) {
        const radiusPx = Math.max(3, (se.brushRadius / Math.max(1, mainSrc.width)) * tileW);
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)';
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.arc(this._seHoverPt.x, this._seHoverPt.y, radiusPx, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.restore();
    }

    const stage = this.el.querySelector('#se-nav-stage');
    if (stage) {
      this._applyNavTransform(stage, canvas, se.view, 'se', !!r.pixelArt?.enabled);
    }
  }

  _wireSeamlessEditorCanvas(canvas) {
    const stageEl = this.el.querySelector('#se-nav-stage');
    if (!stageEl) return;

    const getTileMetrics = () => {
      const tiles = state.seamlessEditor.tileCount || 2;
      const tileW = canvas.width / tiles;
      const tileH = canvas.height / tiles;
      return { tiles, tileW, tileH };
    };

    const endDrag = () => {
      if (!this._seDrag) return;
      const d = this._seDrag;
      this._seDrag = null;
      this._liveWrapDelta = null;

      if (d.mode === 'offset') {
        textureManager.processNow(d.ripper.id);
        this._emitSeamlessSync(d.ripper);
        history.push(`Seamless wrap offset (${d.ripper.name})`);
        projectManager.scheduleAutosave();
      } else if (d.mode === 'clone') {
        textureManager.processNow(d.ripper.id);
        this._emitSeamlessSync(d.ripper);
        const clrBtn = this.el.querySelector('#se-clear-clone');
        const undoBtn = this.el.querySelector('#se-undo-patch');
        if (clrBtn) {
          clrBtn.disabled = d.ripper.clonePatches.length === 0;
          clrBtn.textContent = `Clear (${d.ripper.clonePatches.length})`;
        }
        if (undoBtn) undoBtn.disabled = d.ripper.clonePatches.length === 0;
        history.push(`Clone seam stroke (${d.ripper.name})`);
        projectManager.scheduleAutosave();
      }
    };

    this._initNavigableStage({
      stageEl,
      canvas,
      view: state.seamlessEditor.view,
      prefix: 'se',
      isPixelated: () => !!this._getSeamlessRipper()?.pixelArt?.enabled,
      getToolCursor: (pt) => {
        const se = state.seamlessEditor;
        if (this._seDrag?.mode === 'offset') return 'grabbing';
        if (this._seDrag?.mode === 'split') return 'ew-resize';
        if (se.splitCompare && pt && Math.abs(pt.x - canvas.width * se.splitRatio) <= 10 / Math.max(0.2, se.view.zoom)) {
          return 'ew-resize';
        }
        return se.tool === 'clone' ? 'crosshair' : 'grab';
      },
      onDown: (e, pt) => {
        const r = this._getSeamlessRipper();
        if (!r) return false;
        const se = state.seamlessEditor;
        const { tileW, tileH } = getTileMetrics();

        // Check split compare handle drag first
        if (se.splitCompare) {
          const splitX = canvas.width * se.splitRatio;
          if (Math.abs(pt.x - splitX) <= 10 / Math.max(0.2, se.view.zoom)) {
            this._seDrag = { mode: 'split', ripper: r };
            return true;
          }
        }

        const normX = (((pt.x / tileW) % 1) + 1) % 1;
        const normY = (((pt.y / tileH) % 1) + 1) % 1;

        if (se.tool === 'clone') {
          if (e.shiftKey || e.button === 2) {
            se.cloneSource = { x: normX, y: normY };
            this._drawSeamlessEditorPreview();
            events.emit('toast', { type: 'info', message: 'Clone source point updated' });
            return false;
          }

          if (!r.seamless.enabled) {
            r.seamless.enabled = true;
          }
          r.clonePatches.push({
            srcX: se.cloneSource.x,
            srcY: se.cloneSource.y,
            dstX: normX,
            dstY: normY,
            radius: se.brushRadius,
            strength: se.brushStrength,
          });
          this._seDrag = {
            mode: 'clone',
            ripper: r,
            startPt: pt,
            lastPt: pt,
            startSrc: { ...se.cloneSource },
          };
          this._updateSeamlessStatus();
          textureManager.scheduleProcess(r.id, 60);
          return true;
        }

        // Wrap-Offset Drag
        this._seDrag = {
          mode: 'offset',
          ripper: r,
          startPt: pt,
          origOffX: r.seamless.offsetX || 0,
          origOffY: r.seamless.offsetY || 0,
        };
        this._liveWrapDelta = { x: 0, y: 0 };
        return true;
      },
      onMove: (e, pt) => {
        this._seHoverPt = pt;
        const se = state.seamlessEditor;

        if (!this._seDrag) {
          if (se.tool === 'clone') this._drawSeamlessEditorPreview();
          return;
        }

        const d = this._seDrag;
        const r = d.ripper;
        const { tileW, tileH } = getTileMetrics();

        if (d.mode === 'split') {
          se.splitRatio = Math.max(0.05, Math.min(0.95, pt.x / Math.max(1, canvas.width)));
          const slider = this.el.querySelector('#se-split-ratio');
          const valEl = this.el.querySelector('#se-split-ratio-val');
          if (slider) slider.value = String(Math.round(se.splitRatio * 100));
          if (valEl) valEl.textContent = `${Math.round(se.splitRatio * 100)}%`;
          this._drawSeamlessEditorPreview();
        } else if (d.mode === 'offset') {
          const dxNorm = (pt.x - d.startPt.x) / Math.max(1, tileW);
          const dyNorm = (pt.y - d.startPt.y) / Math.max(1, tileH);
          this._liveWrapDelta = { x: dxNorm, y: dyNorm };
          r.seamless.offsetX = (((d.origOffX + dxNorm) % 1) + 1) % 1;
          r.seamless.offsetY = (((d.origOffY + dyNorm) % 1) + 1) % 1;
          this._updateSeamlessStatus();
          this._drawSeamlessEditorPreview();
        } else if (d.mode === 'clone') {
          const dist = Math.hypot(pt.x - d.lastPt.x, pt.y - d.lastPt.y);
          if (dist >= Math.max(4, se.brushRadius * 0.45)) {
            const dstNormX = (((pt.x / tileW) % 1) + 1) % 1;
            const dstNormY = (((pt.y / tileH) % 1) + 1) % 1;
            const deltaSrcX = (pt.x - d.startPt.x) / Math.max(1, tileW);
            const deltaSrcY = (pt.y - d.startPt.y) / Math.max(1, tileH);
            const srcNormX = (((d.startSrc.x + deltaSrcX) % 1) + 1) % 1;
            const srcNormY = (((d.startSrc.y + deltaSrcY) % 1) + 1) % 1;
            r.clonePatches.push({
              srcX: srcNormX,
              srcY: srcNormY,
              dstX: dstNormX,
              dstY: dstNormY,
              radius: se.brushRadius,
              strength: se.brushStrength,
            });
            d.lastPt = pt;
            this._updateSeamlessStatus();
            textureManager.scheduleProcess(r.id, 60);
          }
          this._drawSeamlessEditorPreview();
        }
      },
      onUp: endDrag,
      onLeave: () => {
        this._seHoverPt = null;
        if (!this._seDrag && state.seamlessEditor.tool === 'clone') {
          this._drawSeamlessEditorPreview();
        }
      },
    });
  }

  _emitSeamlessSync(ripper) {
    this._ignoreSeamlessSync = true;
    try {
      events.emit('ripper:seamlessChanged', ripper);
    } finally {
      this._ignoreSeamlessSync = false;
    }
  }

  _renderHistory() {
    if (!history.entries.length) {
      return `<div class="empty-state-inline">No history actions recorded yet.</div>`;
    }
    return `
      <div class="history-list">
        ${history.entries
          .map(
            (entry, i) => `
          <button type="button" class="history-entry ${i === history.index ? 'current' : ''}" data-hidx="${i}">
            <span>${i + 1}. ${entry.label}</span>
            <span class="mono" style="font-size:10px">${entry.timestamp}</span>
          </button>`
          )
          .join('')}
      </div>
    `;
  }

  _drawAtlasPreview() {
    const canvas = this.el.querySelector('#atlas-preview-canvas');
    if (!canvas) return;
    const res = state.atlas.packedResult;
    const stage = this.el.querySelector('#atl-nav-stage');
    if (!res || !res.previewCanvas) {
      canvas.width = 256;
      canvas.height = 128;
      const ctx = canvas.getContext('2d');
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      if (stage) this._applyNavTransform(stage, canvas, state.atlas.view, 'atl', false);
      return;
    }
    canvas.width = res.previewCanvas.width;
    canvas.height = res.previewCanvas.height;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(res.previewCanvas, 0, 0);
    if (stage) {
      this._applyNavTransform(stage, canvas, state.atlas.view, 'atl', false);
    }
  }

  _wireAtlasCanvasGizmo(canvas) {
    const stageEl = this.el.querySelector('#atl-nav-stage');
    if (!stageEl) return;

    const pointInPlacement = (pt, p) => {
      const cx = p.x + p.packedW / 2;
      const cy = p.y + p.packedH / 2;
      const rad = -((p.angleDeg || 0) * Math.PI) / 180;
      const dx = pt.x - cx;
      const dy = pt.y - cy;
      const lx = dx * Math.cos(rad) - dy * Math.sin(rad);
      const ly = dx * Math.sin(rad) + dy * Math.cos(rad);
      const hw = p.innerW / 2 + state.atlas.padding;
      const hh = p.innerH / 2 + state.atlas.padding;
      return Math.abs(lx) <= hw && Math.abs(ly) <= hh;
    };

    this._initNavigableStage({
      stageEl,
      canvas,
      view: state.atlas.view,
      prefix: 'atl',
      isPixelated: false,
      getToolCursor: () => {
        if (!state.atlas.freeMoveGizmo) return 'default';
        return this._atlasDrag ? 'grabbing' : 'pointer';
      },
      onDown: (_e, pt) => {
        if (!state.atlas.freeMoveGizmo) return false;
        const res = state.atlas.packedResult;
        if (!res) return false;

        const handleTol = Math.max(12, res.width * 0.025) / Math.max(0.25, state.atlas.view.zoom);

        // 1. Check active placement gizmo handles first
        if (state.atlas.selectedPlacementId) {
          const sel = res.placements.find((p) => p.ripperId === state.atlas.selectedPlacementId);
          if (sel) {
            const gizmo = atlasManager.getPlacementGizmo(sel);
            if (Math.hypot(pt.x - gizmo.rotateHandle.x, pt.y - gizmo.rotateHandle.y) <= handleTol) {
              this._atlasDrag = {
                mode: 'rotate',
                placement: sel,
                center: gizmo.center,
                startAngle: Math.atan2(pt.y - gizmo.center.y, pt.x - gizmo.center.x),
                origAngleDeg: sel.angleDeg || 0,
              };
              return true;
            }
            for (const c of gizmo.corners) {
              if (Math.hypot(pt.x - c.x, pt.y - c.y) <= handleTol) {
                this._atlasDrag = {
                  mode: 'scale',
                  placement: sel,
                  center: gizmo.center,
                  origW: sel.innerW,
                  origH: sel.innerH,
                  origX: sel.x,
                  origY: sel.y,
                  startDist: Math.max(4, Math.hypot(pt.x - gizmo.center.x, pt.y - gizmo.center.y)),
                  startDx: Math.max(4, Math.abs(pt.x - gizmo.center.x)),
                  startDy: Math.max(4, Math.abs(pt.y - gizmo.center.y)),
                };
                return true;
              }
            }
          }
        }

        // 2. Hit test placement bodies (topmost first)
        let hit = null;
        for (let i = res.placements.length - 1; i >= 0; i--) {
          if (pointInPlacement(pt, res.placements[i])) {
            hit = res.placements[i];
            break;
          }
        }

        if (hit) {
          state.atlas.selectedPlacementId = hit.ripperId;
          this._atlasDrag = {
            mode: 'move',
            placement: hit,
            startPt: pt,
            origX: hit.x,
            origY: hit.y,
          };
          atlasManager.renderAtlasCanvases();
          return true;
        }

        state.atlas.selectedPlacementId = null;
        atlasManager.activeGuides = [];
        atlasManager.renderAtlasCanvases();
        return false;
      },
      onMove: (e, pt) => {
        if (!this._atlasDrag || !state.atlas.freeMoveGizmo) return;
        const res = state.atlas.packedResult;
        if (!res) return;
        const d = this._atlasDrag;
        const p = d.placement;
        const pad = state.atlas.padding;

        if (d.mode === 'move') {
          const rawX = d.origX + (pt.x - d.startPt.x);
          const rawY = d.origY + (pt.y - d.startPt.y);
          const snapped = atlasManager.computeSnapPosition(p.ripperId, rawX, rawY, p.packedW, p.packedH);
          p.x = Math.max(0, Math.min(res.width - p.packedW, snapped.x));
          p.y = Math.max(0, Math.min(res.height - p.packedH, snapped.y));
        } else if (d.mode === 'rotate') {
          const curAngle = Math.atan2(pt.y - d.center.y, pt.x - d.center.x);
          let deg = d.origAngleDeg + ((curAngle - d.startAngle) * 180) / Math.PI;
          if (e.shiftKey) {
            deg = Math.round(deg / 15) * 15;
          }
          deg = ((((deg + 180) % 360) + 360) % 360) - 180;
          p.angleDeg = deg;
          p.rotated = Math.abs(deg) > 0.01;
          const rad = (deg * Math.PI) / 180;
          const cos = Math.abs(Math.cos(rad));
          const sin = Math.abs(Math.sin(rad));
          const newBoxW = Math.round(p.innerW * cos + p.innerH * sin) + pad * 2;
          const newBoxH = Math.round(p.innerW * sin + p.innerH * cos) + pad * 2;
          p.x = Math.round(d.center.x - newBoxW / 2);
          p.y = Math.round(d.center.y - newBoxH / 2);
          p.packedW = newBoxW;
          p.packedH = newBoxH;
        } else if (d.mode === 'scale') {
          const curDist = Math.max(4, Math.hypot(pt.x - d.center.x, pt.y - d.center.y));
          let newW, newH;
          if (e.altKey) {
            const sx = Math.max(4, Math.abs(pt.x - d.center.x)) / d.startDx;
            const sy = Math.max(4, Math.abs(pt.y - d.center.y)) / d.startDy;
            newW = Math.max(12, Math.round(d.origW * sx));
            newH = Math.max(12, Math.round(d.origH * sy));
          } else {
            const ratio = curDist / d.startDist;
            newW = Math.max(12, Math.round(d.origW * ratio));
            newH = Math.max(12, Math.round(d.origH * ratio));
          }
          if (state.atlas.snapEnabled) {
            const grid = Math.max(4, state.atlas.snapGridSize || 16);
            if (Math.abs(newW - Math.round(newW / grid) * grid) <= 5) {
              newW = Math.max(12, Math.round(newW / grid) * grid);
            }
            if (Math.abs(newH - Math.round(newH / grid) * grid) <= 5) {
              newH = Math.max(12, Math.round(newH / grid) * grid);
            }
          }
          p.innerW = newW;
          p.innerH = newH;
          const rad = ((p.angleDeg || 0) * Math.PI) / 180;
          const cos = Math.abs(Math.cos(rad));
          const sin = Math.abs(Math.sin(rad));
          p.packedW = Math.round(newW * cos + newH * sin) + pad * 2;
          p.packedH = Math.round(newW * sin + newH * cos) + pad * 2;
          p.x = Math.round(d.center.x - p.packedW / 2);
          p.y = Math.round(d.center.y - p.packedH / 2);
        }

        state.atlas.manualOverrides[p.ripperId] = {
          x: p.x,
          y: p.y,
          innerW: p.innerW,
          innerH: p.innerH,
          angleDeg: p.angleDeg || 0,
        };
        atlasManager.renderAtlasCanvases();
      },
      onUp: () => {
        if (!this._atlasDrag) return;
        this._atlasDrag = null;
        atlasManager.activeGuides = [];
        atlasManager.renderAtlasCanvases();
        history.push('Atlas gizmo transform');
        projectManager.scheduleAutosave();
      },
    });
  }

  _wireBodyHandlers() {
    if (state.bottomTab === 'library') {
      this.el.querySelector('#lib-search')?.addEventListener('input', (e) => {
        state.libraryFilter.search = e.target.value;
        this.render();
      });
      this.el.querySelector('#lib-cat')?.addEventListener('change', (e) => {
        state.libraryFilter.category = e.target.value;
        this.render();
      });
      this.el.querySelector('#lib-sort')?.addEventListener('change', (e) => {
        state.libraryFilter.sortBy = e.target.value;
        this.render();
      });
      this.el.querySelector('#lib-favs')?.addEventListener('change', (e) => {
        state.libraryFilter.favoritesOnly = e.target.checked;
        this.render();
      });

      this.el.querySelectorAll('.texture-card').forEach((card) => {
        card.addEventListener('click', (e) => {
          if (e.target.closest('button')) return;
          const rip = state.rippers.find((r) => r.id === card.dataset.ripId);
          if (!rip) return;
          if (rip.sourceImageId !== state.activeImageId) {
            setActiveImage(rip.sourceImageId);
          }
          setActiveRipper(rip.id);
        });
      });

      this.el.querySelectorAll('.lib-fav').forEach((b) => {
        b.addEventListener('click', () => {
          const r = state.rippers.find((x) => x.id === b.dataset.fav);
          if (r) {
            r.favorite = !r.favorite;
            this.render();
          }
        });
      });
      this.el.querySelectorAll('.lib-toggle').forEach((b) => {
        b.addEventListener('click', () => {
          const r = state.rippers.find((x) => x.id === b.dataset.toggle);
          if (r) {
            r.enabled = !r.enabled;
            events.emit('rippers:changed', state.rippers);
            events.emit('canvas:redrawOverlay');
          }
        });
      });
      this.el.querySelectorAll('.lib-prev').forEach((b) => {
        b.addEventListener('click', () => floatingPreviews.openWindow(b.dataset.prev));
      });
      this.el.querySelectorAll('.lib-dup').forEach((b) => {
        b.addEventListener('click', () => textureManager.duplicateRipper(b.dataset.dup));
      });
      this.el.querySelectorAll('.lib-exp').forEach((b) => {
        b.addEventListener('click', () => {
          const r = state.rippers.find((x) => x.id === b.dataset.exp);
          if (r) exportRipperStage(r, 'final', 'png', 0.92);
        });
      });
      this.el.querySelectorAll('.lib-del').forEach((b) => {
        b.addEventListener('click', () => textureManager.deleteRipper(b.dataset.del));
      });
    } else if (state.bottomTab === 'atlas') {
      const rebuild = (clearManual = false) => {
        atlasManager.rebuildAtlas({ clearManual });
        this.render();
      };
      this.el.querySelector('#atl-rebuild')?.addEventListener('click', () => rebuild(true));
      this.el.querySelector('#atl-algo')?.addEventListener('change', (e) => {
        state.atlas.algorithm = e.target.value;
        rebuild(true);
      });
      this.el.querySelector('#atl-ratio')?.addEventListener('change', (e) => {
        state.atlas.aspectRatio = e.target.value;
        state.atlas.square = e.target.value === '1:1';
        rebuild(true);
      });
      this.el.querySelector('#atl-maxw')?.addEventListener('change', (e) => {
        state.atlas.maxWidth = Math.max(128, Number(e.target.value) || 2048);
        rebuild(true);
      });
      this.el.querySelector('#atl-maxh')?.addEventListener('change', (e) => {
        state.atlas.maxHeight = Math.max(128, Number(e.target.value) || 2048);
        rebuild(true);
      });
      this.el.querySelector('#atl-pad')?.addEventListener('change', (e) => {
        state.atlas.padding = Math.max(0, Number(e.target.value) || 0);
        rebuild(false);
      });
      this.el.querySelector('#atl-space')?.addEventListener('change', (e) => {
        state.atlas.spacing = Math.max(0, Number(e.target.value) || 0);
        rebuild(true);
      });
      this.el.querySelector('#atl-rot')?.addEventListener('change', (e) => {
        state.atlas.allowRotate = e.target.checked;
        rebuild(true);
      });
      this.el.querySelector('#atl-pot')?.addEventListener('change', (e) => {
        state.atlas.powerOfTwo = e.target.checked;
        rebuild(true);
      });
      this.el.querySelector('#atl-auto')?.addEventListener('change', (e) => {
        state.atlas.autoSize = e.target.checked;
        rebuild(true);
      });
      this.el.querySelector('#atl-gizmo')?.addEventListener('change', (e) => {
        state.atlas.freeMoveGizmo = e.target.checked;
        if (!state.atlas.freeMoveGizmo) {
          state.atlas.selectedPlacementId = null;
          atlasManager.activeGuides = [];
        }
        atlasManager.renderAtlasCanvases();
        this.render();
      });
      this.el.querySelector('#atl-snap')?.addEventListener('change', (e) => {
        state.atlas.snapEnabled = e.target.checked;
        atlasManager.renderAtlasCanvases();
      });
      this.el.querySelector('#atl-snap-grid')?.addEventListener('change', (e) => {
        state.atlas.snapGridSize = Math.max(2, Math.min(128, Number(e.target.value) || 16));
        atlasManager.renderAtlasCanvases();
      });
      this.el.querySelector('#atl-trans')?.addEventListener('change', (e) => {
        state.atlas.transparent = e.target.checked;
        atlasManager.renderAtlasCanvases();
        this.render();
      });
      this.el.querySelector('#atl-bg')?.addEventListener('input', (e) => {
        state.atlas.bgColor = e.target.value;
        atlasManager.renderAtlasCanvases();
      });
      this.el.querySelector('#atl-bounds')?.addEventListener('change', (e) => {
        state.atlas.showBounds = e.target.checked;
        atlasManager.renderAtlasCanvases();
      });
      this.el.querySelector('#atl-names')?.addEventListener('change', (e) => {
        state.atlas.showNames = e.target.checked;
        atlasManager.renderAtlasCanvases();
      });
      this.el.querySelector('#atl-uvs')?.addEventListener('change', (e) => {
        state.atlas.showUVs = e.target.checked;
        atlasManager.renderAtlasCanvases();
      });

      this.el.querySelector('#atl-exp-img')?.addEventListener('click', () => exportAtlasImage('png', 0.92, false));
      this.el.querySelector('#atl-exp-json')?.addEventListener('click', () => exportAtlasMetadata());
      this.el.querySelector('#atl-exp-zip')?.addEventListener('click', () => exportAtlasZipPackage('png', 0.92));

      this.el.querySelectorAll('.atl-item-scale').forEach((inp) => {
        inp.addEventListener('change', () => {
          const cfg = state.atlas.items.find((x) => x.ripperId === inp.dataset.id);
          if (cfg) {
            cfg.scale = Math.max(0.25, Math.min(4, Number(inp.value) || 1));
            delete state.atlas.manualOverrides[inp.dataset.id];
            rebuild(false);
          }
        });
      });
      this.el.querySelectorAll('.atl-item-lock').forEach((btn) => {
        btn.addEventListener('click', () => {
          const cfg = state.atlas.items.find((x) => x.ripperId === btn.dataset.id);
          if (cfg) {
            cfg.locked = !cfg.locked;
            this.render();
          }
        });
      });
      this.el.querySelectorAll('.atl-item-up').forEach((btn) => {
        btn.addEventListener('click', () => {
          const idx = Number(btn.dataset.idx);
          if (idx <= 0) return;
          const items = atlasManager.getActiveItems();
          const cur = state.atlas.items.find((x) => x.ripperId === items[idx].ripperId);
          const prev = state.atlas.items.find((x) => x.ripperId === items[idx - 1].ripperId);
          if (cur && prev) {
            const tmp = cur.order;
            cur.order = prev.order;
            prev.order = tmp;
            rebuild(true);
          }
        });
      });

      const atlasCanvas = this.el.querySelector('#atlas-preview-canvas');
      if (atlasCanvas) {
        this._wireAtlasCanvasGizmo(atlasCanvas);
      }
    } else if (state.bottomTab === 'seamless') {
      const r = this._getSeamlessRipper();
      if (!r) return;
      const se = state.seamlessEditor;

      this.el.querySelector('#se-ripper-select')?.addEventListener('change', (e) => {
        setActiveRipper(e.target.value);
      });
      this.el.querySelector('#se-generate')?.addEventListener('click', () => textureManager.processNow(r.id));
      this.el.querySelector('#se-randomize')?.addEventListener('click', () => {
        r.seamless.seed = Math.floor(Math.random() * 99999) + 1;
        this._emitSeamlessSync(r);
        this.render();
        textureManager.scheduleProcess(r.id, 10);
      });
      this.el.querySelector('#se-reset')?.addEventListener('click', () => {
        resetRipperSeamlessDefaults(r);
        this._emitSeamlessSync(r);
        this.render();
        textureManager.scheduleProcess(r.id, 10);
        history.push(`Reset seamless (${r.name})`);
      });
      this.el.querySelector('#se-reset-offset')?.addEventListener('click', () => {
        r.seamless.offsetX = 0;
        r.seamless.offsetY = 0;
        this._emitSeamlessSync(r);
        this.render();
        textureManager.processNow(r.id);
        history.push(`Reset wrap offset (${r.name})`);
      });

      this.el.querySelectorAll('[data-se-tool]').forEach((btn) => {
        btn.addEventListener('click', () => {
          se.tool = btn.dataset.seTool;
          this.render();
        });
      });

      this.el.querySelectorAll('[data-se-tile]').forEach((btn) => {
        btn.addEventListener('click', () => {
          se.tileCount = Number(btn.dataset.seTile) || 2;
          this.render();
        });
      });

      this.el.querySelector('#se-stage')?.addEventListener('change', (e) => {
        se.stagePreview = e.target.value;
        this._drawSeamlessEditorPreview();
      });
      this.el.querySelector('#se-guides')?.addEventListener('change', (e) => {
        se.showGuides = e.target.checked;
        this._drawSeamlessEditorPreview();
      });
      this.el.querySelector('#se-split')?.addEventListener('change', (e) => {
        se.splitCompare = e.target.checked;
        this.render();
      });
      this.el.querySelector('#se-split-ratio')?.addEventListener('input', (e) => {
        se.splitRatio = Number(e.target.value) / 100;
        const valEl = this.el.querySelector('#se-split-ratio-val');
        if (valEl) valEl.textContent = `${e.target.value}%`;
        this._drawSeamlessEditorPreview();
      });

      this.el.querySelector('#se-brush-rad')?.addEventListener('input', (e) => {
        se.brushRadius = Number(e.target.value) || 14;
        const valEl = this.el.querySelector('#se-brush-rad-val');
        if (valEl) valEl.textContent = `${se.brushRadius}px`;
        this._drawSeamlessEditorPreview();
      });
      this.el.querySelector('#se-brush-str')?.addEventListener('input', (e) => {
        se.brushStrength = (Number(e.target.value) || 90) / 100;
        const valEl = this.el.querySelector('#se-brush-str-val');
        if (valEl) valEl.textContent = `${e.target.value}%`;
      });
      this.el.querySelector('#se-undo-patch')?.addEventListener('click', () => {
        if (!r.clonePatches.length) return;
        r.clonePatches.pop();
        this._emitSeamlessSync(r);
        this.render();
        textureManager.scheduleProcess(r.id, 10);
        history.push(`Undo clone patch (${r.name})`);
      });
      this.el.querySelector('#se-clear-clone')?.addEventListener('click', () => {
        r.clonePatches = [];
        this._emitSeamlessSync(r);
        this.render();
        textureManager.scheduleProcess(r.id, 10);
        history.push(`Clear clone patches (${r.name})`);
      });

      this.el.querySelector('#se-enabled')?.addEventListener('change', (e) => {
        r.seamless.enabled = e.target.checked;
        this._emitSeamlessSync(r);
        textureManager.scheduleProcess(r.id, 20);
      });
      this.el.querySelector('#se-method')?.addEventListener('change', (e) => {
        r.seamless.method = e.target.value;
        this._emitSeamlessSync(r);
        textureManager.scheduleProcess(r.id, 20);
        history.push(`Seamless algorithm: ${r.seamless.method}`);
      });

      const bindSeSlider = (id, setter) => {
        const el = this.el.querySelector(`#${id}`);
        const valEl = this.el.querySelector(`#${id}-val`);
        if (!el) return;
        el.addEventListener('input', () => {
          const v = Number(el.value);
          setter(v);
          if (valEl) valEl.textContent = `${v}${el.dataset.unit || ''}`;
          this._emitSeamlessSync(r);
          textureManager.scheduleProcess(r.id, 90);
        });
        el.addEventListener('change', () => {
          history.push(`Update ${id} (${r.name})`);
          projectManager.scheduleAutosave();
        });
      };

      bindSeSlider('se-blending', (v) => { r.seamless.seamBlending = v; });
      bindSeSlider('se-width', (v) => { r.seamless.blendWidth = v; });
      bindSeSlider('se-smooth', (v) => { r.seamless.edgeSmoothing = v; });
      bindSeSlider('se-random', (v) => { r.seamless.randomization = v; });
      bindSeSlider('se-strength', (v) => { r.seamless.blendStrength = v; });

      this.el.querySelector('#se-seed')?.addEventListener('change', (e) => {
        r.seamless.seed = Number(e.target.value) || 42;
        this._emitSeamlessSync(r);
        textureManager.scheduleProcess(r.id, 20);
      });

      const seCanvas = this.el.querySelector('#seamless-editor-canvas');
      if (seCanvas) {
        this._wireSeamlessEditorCanvas(seCanvas);
      }
    } else if (state.bottomTab === 'history') {
      this.el.querySelectorAll('.history-entry').forEach((btn) => {
        btn.addEventListener('click', () => {
          history.jumpTo(Number(btn.dataset.hidx));
        });
      });
    }
  }
}
