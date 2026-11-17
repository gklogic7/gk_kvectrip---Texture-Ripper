// Central application state store
import { events } from './event-manager.js';

export const TOOL_IDS = {
  SELECT: 'select',
  POLYGON: 'polygon',
  RECT: 'rect',
  FREEFORM: 'freeform',
  VERTEX: 'vertex',
  MOVE: 'move',
  PAN: 'pan',
  ZOOM: 'zoom',
  PERSPECTIVE: 'perspective',
  ERASER: 'eraser',
};

export const MATERIAL_CATEGORIES = [
  'Wood',
  'Stone',
  'Concrete',
  'Metal',
  'Brick',
  'Ground',
  'Grass',
  'Sand',
  'Fabric',
  'Tiles',
  'Other',
];

export function createDefaultAtlasPostFx() {
  return {
    enabled: false,
    sharpness: 0,
    bloom: 0,
    exposure: 0,
    contrast: 0,
    saturation: 0,
    gamma: 1.0,
    chromaticAberration: 0,
    vignette: 0,
    grain: 0,
    edgeSoften: 0,
  };
}

export function createDefaultRipperFx() {
  return {
    filter: 'none',
    filterIntensity: 1,
    post: createDefaultAtlasPostFx(),
  };
}

export const state = {
  projectName: 'Untitled Project',
  theme: 'dark', // 'dark' | 'light' | 'pixel'
  activeTool: TOOL_IDS.POLYGON,
  inspectorTab: 'selection', // 'selection' | 'texture' | 'seamless' | 'detail' | 'pixel'
  bottomTab: 'library', // 'library' | 'seamless' | 'atlas' | 'history'
  panels: {
    leftCollapsed: false,
    rightCollapsed: false,
    bottomCollapsed: false,
    bottomExpanded: false,
    bottomMode: 'docked', // 'docked' | 'floating' | 'fullsize'
    bottomFloatRect: { x: 56, y: 72, width: 920, height: 400 },
    rightWidth: 310,
    bottomHeight: 220,
  },

  // Source images (non-destructive)
  images: [], // { id, name, width, height, mimeType, dataUrl, bitmap, offscreenCanvas, rotation, cropRect }
  activeImageId: null,

  // Canvas viewport transform
  view: {
    zoom: 1,
    panX: 0,
    panY: 0,
    showGrid: true,
    gridSize: 16,
    showRuler: true,
    snapGrid: false,
    snapEdges: true,
    pixelGrid: false,
    integerZoom: false,
  },

  // Active polygon drawing draft
  draftPolygon: {
    active: false,
    mode: null, // 'polygon' | 'rect' | 'freeform'
    points: [],
    hoverPoint: null,
    isDrawingFreeform: false,
  },

  // Independent Texture Ripper objects
  rippers: [],
  activeRipperId: null,
  selectedVertexIndex: -1,

  // Global selection style defaults for new rippers
  defaultStyle: {
    opacity: 0.24,
    outlineWidth: 2,
    outlineColor: '#3b82f6',
    vertexSize: 6,
    fillColor: '#3b82f6',
    visible: true,
  },

  // Texture library filters
  libraryFilter: {
    search: '',
    category: 'All',
    sortBy: 'created', // 'created' | 'name' | 'resolution'
    favoritesOnly: false,
  },

  // Atlas generator configuration
  atlas: {
    algorithm: 'maxrects', // 'maxrects' | 'shelf' | 'guillotine'
    aspectRatio: 'auto', // 'auto' | '1:1' | '16:9' | '9:16' | '4:3' | '3:4'
    maxWidth: 2048,
    maxHeight: 2048,
    padding: 4,
    spacing: 2,
    allowRotate: true,
    powerOfTwo: true,
    square: false,
    autoSize: true,
    arrayMode: false, // Default OFF: when ON, X/Y/Full scale repeats tiles instead of stretching
    arrayScale: 1, // Global uniform scale/array multiplier
    arrayScaleX: 1, // Global horizontal X scale/array multiplier
    arrayScaleY: 1, // Global vertical Y scale/array multiplier
    gizmoScaleMode: 'both', // 'whole' | 'array' | 'both' (Whole + Array combined when dragging Free Move Gizmo)
    transparent: true,
    bgColor: '#000000',
    showBounds: true,
    showNames: true,
    showUVs: false,
    freeMoveGizmo: false,
    snapEnabled: true,
    snapGridSize: 16,
    selectedPlacementId: null,
    manualOverrides: {}, // ripperId -> { x, y, innerW, innerH, angleDeg, tileScaleX, tileScaleY }
    items: [], // { ripperId, scale, scaleX, scaleY, tileScale, tileScaleX, tileScaleY, arrayEnabled, gizmoScaleMode, locked, customW, customH, order }
    packedResult: null, // { width, height, placements, efficiency, cleanCanvas, previewCanvas }
    fx: {
      subTab: 'packing', // 'packing' | 'fx'
      floating: false,
      minimized: false,
      floatRect: { x: 88, y: 86, width: 332, height: 480 },
      scope: 'overall', // 'overall' | 'item'
      selectedItemId: null,
      overallFilter: 'none',
      overallIntensity: 1,
      post: createDefaultAtlasPostFx(),
    },
    view: {
      zoom: 1,
      panX: 0,
      panY: 0,
      isFit: true,
      panMode: false,
    },
  },

  // Seamless Editor tab workspace configuration
  seamlessEditor: {
    tileCount: 2, // 1 | 2 | 3
    showGuides: true,
    splitCompare: false,
    splitRatio: 0.5,
    stagePreview: 'seamless', // 'seamless' | 'final'
    applyFx: true,
    tool: 'offset', // 'offset' | 'clone'
    brushRadius: 14,
    brushStrength: 0.9,
    cloneSource: { x: 0.5, y: 0.5 },
    view: {
      zoom: 1,
      panX: 0,
      panY: 0,
      isFit: true,
      panMode: false,
    },
  },

  // Floating preview windows state
  floatingPreviews: new Map(), // ripperId -> { x, y, width, height, stage, tileMode, bgMode, zoom, compareSplit, compareEnabled }
  workerJobs: new Map(), // ripperId -> { jobId, progress, stageLabel }
};

export function getActiveImage() {
  return state.images.find((img) => img.id === state.activeImageId) || null;
}

export function getActiveRipper() {
  return state.rippers.find((r) => r.id === state.activeRipperId) || null;
}

export function getRippersForActiveImage() {
  if (!state.activeImageId) return [];
  return state.rippers.filter((r) => r.sourceImageId === state.activeImageId);
}

export function setTheme(themeName) {
  const valid = ['dark', 'light', 'pixel'].includes(themeName) ? themeName : 'dark';
  state.theme = valid;
  const root = document.documentElement;
  root.classList.remove('theme-dark', 'theme-light', 'theme-pixel');
  root.classList.add(`theme-${valid}`);
  try {
    localStorage.setItem('texture_ripper_theme', valid);
  } catch {
    // ignore storage limits
  }
  events.emit('theme:changed', valid);
}

export function setActiveTool(toolId) {
  if (state.activeTool === toolId) return;
  state.activeTool = toolId;
  events.emit('tool:changed', toolId);
}

export function setActiveRipper(ripperId) {
  state.activeRipperId = ripperId;
  state.selectedVertexIndex = -1;
  events.emit('ripper:selected', getActiveRipper());
}

export function setActiveImage(imageId) {
  state.activeImageId = imageId;
  const firstRipper = state.rippers.find((r) => r.sourceImageId === imageId);
  if (state.activeRipperId) {
    const curr = getActiveRipper();
    if (!curr || curr.sourceImageId !== imageId) {
      state.activeRipperId = firstRipper ? firstRipper.id : null;
    }
  } else if (firstRipper) {
    state.activeRipperId = firstRipper.id;
  }
  events.emit('image:selected', getActiveImage());
  events.emit('ripper:selected', getActiveRipper());
}
