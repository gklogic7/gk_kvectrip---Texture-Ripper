// Top Menu Bar with all 10 studio menus: File, Edit, Image, Selection, Texture, Seamless, Atlas, Export, View, Help
import { state, getActiveImage, getActiveRipper, setTheme } from '../core/app-state.js';
import { events } from '../core/event-manager.js';
import { history } from '../core/history-manager.js';
import { shortcuts } from '../core/shortcuts-manager.js';
import { projectManager } from '../core/project-manager.js';
import { closeImage, rotateActiveImage, loadProceduralSampleImage, openLocalImagesPicker } from '../canvas/image-loader.js';
import { textureManager } from '../texture/texture-manager.js';
import { resetRipperSeamlessDefaults } from '../texture/texture-ripper.js';
import { atlasManager } from '../atlas/atlas-manager.js';
import { exportProjectFile } from '../export/project-exporter.js';
import { ICONS } from './icons.js';
import { modals } from './modals.js';
import { floatingPreviews } from './preview-window.js';

export class MenuBarUI {
  constructor() {
    this.el = document.getElementById('top-menubar');
    this.openMenuId = null;
    this.dropdownEl = null;
    this.render();
    this._bindGlobalClose();
    events.on('theme:changed', () => this.render());
  }

  _bindGlobalClose() {
    window.addEventListener('pointerdown', (e) => {
      if (!this.openMenuId) return;
      if (this.el.contains(e.target) || (this.dropdownEl && this.dropdownEl.contains(e.target))) return;
      this.closeDropdown();
    });
  }

  getMenus() {
    const activeImg = getActiveImage();
    const activeRip = getActiveRipper();

    return [
      {
        id: 'file',
        label: 'File',
        items: [
          { label: 'Open Reference Image...', shortcut: shortcuts.getComboText('openImage'), action: () => openLocalImagesPicker() },
          { label: 'Replace Active Image...', disabled: !activeImg, action: () => openLocalImagesPicker({ replaceImageId: activeImg.id }) },
          { label: 'Load Sample Reference Sheet', action: () => loadProceduralSampleImage() },
          { separator: true },
          { label: 'Open Project (.json)...', action: () => document.getElementById('file-input-project').click() },
          { label: 'Save Project (.json)', shortcut: shortcuts.getComboText('saveProject'), action: () => exportProjectFile() },
          {
            label: 'Save Project As...',
            shortcut: shortcuts.getComboText('saveProjectAs'),
            action: () => modals.openSaveAsDialog((name) => exportProjectFile(name)),
          },
          { separator: true },
          { label: 'Close Active Image', disabled: !activeImg, action: () => closeImage(activeImg.id) },
          { label: 'Clear Local Autosave', action: () => { projectManager.clearAutosave(); events.emit('toast', { type: 'info', message: 'Cleared IndexedDB autosave' }); } },
        ],
      },
      {
        id: 'edit',
        label: 'Edit',
        items: [
          { label: 'Undo', shortcut: shortcuts.getComboText('undo'), disabled: !history.canUndo(), action: () => history.undo() },
          { label: 'Redo', shortcut: shortcuts.getComboText('redo'), disabled: !history.canRedo(), action: () => history.redo() },
          { separator: true },
          { label: 'Duplicate Selection', shortcut: shortcuts.getComboText('duplicateSelection'), disabled: !activeRip, action: () => textureManager.duplicateRipper(activeRip.id) },
          { label: 'Delete Selection', shortcut: shortcuts.getComboText('deleteSelection'), disabled: !activeRip, action: () => textureManager.deleteRipper(activeRip.id) },
          { separator: true },
          { label: 'Keyboard Shortcuts...', action: () => modals.openShortcutsModal() },
        ],
      },
      {
        id: 'image',
        label: 'Image',
        items: [
          { label: 'Rotate +90° Clockwise', disabled: !activeImg, action: () => rotateActiveImage(90) },
          { label: 'Rotate -90° Counter-Clockwise', disabled: !activeImg, action: () => rotateActiveImage(-90) },
          { label: 'Rotate 180°', disabled: !activeImg, action: () => rotateActiveImage(180) },
          { separator: true },
          { label: 'Crop & Transform...', disabled: !activeImg, action: () => modals.openCropRotateDialog() },
        ],
      },
      {
        id: 'selection',
        label: 'Selection',
        items: [
          { label: 'Confirm Polygon Draft', shortcut: shortcuts.getComboText('confirmPolygon'), action: () => events.emit('selection:confirmDraft') },
          { label: 'Cancel Polygon Draft', shortcut: shortcuts.getComboText('cancelSelection'), action: () => events.emit('selection:cancelDraft') },
          { separator: true },
          {
            label: activeRip?.style.visible ? 'Hide Active Polygon' : 'Show Active Polygon',
            disabled: !activeRip,
            action: () => {
              activeRip.style.visible = !activeRip.style.visible;
              events.emit('canvas:redrawOverlay');
              events.emit('ripper:selected', activeRip);
            },
          },
          {
            label: state.view.snapGrid ? '✓ Snap to Grid' : 'Snap to Grid',
            action: () => {
              state.view.snapGrid = !state.view.snapGrid;
              events.emit('view:changed');
            },
          },
          {
            label: state.view.snapEdges ? '✓ Snap to Image Edges' : 'Snap to Image Edges',
            action: () => {
              state.view.snapEdges = !state.view.snapEdges;
              events.emit('view:changed');
            },
          },
        ],
      },
      {
        id: 'texture',
        label: 'Texture',
        items: [
          { label: 'Open Floating Preview Window', disabled: !activeRip, action: () => floatingPreviews.openWindow(activeRip.id) },
          { label: 'Regenerate Active Texture', disabled: !activeRip, action: () => textureManager.processNow(activeRip.id) },
          {
            label: activeRip?.pixelArt.enabled ? '✓ Pixel-Art Mode' : 'Enable Pixel-Art Mode',
            disabled: !activeRip,
            action: () => {
              activeRip.pixelArt.enabled = !activeRip.pixelArt.enabled;
              textureManager.scheduleProcess(activeRip.id, 10);
              events.emit('ripper:selected', activeRip);
            },
          },
          {
            label: activeRip?.enabled ? 'Disable Ripper' : 'Enable Ripper',
            disabled: !activeRip,
            action: () => {
              activeRip.enabled = !activeRip.enabled;
              events.emit('rippers:changed', state.rippers);
              events.emit('canvas:redrawOverlay');
            },
          },
        ],
      },
      {
        id: 'seamless',
        label: 'Seamless',
        items: [
          {
            label: 'Open Seamless Editor Tab',
            action: () => {
              state.panels.bottomCollapsed = false;
              state.bottomTab = 'seamless';
              events.emit('bottom:tabChanged', 'seamless');
            },
          },
          { separator: true },
          { label: 'Method A: Smoothed Collage', disabled: !activeRip, action: () => this._setSeamlessMethod(activeRip, 'collage') },
          { label: 'Method B: Scattered Edges', disabled: !activeRip, action: () => this._setSeamlessMethod(activeRip, 'scattered') },
          { label: 'Method C: Offset & Blend', disabled: !activeRip, action: () => this._setSeamlessMethod(activeRip, 'offset') },
          { label: 'Method D: Mirror & Blend', disabled: !activeRip, action: () => this._setSeamlessMethod(activeRip, 'mirror') },
          { label: 'Method E: Clone Seam Repair', disabled: !activeRip, action: () => this._setSeamlessMethod(activeRip, 'clone') },
          { separator: true },
          {
            label: 'Randomize Seed',
            disabled: !activeRip,
            action: () => {
              activeRip.seamless.seed = Math.floor(Math.random() * 99999) + 1;
              textureManager.scheduleProcess(activeRip.id, 10);
              events.emit('ripper:selected', activeRip);
            },
          },
          {
            label: 'Reset Seamless & Detail Settings',
            disabled: !activeRip,
            action: () => {
              resetRipperSeamlessDefaults(activeRip);
              textureManager.scheduleProcess(activeRip.id, 10);
              events.emit('ripper:selected', activeRip);
              history.push(`Reset settings (${activeRip.name})`);
            },
          },
        ],
      },
      {
        id: 'atlas',
        label: 'Atlas',
        items: [
          {
            label: 'Open Atlas Editor Tab',
            action: () => {
              state.panels.bottomCollapsed = false;
              state.bottomTab = 'atlas';
              events.emit('bottom:tabChanged', 'atlas');
              atlasManager.rebuildAtlas();
            },
          },
          { label: 'Repack Texture Atlas', action: () => atlasManager.rebuildAtlas() },
          { label: 'Export Complete Atlas...', action: () => modals.openExportDialog('atlas') },
          { label: 'Export ZIP Package...', action: () => modals.openExportDialog('zip') },
        ],
      },
      {
        id: 'export',
        label: 'Export',
        items: [
          { label: 'Export Selected Texture...', shortcut: shortcuts.getComboText('exportTexture'), action: () => modals.openExportDialog('selected') },
          { label: 'Export All Textures...', action: () => modals.openExportDialog('all') },
          { separator: true },
          { label: 'Export Texture Atlas...', action: () => modals.openExportDialog('atlas') },
          { label: 'Export ZIP Bundle (Atlas + Textures + JSON)...', action: () => modals.openExportDialog('zip') },
        ],
      },
      {
        id: 'view',
        label: 'View',
        items: [
          { label: 'Fit Image to Screen', shortcut: shortcuts.getComboText('fitToScreen'), action: () => events.emit('view:fit') },
          { label: 'Zoom 100%', action: () => events.emit('view:zoom100') },
          { label: 'Reset View', action: () => events.emit('view:reset') },
          { separator: true },
          {
            label: state.view.showGrid ? '✓ Show Grid' : 'Show Grid',
            action: () => {
              state.view.showGrid = !state.view.showGrid;
              events.emit('view:changed');
            },
          },
          {
            label: state.view.showRuler ? '✓ Show Rulers' : 'Show Rulers',
            action: () => {
              state.view.showRuler = !state.view.showRuler;
              events.emit('view:changed');
            },
          },
          {
            label: state.view.pixelGrid ? '✓ Pixel Grid & Snap' : 'Pixel Grid & Snap',
            action: () => {
              state.view.pixelGrid = !state.view.pixelGrid;
              state.view.integerZoom = state.view.pixelGrid;
              events.emit('view:changed');
            },
          },
          { separator: true },
          { label: `${state.theme === 'dark' ? '✓ ' : ''}Theme: Dark Charcoal Studio`, action: () => setTheme('dark') },
          { label: `${state.theme === 'light' ? '✓ ' : ''}Theme: Classic XP Steel Light`, action: () => setTheme('light') },
          { label: `${state.theme === 'pixel' ? '✓ ' : ''}Theme: High-Contrast Pixel`, action: () => setTheme('pixel') },
        ],
      },
      {
        id: 'help',
        label: 'Help',
        items: [
          { label: 'KVectRip Workflow Guide', action: () => modals.openHelpModal('guide') },
          { label: 'Credits & Tech Stack', action: () => modals.openHelpModal('credits') },
          { separator: true },
          { label: 'Keyboard Shortcuts...', action: () => modals.openShortcutsModal() },
        ],
      },
    ];
  }

  _setSeamlessMethod(ripper, method) {
    if (!ripper) return;
    ripper.seamless.enabled = true;
    ripper.seamless.method = method;
    textureManager.scheduleProcess(ripper.id, 10);
    events.emit('ripper:selected', ripper);
    history.push(`Seamless method: ${method}`);
  }

  render() {
    const menus = this.getMenus();
    this.el.innerHTML = `
      <div class="menubar-left">
        <div class="menubar-brand">
          ${ICONS.brand}
          <span>KVectRip</span>
        </div>
        <nav class="menu-list" aria-label="Main menus">
          ${menus
            .map(
              (m) =>
                `<button type="button" class="menu-trigger ${this.openMenuId === m.id ? 'open' : ''}" data-menu-id="${m.id}">${m.label}</button>`
            )
            .join('')}
        </nav>
      </div>
      <div class="menubar-right">
        <button type="button" class="btn btn-sm" id="mb-theme-toggle" title="Toggle Dark Charcoal / XP Light theme">
          ${state.theme === 'light' ? 'Dark Theme' : 'Light Theme'}
        </button>
        <button type="button" class="btn btn-sm btn-primary" id="mb-export-btn">Export</button>
      </div>
    `;

    this.el.querySelectorAll('.menu-trigger').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const id = btn.dataset.menuId;
        if (this.openMenuId === id) {
          this.closeDropdown();
        } else {
          this.openDropdown(id, btn);
        }
      });
    });

    this.el.querySelector('#mb-theme-toggle').addEventListener('click', () => {
      setTheme(state.theme === 'light' ? 'dark' : 'light');
    });

    this.el.querySelector('#mb-export-btn').addEventListener('click', () => {
      modals.openExportDialog(getActiveRipper() ? 'selected' : 'atlas');
    });
  }

  openDropdown(menuId, triggerBtn) {
    this.closeDropdown();
    const menu = this.getMenus().find((m) => m.id === menuId);
    if (!menu) return;

    this.openMenuId = menuId;
    triggerBtn.classList.add('open');

    const rect = triggerBtn.getBoundingClientRect();
    const drop = document.createElement('div');
    drop.className = 'menu-dropdown';
    drop.style.left = `${rect.left}px`;
    drop.style.top = `${rect.bottom + 1}px`;

    for (const item of menu.items) {
      if (item.separator) {
        const sep = document.createElement('div');
        sep.className = 'menu-separator';
        drop.appendChild(sep);
        continue;
      }
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'menu-item';
      btn.disabled = !!item.disabled;
      btn.innerHTML = `
        <span>${item.label}</span>
        ${item.shortcut ? `<span class="menu-shortcut">${item.shortcut}</span>` : ''}
      `;
      btn.addEventListener('click', () => {
        this.closeDropdown();
        item.action?.();
      });
      drop.appendChild(btn);
    }

    document.body.appendChild(drop);
    this.dropdownEl = drop;
  }

  closeDropdown() {
    if (this.dropdownEl) {
      this.dropdownEl.remove();
      this.dropdownEl = null;
    }
    this.openMenuId = null;
    this.el.querySelectorAll('.menu-trigger.open').forEach((b) => b.classList.remove('open'));
  }
}
