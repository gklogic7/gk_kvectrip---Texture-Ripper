// Application entry point: boots Texture Ripper studio modules, splitters, shortcuts, and file handlers
import { state, TOOL_IDS, setTheme, setActiveTool, getActiveImage, getActiveRipper } from './core/app-state.js';
import { events } from './core/event-manager.js';
import { history } from './core/history-manager.js';
import { shortcuts } from './core/shortcuts-manager.js';
import { projectManager } from './core/project-manager.js';
import { importImageFiles, openLocalImagesPicker } from './canvas/image-loader.js';
import { CanvasManager } from './canvas/canvas-manager.js';
import { textureManager } from './texture/texture-manager.js';
import { atlasManager } from './atlas/atlas-manager.js';
import { exportProjectFile, importProjectFile, restoreProjectPayload } from './export/project-exporter.js';
import { ICONS } from './ui/icons.js';
import { modals } from './ui/modals.js';
import { MenuBarUI } from './ui/menu-bar.js';
import { ToolbarUI } from './ui/toolbar-ui.js';
import { InspectorUI } from './ui/inspector-ui.js';
import { BottomPanelUI } from './ui/bottom-panel.js';

function initTheme() {
  try {
    const saved = localStorage.getItem('texture_ripper_theme');
    if (saved) setTheme(saved);
    else setTheme('dark');
  } catch {
    setTheme('dark');
  }
}

function initSplitters(canvasManager) {
  const rightSplitter = document.getElementById('splitter-right');
  const rightInspector = document.getElementById('right-inspector');
  const bottomSplitter = document.getElementById('splitter-bottom');
  const bottomPanel = document.getElementById('bottom-panel');

  rightSplitter.addEventListener('pointerdown', (e) => {
    if (state.panels.rightCollapsed) return;
    rightSplitter.classList.add('dragging');
    const startX = e.clientX;
    const startW = rightInspector.offsetWidth;
    const onMove = (me) => {
      const nextW = Math.max(240, Math.min(480, startW - (me.clientX - startX)));
      rightInspector.style.width = `${nextW}px`;
      state.panels.rightWidth = nextW;
      canvasManager.resize();
    };
    const onUp = () => {
      rightSplitter.classList.remove('dragging');
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  });

  bottomSplitter.addEventListener('pointerdown', (e) => {
    if (state.panels.bottomCollapsed) return;
    bottomSplitter.classList.add('dragging');
    const startY = e.clientY;
    const startH = bottomPanel.offsetHeight;
    const onMove = (me) => {
      const nextH = Math.max(120, Math.min(window.innerHeight * 0.55, startH - (me.clientY - startY)));
      bottomPanel.style.height = `${nextH}px`;
      state.panels.bottomHeight = nextH;
      canvasManager.resize();
    };
    const onUp = () => {
      bottomSplitter.classList.remove('dragging');
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  });
}

function initFileInputs() {
  const dropIconSlot = document.getElementById('dropzone-icon-slot');
  if (dropIconSlot) dropIconSlot.innerHTML = ICONS.imageDrop;

  const imgInput = document.getElementById('file-input-images');
  const replaceInput = document.getElementById('file-input-replace');
  const projInput = document.getElementById('file-input-project');

  document.getElementById('btn-dropzone-open')?.addEventListener('click', () => openLocalImagesPicker());
  document.getElementById('btn-dropzone-project')?.addEventListener('click', () => projInput.click());

  imgInput.addEventListener('change', async () => {
    if (imgInput.files?.length) {
      await importImageFiles(imgInput.files);
      imgInput.value = '';
    }
  });

  replaceInput.addEventListener('change', async () => {
    const active = getActiveImage();
    if (active && replaceInput.files?.length) {
      await importImageFiles([replaceInput.files[0]], { replaceImageId: active.id });
      replaceInput.value = '';
    }
  });

  projInput.addEventListener('change', async () => {
    if (projInput.files?.length) {
      try {
        await importProjectFile(projInput.files[0]);
      } catch (err) {
        events.emit('toast', { type: 'error', message: err.message || 'Failed to load project file.' });
      }
      projInput.value = '';
    }
  });
}

function registerShortcuts(canvasManager) {
  shortcuts.registerAction('openImage', () => openLocalImagesPicker());
  shortcuts.registerAction('saveProject', () => exportProjectFile());
  shortcuts.registerAction('saveProjectAs', () => modals.openSaveAsDialog((name) => exportProjectFile(name)));
  shortcuts.registerAction('undo', () => history.undo());
  shortcuts.registerAction('redo', () => history.redo());
  shortcuts.registerAction('deleteSelection', () => {
    if (state.activeTool === TOOL_IDS.VERTEX && state.selectedVertexIndex >= 0) {
      if (canvasManager.vertexEditor.deleteSelectedVertex()) return;
    }
    const active = getActiveRipper();
    if (active) textureManager.deleteRipper(active.id);
  });
  shortcuts.registerAction('duplicateSelection', () => {
    const active = getActiveRipper();
    if (active) textureManager.duplicateRipper(active.id);
  });
  shortcuts.registerAction('confirmPolygon', () => canvasManager.polygonTool.confirmDraft());
  shortcuts.registerAction('cancelSelection', () => {
    if (state.draftPolygon.active) {
      canvasManager.polygonTool.cancelDraft();
    } else if (!document.getElementById('modal-layer')?.hidden) {
      modals.close();
    } else if (state.panels.bottomMode === 'fullsize' || state.panels.bottomExpanded) {
      state.panels.bottomMode = 'docked';
      state.panels.bottomExpanded = false;
      events.emit('panel:layoutChanged');
    } else {
      modals.close();
    }
  });
  shortcuts.registerAction('exportTexture', () => modals.openExportDialog(getActiveRipper() ? 'selected' : 'atlas'));
  shortcuts.registerAction('fitToScreen', () => canvasManager.fitToScreen());
  shortcuts.registerAction('toolSelect', () => setActiveTool(TOOL_IDS.SELECT));
  shortcuts.registerAction('toolPolygon', () => setActiveTool(TOOL_IDS.POLYGON));
  shortcuts.registerAction('toolRect', () => setActiveTool(TOOL_IDS.RECT));
  shortcuts.registerAction('toolVertex', () => setActiveTool(TOOL_IDS.VERTEX));
  shortcuts.registerAction('toolMove', () => setActiveTool(TOOL_IDS.MOVE));

  events.on('selection:confirmDraft', () => canvasManager.polygonTool.confirmDraft());
  events.on('selection:cancelDraft', () => canvasManager.polygonTool.cancelDraft());
  events.on('view:zoom100', () => canvasManager.zoomTo100());
  events.on('panel:layoutChanged', () => {
    if (state.panels.bottomMode !== 'fullsize') {
      requestAnimationFrame(() => canvasManager.resize());
    }
  });

  shortcuts.attachGlobalListeners();
}

async function bootstrap() {
  initTheme();

  const canvasManager = new CanvasManager();
  new MenuBarUI();
  new ToolbarUI();
  new InspectorUI();
  new BottomPanelUI();

  initSplitters(canvasManager);
  initFileInputs();
  registerShortcuts(canvasManager);

  // Keep reference to atlasManager active
  void atlasManager;

  // Check IndexedDB for local autosave recovery without breaking empty-dropzone initial launch
  const saved = await projectManager.loadFromIndexedDB();
  if (saved && saved.images && saved.images.length > 0) {
    try {
      await restoreProjectPayload(saved);
      events.emit('toast', { type: 'info', message: 'Restored local offline autosave' });
    } catch {
      // Ignore corrupt autosave and remain on empty dropzone
    }
  }
}

bootstrap();
