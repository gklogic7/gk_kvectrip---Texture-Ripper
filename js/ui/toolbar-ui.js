// Left Toolbar (10 studio tools) + Workspace Top Bar (open image tabs & quick viewport toggles)
import { state, TOOL_IDS, setActiveTool, setActiveImage, getActiveImage } from '../core/app-state.js';
import { events } from '../core/event-manager.js';
import { closeImage, openLocalImagesPicker } from '../canvas/image-loader.js';
import { ICONS } from './icons.js';

const TOOLS = [
  { id: TOOL_IDS.SELECT, label: 'Select (V)', icon: ICONS.select, group: 1 },
  { id: TOOL_IDS.POLYGON, label: 'Polygon Ripper (P)', icon: ICONS.polygon, group: 1 },
  { id: TOOL_IDS.RECT, label: 'Rectangle Selection (R)', icon: ICONS.rect, group: 1 },
  { id: TOOL_IDS.FREEFORM, label: 'Freeform Polygon', icon: ICONS.freeform, group: 1 },
  { id: TOOL_IDS.VERTEX, label: 'Vertex Edit (A)', icon: ICONS.vertex, group: 2 },
  { id: TOOL_IDS.MOVE, label: 'Move Polygon (M)', icon: ICONS.move, group: 2 },
  { id: TOOL_IDS.PERSPECTIVE, label: 'Perspective Tool', icon: ICONS.perspective, group: 2 },
  { id: TOOL_IDS.ERASER, label: 'Eraser / Remove Vertex', icon: ICONS.eraser, group: 2 },
  { id: TOOL_IDS.PAN, label: 'Pan Canvas (Space+Drag)', icon: ICONS.pan, group: 3 },
  { id: TOOL_IDS.ZOOM, label: 'Zoom Tool (Alt+Click out)', icon: ICONS.zoom, group: 3 },
];

export class ToolbarUI {
  constructor() {
    this.leftEl = document.getElementById('left-toolbar');
    this.topBarEl = document.getElementById('workspace-topbar');
    this.renderLeft();
    this.renderWorkspaceTopBar();

    events.on('tool:changed', () => this.renderLeft());
    events.on('images:changed', () => this.renderWorkspaceTopBar());
    events.on('image:selected', () => this.renderWorkspaceTopBar());
    events.on('view:changed', () => this.renderWorkspaceTopBar());
  }

  renderLeft() {
    const collapsed = state.panels.leftCollapsed;
    this.leftEl.classList.toggle('collapsed', collapsed);

    const g1 = TOOLS.filter((t) => t.group === 1);
    const g2 = TOOLS.filter((t) => t.group === 2);
    const g3 = TOOLS.filter((t) => t.group === 3);

    const renderBtns = (list) =>
      list
        .map(
          (t) => `
          <button type="button" class="tool-btn ${state.activeTool === t.id ? 'active' : ''}" data-tool="${t.id}" title="${t.label}" aria-label="${t.label}">
            ${t.icon}
          </button>`
        )
        .join('');

    this.leftEl.innerHTML = `
      <button type="button" class="toolbar-collapse-btn" id="btn-collapse-left" title="${collapsed ? 'Expand toolbar' : 'Collapse toolbar'}">
        ${collapsed ? '»' : '«'}
      </button>
      <div class="tool-group">${renderBtns(g1)}</div>
      <div class="toolbar-divider"></div>
      <div class="tool-group">${renderBtns(g2)}</div>
      <div class="toolbar-divider"></div>
      <div class="tool-group">${renderBtns(g3)}</div>
    `;

    this.leftEl.querySelector('#btn-collapse-left').addEventListener('click', () => {
      state.panels.leftCollapsed = !state.panels.leftCollapsed;
      this.renderLeft();
    });

    this.leftEl.querySelectorAll('.tool-btn').forEach((btn) => {
      btn.addEventListener('click', () => setActiveTool(btn.dataset.tool));
    });
  }

  renderWorkspaceTopBar() {
    const active = getActiveImage();
    const tabsHtml = state.images.length
      ? state.images
          .map(
            (img) => `
            <div class="image-tab ${img.id === state.activeImageId ? 'active' : ''}" data-img-id="${img.id}" title="${img.name} (${img.width}×${img.height})">
              <span class="image-tab-name">${img.name}</span>
              <button type="button" class="image-tab-close" data-close-img="${img.id}" aria-label="Close ${img.name}">✕</button>
            </div>
          `
          )
          .join('')
      : `<span style="font-size:11px;color:var(--text-muted)">No source image loaded</span>`;

    this.topBarEl.innerHTML = `
      <div class="image-tabs">
        ${tabsHtml}
        <button type="button" class="btn btn-sm" id="wt-add-img" title="Import more images">+ Add</button>
      </div>
      <div class="workspace-actions">
        <button type="button" class="btn btn-sm ${state.view.showGrid ? 'btn-primary' : ''}" id="wt-grid" title="Toggle reference grid">Grid</button>
        <button type="button" class="btn btn-sm ${state.view.showRuler ? 'btn-primary' : ''}" id="wt-ruler" title="Toggle pixel rulers">Ruler</button>
        <button type="button" class="btn btn-sm ${state.view.snapGrid ? 'btn-primary' : ''}" id="wt-snap-grid" title="Snap vertices to grid">Snap Grid</button>
        <button type="button" class="btn btn-sm ${state.view.snapEdges ? 'btn-primary' : ''}" id="wt-snap-edge" title="Snap vertices to image edges">Snap Edge</button>
        <button type="button" class="btn btn-sm ${state.view.pixelGrid ? 'btn-primary' : ''}" id="wt-pixel" title="Pixel-art grid & integer zoom">Pixel Grid</button>
        <button type="button" class="btn btn-sm" id="wt-fit" ${!active ? 'disabled' : ''} title="Fit image to screen (F)">Fit</button>
        <button type="button" class="btn btn-sm" id="wt-100" ${!active ? 'disabled' : ''} title="100% actual pixels">100%</button>
        <button type="button" class="btn btn-sm" id="wt-reset" ${!active ? 'disabled' : ''} title="Reset view">Reset</button>
      </div>
    `;

    this.topBarEl.querySelector('#wt-add-img').addEventListener('click', () => {
      openLocalImagesPicker();
    });

    this.topBarEl.querySelectorAll('.image-tab').forEach((tab) => {
      tab.addEventListener('click', (e) => {
        if (e.target.closest('.image-tab-close')) return;
        setActiveImage(tab.dataset.imgId);
      });
    });

    this.topBarEl.querySelectorAll('.image-tab-close').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        closeImage(btn.dataset.closeImg);
      });
    });

    this.topBarEl.querySelector('#wt-grid').addEventListener('click', () => {
      state.view.showGrid = !state.view.showGrid;
      events.emit('view:changed');
    });
    this.topBarEl.querySelector('#wt-ruler').addEventListener('click', () => {
      state.view.showRuler = !state.view.showRuler;
      events.emit('view:changed');
    });
    this.topBarEl.querySelector('#wt-snap-grid').addEventListener('click', () => {
      state.view.snapGrid = !state.view.snapGrid;
      events.emit('view:changed');
    });
    this.topBarEl.querySelector('#wt-snap-edge').addEventListener('click', () => {
      state.view.snapEdges = !state.view.snapEdges;
      events.emit('view:changed');
    });
    this.topBarEl.querySelector('#wt-pixel').addEventListener('click', () => {
      state.view.pixelGrid = !state.view.pixelGrid;
      state.view.integerZoom = state.view.pixelGrid;
      events.emit('view:changed');
    });
    this.topBarEl.querySelector('#wt-fit').addEventListener('click', () => events.emit('view:fit'));
    this.topBarEl.querySelector('#wt-100').addEventListener('click', () => events.emit('view:zoom100'));
    this.topBarEl.querySelector('#wt-reset').addEventListener('click', () => events.emit('view:reset'));
  }
}
