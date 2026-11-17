// Dockable & Floatable Atlas FX & Shaders Panel (20 Overlay Filters + Full Post-Processing Stack with Sharpness, Overall + Per-Texture)
import { state, createDefaultAtlasPostFx } from '../core/app-state.js';
import { events } from '../core/event-manager.js';
import { history } from '../core/history-manager.js';
import { projectManager } from '../core/project-manager.js';
import { ensureRipperFx } from '../texture/texture-ripper.js';
import { atlasManager } from '../atlas/atlas-manager.js';
import { ATLAS_OVERLAY_FILTERS } from '../atlas/atlas-fx-engine.js';
import { ICONS } from './icons.js';

function getSelectedTarget() {
  const activeItems = atlasManager.getActiveItems();
  const fx = state.atlas.fx;
  const ripperPool = activeItems.length
    ? activeItems.map((it) => state.rippers.find((r) => r.id === it.ripperId)).filter(Boolean)
    : state.rippers.slice();
  if (!ripperPool.length) return { itemCfg: null, ripper: null };

  const preferredId = state.atlas.selectedPlacementId || fx.selectedItemId || state.activeRipperId || ripperPool[0].id;
  const ripper = ripperPool.find((r) => r.id === preferredId) || ripperPool[0];
  fx.selectedItemId = ripper.id;
  ensureRipperFx(ripper);
  const itemCfg = state.atlas.items.find((it) => it.ripperId === ripper.id) || null;
  return { itemCfg, ripper };
}

function renderSlider(id, label, value, min, max, step, unit) {
  const disp = step < 1 ? Number(value).toFixed(2) : Math.round(value);
  return `
    <div class="prop-slider-group">
      <div class="prop-slider-header">
        <span class="prop-label">${label}</span>
        <span class="prop-value mono" id="${id}-val">${disp}${unit}</span>
      </div>
      <input type="range" id="${id}" class="slider" min="${min}" max="${max}" step="${step}" value="${value}" data-unit="${unit}" data-step="${step}" />
    </div>
  `;
}

export function renderAtlasFxMarkup(prefix = 'afx') {
  const fx = state.atlas.fx;
  const isItemScope = fx.scope === 'item';
  const items = atlasManager.getActiveItems();
  const selectableRippers = items.length
    ? items.map((it) => state.rippers.find((r) => r.id === it.ripperId)).filter(Boolean)
    : state.rippers;
  const { ripper } = getSelectedTarget();
  const ripFx = ripper ? ensureRipperFx(ripper) : null;

  const post = isItemScope && ripFx ? ripFx.post : fx.post;
  const activeFilterId = isItemScope && ripFx ? ripFx.filter : fx.overallFilter || 'none';
  const activeIntensity = isItemScope && ripFx ? ripFx.filterIntensity : fx.overallIntensity ?? 1;
  const activeFilterMeta = ATLAS_OVERLAY_FILTERS.find((f) => f.id === activeFilterId) || ATLAS_OVERLAY_FILTERS[0];

  const filterButtons = ATLAS_OVERLAY_FILTERS.map(
    (f) => `
      <button
        type="button"
        class="fx-filter-btn ${f.id === activeFilterId ? 'active' : ''}"
        data-fx-filter="${f.id}"
        title="${f.name} — ${f.desc}"
      >
        <span class="fx-filter-name">${f.name}</span>
        <span class="fx-filter-cat">${f.category}</span>
      </button>
    `
  ).join('');

  return `
    <div class="fx-panel-scroll">
      <div class="section-heading">
        <span>FX &amp; Post-FX Scope</span>
        <button type="button" class="btn btn-sm" id="${prefix}-clear-all-fx" title="Reset all overlay filters &amp; post-FX to None">Clear All</button>
      </div>

      <div class="segmented-control">
        <button type="button" class="seg-btn ${!isItemScope ? 'active' : ''}" data-fx-scope="overall" title="Edit overlay filter &amp; post-processing for the entire Atlas">Overall Atlas</button>
        <button type="button" class="seg-btn ${isItemScope ? 'active' : ''}" data-fx-scope="item" title="Edit overlay filter &amp; full post-processing separately per Ripper texture">Per Texture</button>
      </div>

      ${
        isItemScope
          ? selectableRippers.length
            ? `
            <div class="prop-row">
              <span class="prop-label">Target</span>
              <select id="${prefix}-item-select" class="select" style="flex:1;min-width:0">
                ${selectableRippers
                  .map((r) => {
                    const rfx = ensureRipperFx(r);
                    const tags = [];
                    if (rfx.filter && rfx.filter !== 'none') tags.push(rfx.filter);
                    if (rfx.post?.enabled) tags.push('Post');
                    const fTag = tags.length ? ` [${tags.join('+')}]` : '';
                    return `<option value="${r.id}" ${r.id === ripper?.id ? 'selected' : ''}>${r.name}${fTag}</option>`;
                  })
                  .join('')}
              </select>
            </div>
          `
            : `<p style="margin:0;font-size:11px;color:var(--text-muted)">No extracted textures available yet.</p>`
          : ''
      }

      <div class="prop-row">
        <span class="prop-label">Active Preset</span>
        <span class="mono" style="font-size:11px;color:var(--text-primary)">${activeFilterMeta.name}</span>
      </div>

      ${renderSlider(
        `${prefix}-filter-intensity`,
        'Overlay Intensity',
        Math.round(activeIntensity * 100),
        0,
        100,
        1,
        '%'
      )}

      <div class="section-heading" style="margin-top:2px">
        <span>20 Overlay Filters &amp; Shaders</span>
        <button type="button" class="btn btn-sm" id="${prefix}-reset-filter">None</button>
      </div>
      <div class="fx-filter-grid">
        ${filterButtons}
      </div>

      <div class="section-heading" style="margin-top:6px">
        <span>Post-Processing (${isItemScope && ripper ? ripper.name : 'Overall Atlas'})</span>
        <button type="button" class="btn btn-sm" id="${prefix}-reset-post">Reset Stack</button>
      </div>
      <label class="check-label">
        <input type="checkbox" id="${prefix}-post-enabled" ${post.enabled ? 'checked' : ''} />
        Enable ${isItemScope && ripper ? `${ripper.name} Post-FX` : 'Overall Post-FX'}
      </label>

      ${renderSlider(`${prefix}-post-sharpness`, 'Sharpness', post.sharpness, 0, 100, 1, '%')}
      ${renderSlider(`${prefix}-post-bloom`, 'Bloom / Glow', post.bloom, 0, 100, 1, '%')}
      ${renderSlider(`${prefix}-post-exposure`, 'Exposure', post.exposure, -100, 100, 1, '%')}
      ${renderSlider(`${prefix}-post-contrast`, 'Contrast', post.contrast, -100, 100, 1, '%')}
      ${renderSlider(`${prefix}-post-saturation`, 'Saturation', post.saturation, -100, 100, 1, '%')}
      ${renderSlider(`${prefix}-post-gamma`, 'Gamma', post.gamma, 0.5, 2.2, 0.05, '')}
      ${renderSlider(`${prefix}-post-ca`, 'Chromatic Aberr.', post.chromaticAberration, 0, 12, 1, 'px')}
      ${renderSlider(`${prefix}-post-vignette`, 'Vignette', post.vignette, 0, 100, 1, '%')}
      ${renderSlider(`${prefix}-post-grain`, 'Film Grain', post.grain, 0, 100, 1, '%')}
      ${renderSlider(`${prefix}-post-soften`, 'Edge Soften', post.edgeSoften, 0, 100, 1, '%')}
    </div>
  `;
}

export function wireAtlasFxHandlers(rootEl, prefix = 'afx', onRedraw = null) {
  if (!rootEl) return;
  const fx = state.atlas.fx;
  const isItemScope = fx.scope === 'item';

  const getActivePost = () => {
    if (fx.scope === 'item') {
      const { ripper } = getSelectedTarget();
      if (ripper) return ensureRipperFx(ripper).post;
    }
    return fx.post;
  };

  const emitScopeChange = () => {
    if (fx.scope === 'item') {
      const { ripper } = getSelectedTarget();
      if (ripper) events.emit('ripper:fxChanged', { ripperId: ripper.id });
    } else {
      events.emit('ripper:fxChanged', { ripperId: null });
    }
  };

  const refreshAll = () => {
    atlasManager.renderAtlasCanvases();
    emitScopeChange();
    onRedraw?.();
    events.emit('atlas:fxUiSync');
  };

  rootEl.querySelectorAll('[data-fx-scope]').forEach((btn) => {
    btn.addEventListener('click', () => {
      fx.scope = btn.dataset.fxScope;
      if (fx.scope === 'item') getSelectedTarget();
      onRedraw?.();
      events.emit('atlas:fxUiSync');
    });
  });

  rootEl.querySelector(`#${prefix}-item-select`)?.addEventListener('change', (e) => {
    fx.selectedItemId = e.target.value;
    state.atlas.selectedPlacementId = e.target.value;
    atlasManager.renderAtlasCanvases();
    onRedraw?.();
    events.emit('atlas:fxUiSync');
  });

  rootEl.querySelectorAll('[data-fx-filter]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const fid = btn.dataset.fxFilter;
      if (fx.scope === 'item') {
        const { ripper, itemCfg } = getSelectedTarget();
        if (!ripper) return;
        ensureRipperFx(ripper).filter = fid;
        if (itemCfg) itemCfg.filter = fid;
      } else {
        fx.overallFilter = fid;
      }
      refreshAll();
      history.push(`FX filter: ${fid}`);
      projectManager.scheduleAutosave();
    });
  });

  rootEl.querySelector(`#${prefix}-reset-filter`)?.addEventListener('click', () => {
    if (fx.scope === 'item') {
      const { ripper, itemCfg } = getSelectedTarget();
      if (ripper) ensureRipperFx(ripper).filter = 'none';
      if (itemCfg) itemCfg.filter = 'none';
    } else {
      fx.overallFilter = 'none';
    }
    refreshAll();
    history.push('Reset overlay filter to None');
    projectManager.scheduleAutosave();
  });

  rootEl.querySelector(`#${prefix}-clear-all-fx`)?.addEventListener('click', () => {
    fx.overallFilter = 'none';
    fx.overallIntensity = 1;
    fx.post = createDefaultAtlasPostFx();
    for (const it of state.atlas.items) {
      it.filter = 'none';
      it.filterIntensity = 1;
    }
    for (const r of state.rippers) {
      r.fx = { filter: 'none', filterIntensity: 1, post: createDefaultAtlasPostFx() };
      events.emit('ripper:fxChanged', { ripperId: r.id });
    }
    refreshAll();
    history.push('Clear all overlay filters & post-FX');
    projectManager.scheduleAutosave();
  });

  const intSlider = rootEl.querySelector(`#${prefix}-filter-intensity`);
  const intVal = rootEl.querySelector(`#${prefix}-filter-intensity-val`);
  intSlider?.addEventListener('input', () => {
    const val = Number(intSlider.value);
    if (intVal) intVal.textContent = `${val}%`;
    if (fx.scope === 'item') {
      const { ripper, itemCfg } = getSelectedTarget();
      if (ripper) ensureRipperFx(ripper).filterIntensity = val / 100;
      if (itemCfg) itemCfg.filterIntensity = val / 100;
      if (ripper) events.emit('ripper:fxChanged', { ripperId: ripper.id });
    } else {
      fx.overallIntensity = val / 100;
    }
    atlasManager.scheduleFxRender(24);
  });
  intSlider?.addEventListener('change', () => {
    atlasManager.renderAtlasCanvases();
    emitScopeChange();
    history.push('Adjust overlay intensity');
    projectManager.scheduleAutosave();
  });

  rootEl.querySelector(`#${prefix}-post-enabled`)?.addEventListener('change', (e) => {
    const targetPost = getActivePost();
    targetPost.enabled = e.target.checked;
    refreshAll();
    history.push(targetPost.enabled ? 'Enable post-FX' : 'Disable post-FX');
    projectManager.scheduleAutosave();
  });

  rootEl.querySelector(`#${prefix}-reset-post`)?.addEventListener('click', () => {
    if (isItemScope) {
      const { ripper } = getSelectedTarget();
      if (ripper) ensureRipperFx(ripper).post = createDefaultAtlasPostFx();
    } else {
      state.atlas.fx.post = createDefaultAtlasPostFx();
    }
    refreshAll();
    history.push('Reset post-processing stack');
    projectManager.scheduleAutosave();
  });

  const bindPostSlider = (suffix, propName) => {
    const slider = rootEl.querySelector(`#${prefix}-post-${suffix}`);
    const valEl = rootEl.querySelector(`#${prefix}-post-${suffix}-val`);
    if (!slider) return;
    slider.addEventListener('input', () => {
      const targetPost = getActivePost();
      const val = Number(slider.value);
      const step = Number(slider.dataset.step || 1);
      const unit = slider.dataset.unit || '';
      targetPost[propName] = val;
      if (
        !targetPost.enabled &&
        ((propName === 'gamma' && Math.abs(val - 1) > 0.01) || (propName !== 'gamma' && val !== 0))
      ) {
        targetPost.enabled = true;
        const chk = rootEl.querySelector(`#${prefix}-post-enabled`);
        if (chk) chk.checked = true;
      }
      if (valEl) {
        valEl.textContent = `${step < 1 ? val.toFixed(2) : Math.round(val)}${unit}`;
      }
      atlasManager.scheduleFxRender(28);
      if (fx.scope === 'item') {
        const { ripper } = getSelectedTarget();
        if (ripper) events.emit('ripper:fxChanged', { ripperId: ripper.id });
      }
    });
    slider.addEventListener('change', () => {
      atlasManager.renderAtlasCanvases();
      emitScopeChange();
      history.push(`Adjust post-${propName}`);
      projectManager.scheduleAutosave();
    });
  };

  bindPostSlider('sharpness', 'sharpness');
  bindPostSlider('bloom', 'bloom');
  bindPostSlider('exposure', 'exposure');
  bindPostSlider('contrast', 'contrast');
  bindPostSlider('saturation', 'saturation');
  bindPostSlider('gamma', 'gamma');
  bindPostSlider('ca', 'chromaticAberration');
  bindPostSlider('vignette', 'vignette');
  bindPostSlider('grain', 'grain');
  bindPostSlider('soften', 'edgeSoften');
}

class AtlasFxFloatingWindow {
  constructor() {
    this.layer = document.getElementById('floating-layer');
    this.win = null;
    events.on('atlas:fxUiSync', () => {
      if (this.win && state.atlas.fx.floating) {
        if (!this.win.contains(document.activeElement) || document.activeElement?.type !== 'range') {
          this.renderContent();
        }
      }
    });
    events.on('rippers:changed', () => {
      if (this.win && state.atlas.fx.floating) {
        this.renderContent();
      }
    });
    events.on('ripper:selected', (r) => {
      if (r && state.atlas.fx.scope === 'item') {
        state.atlas.fx.selectedItemId = r.id;
        if (this.win && state.atlas.fx.floating) {
          this.renderContent();
        }
      }
    });
  }

  open() {
    const fx = state.atlas.fx;
    fx.floating = true;
    fx.minimized = false;
    fx.subTab = 'packing';

    if (this.win) {
      this._bringToFront();
      this.win.classList.remove('minimized');
      this.renderContent();
      events.emit('atlas:fxLayoutChanged');
      return;
    }

    const r = fx.floatRect;
    const vw = Math.max(320, window.innerWidth);
    const vh = Math.max(280, window.innerHeight);
    r.width = Math.max(280, Math.min(vw - 24, r.width || 332));
    r.height = Math.max(240, Math.min(vh - 48, r.height || 480));
    r.x = Math.max(8, Math.min(vw - r.width - 8, r.x ?? 88));
    r.y = Math.max(32, Math.min(vh - r.height - 8, r.y ?? 86));

    const win = document.createElement('div');
    win.className = 'floating-window fx-floating-window';
    win.style.left = `${r.x}px`;
    win.style.top = `${r.y}px`;
    win.style.width = `${r.width}px`;
    win.style.height = `${r.height}px`;

    win.innerHTML = `
      <div class="floating-titlebar" id="fx-float-titlebar" title="Drag to move floating FX window">
        <span class="floating-title">Atlas FX &amp; Shaders</span>
        <div style="display:flex;align-items:center;gap:2px;flex-shrink:0">
          <button type="button" class="btn-icon" id="fx-float-dock" title="Dock back into Texture Atlas sidebar">${ICONS.dock}</button>
          <button type="button" class="btn-icon" id="fx-float-min" title="Minimize / Restore">${ICONS.minimize}</button>
          <button type="button" class="btn-icon" id="fx-float-close" title="Close floating FX window">✕</button>
        </div>
      </div>
      <div class="fx-floating-body fx-panel-scroll" id="fx-float-body"></div>
      <div class="floating-resize-handle" id="fx-float-resize" title="Drag corner to resize"></div>
    `;

    this.layer?.appendChild(win);
    this.win = win;
    this._bringToFront();
    this._wireWindowChrome();
    this.renderContent();
    events.emit('atlas:fxLayoutChanged');
  }

  close({ dock = false } = {}) {
    if (this.win) {
      this.win.remove();
      this.win = null;
    }
    state.atlas.fx.floating = false;
    state.atlas.fx.minimized = false;
    if (dock) {
      state.atlas.fx.subTab = 'fx';
    }
    events.emit('atlas:fxLayoutChanged');
  }

  toggleMinimize() {
    if (!this.win) return;
    const fx = state.atlas.fx;
    fx.minimized = !fx.minimized;
    this.win.classList.toggle('minimized', fx.minimized);
    const minBtn = this.win.querySelector('#fx-float-min');
    if (minBtn) {
      minBtn.innerHTML = fx.minimized ? ICONS.restoreWin : ICONS.minimize;
      minBtn.title = fx.minimized ? 'Restore FX window' : 'Minimize FX window';
    }
  }

  renderContent() {
    if (!this.win) return;
    const body = this.win.querySelector('#fx-float-body');
    if (!body) return;
    body.innerHTML = renderAtlasFxMarkup('ffx');
    wireAtlasFxHandlers(body, 'ffx', () => this.renderContent());
  }

  _bringToFront() {
    if (!this.win) return;
    let maxZ = 53;
    if (this.layer) {
      for (const el of this.layer.children) {
        const z = Number(el.style?.zIndex || 41);
        if (z >= maxZ) maxZ = z + 1;
      }
    }
    this.win.style.zIndex = String(maxZ);
  }

  _wireWindowChrome() {
    const win = this.win;
    const r = state.atlas.fx.floatRect;

    win.addEventListener('pointerdown', () => this._bringToFront());

    const titlebar = win.querySelector('#fx-float-titlebar');
    titlebar.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || e.target.closest('button')) return;
      e.preventDefault();
      const startX = e.clientX;
      const startY = e.clientY;
      const origX = win.offsetLeft;
      const origY = win.offsetTop;
      const onMove = (me) => {
        r.x = Math.max(0, Math.min(window.innerWidth - win.offsetWidth, origX + (me.clientX - startX)));
        r.y = Math.max(28, Math.min(window.innerHeight - 30, origY + (me.clientY - startY)));
        win.style.left = `${r.x}px`;
        win.style.top = `${r.y}px`;
      };
      const onUp = () => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
      };
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
    });

    const resizer = win.querySelector('#fx-float-resize');
    resizer.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      e.stopPropagation();
      e.preventDefault();
      const startX = e.clientX;
      const startY = e.clientY;
      const origW = win.offsetWidth;
      const origH = win.offsetHeight;
      const onMove = (me) => {
        r.width = Math.max(280, Math.min(window.innerWidth - r.x - 8, origW + (me.clientX - startX)));
        r.height = Math.max(240, Math.min(window.innerHeight - r.y - 8, origH + (me.clientY - startY)));
        win.style.width = `${r.width}px`;
        win.style.height = `${r.height}px`;
      };
      const onUp = () => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
      };
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
    });

    win.querySelector('#fx-float-min')?.addEventListener('click', () => this.toggleMinimize());
    win.querySelector('#fx-float-dock')?.addEventListener('click', () => this.close({ dock: true }));
    win.querySelector('#fx-float-close')?.addEventListener('click', () => this.close({ dock: false }));
  }
}

export const atlasFxWindow = new AtlasFxFloatingWindow();
