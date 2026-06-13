import { create } from 'zustand';
import type { 
  Layer, EditorState, CanvasState, SelectionState, 
  HistoryState, LayerStyle, LayerTransform, BlendMode 
} from '@/types';
import { generateId } from '@/utils/id';
import { createDefaultStyle, createDefaultTransform } from '@/utils/layer';

interface EditorStore extends EditorState {
  setCanvasSize: (width: number, height: number) => void;
  setZoom: (zoom: number) => void;
  setPan: (x: number, y: number) => void;
  
  addLayer: (layer: Omit<Layer, 'id' | 'createdAt' | 'updatedAt'>) => void;
  removeLayer: (id: string) => void;
  updateLayer: (id: string, updates: Partial<Layer>) => void;
  duplicateLayer: (id: string) => void;
  moveLayer: (fromIndex: number, toIndex: number) => void;
  
  setActiveLayer: (id: string | null) => void;
  selectLayers: (ids: string[]) => void;
  
  updateLayerStyle: (id: string, style: Partial<LayerStyle>) => void;
  updateLayerTransform: (id: string, transform: Partial<LayerTransform>) => void;
  updateLayerBlendMode: (id: string, blendMode: BlendMode) => void;
  updateLayerOpacity: (id: string, opacity: number) => void;
  toggleLayerVisibility: (id: string) => void;
  toggleLayerLock: (id: string) => void;
  
  canUndo: () => boolean;
  canRedo: () => boolean;
  undo: () => void;
  redo: () => void;
  saveHistory: () => void;
  
  reset: () => void;
}

const createInitialCanvasState = (): CanvasState => ({
  width: 1920,
  height: 1080,
  zoom: 1,
  panX: 0,
  panY: 0,
  backgroundColor: '#ffffff',
  showGrid: false,
  showGuides: false,
  showRulers: false,
  pixelRatio: window.devicePixelRatio || 1,
});

const createInitialSelectionState = (): SelectionState => ({
  activeLayerId: null,
  selectedLayerIds: [],
  marquee: null,
});

const createInitialHistoryState = (): HistoryState => ({
  past: [],
  future: [],
  maxHistory: 50,
});

const createInitialState = (): EditorState => ({
  layers: [],
  canvas: createInitialCanvasState(),
  selection: createInitialSelectionState(),
  history: createInitialHistoryState(),
});

let stateSnapshot: EditorState | null = null;

export const useEditorStore = create<EditorStore>((set, get) => ({
  ...createInitialState(),

  setCanvasSize: (width: number, height: number) => 
    set(state => ({
      canvas: { ...state.canvas, width, height },
    })),

  setZoom: (zoom: number) => 
    set(state => ({
      canvas: { ...state.canvas, zoom: Math.max(0.1, Math.min(10, zoom)) },
    })),

  setPan: (x: number, y: number) => 
    set(state => ({
      canvas: { ...state.canvas, panX: x, panY: y },
    })),

  addLayer: (layerData) => {
    const now = Date.now();
    const newLayer: Layer = {
      ...layerData,
      id: generateId(),
      createdAt: now,
      updatedAt: now,
      style: { ...createDefaultStyle(), ...layerData.style },
      transform: { ...createDefaultTransform(), ...layerData.transform },
    } as Layer;
    
    set(state => ({
      layers: [...state.layers, newLayer],
      selection: {
        ...state.selection,
        activeLayerId: newLayer.id,
        selectedLayerIds: [newLayer.id],
      },
    }));
    
    get().saveHistory();
  },

  removeLayer: (id: string) => 
    set(state => {
      const layers = state.layers.filter(l => l.id !== id);
      const activeId = state.selection.activeLayerId === id 
        ? (layers.length > 0 ? layers[layers.length - 1].id : null)
        : state.selection.activeLayerId;
      
      return {
        layers,
        selection: {
          ...state.selection,
          activeLayerId: activeId,
          selectedLayerIds: state.selection.selectedLayerIds.filter(i => i !== id),
        },
      };
    }),

  updateLayer: (id: string, updates: Partial<Layer>) => 
    set((state: EditorStore) => ({
      layers: state.layers.map(layer =>
        layer.id === id 
          ? ({ ...layer, ...updates, updatedAt: Date.now() } as Layer)
          : layer
      ),
    })),

  duplicateLayer: (id: string) => {
    const { layers, saveHistory } = get();
    const layer = layers.find(l => l.id === id);
    if (!layer) return;
    
    const now = Date.now();
    const duplicated: Layer = {
      ...JSON.parse(JSON.stringify(layer)),
      id: generateId(),
      name: `${layer.name} 副本`,
      createdAt: now,
      updatedAt: now,
      transform: {
        ...layer.transform,
        x: layer.transform.x + 20,
        y: layer.transform.y + 20,
      },
    };
    
    set(state => ({
      layers: [...state.layers, duplicated],
      selection: {
        ...state.selection,
        activeLayerId: duplicated.id,
        selectedLayerIds: [duplicated.id],
      },
    }));
    
    saveHistory();
  },

  moveLayer: (fromIndex: number, toIndex: number) => 
    set(state => {
      const layers = [...state.layers];
      const [removed] = layers.splice(fromIndex, 1);
      layers.splice(toIndex, 0, removed);
      return { layers };
    }),

  setActiveLayer: (id: string | null) => 
    set(state => ({
      selection: {
        ...state.selection,
        activeLayerId: id,
        selectedLayerIds: id ? [id] : [],
      },
    })),

  selectLayers: (ids: string[]) => 
    set(state => ({
      selection: {
        ...state.selection,
        selectedLayerIds: ids,
        activeLayerId: ids.length > 0 ? ids[0] : null,
      },
    })),

  updateLayerStyle: (id: string, style: Partial<LayerStyle>) => 
    set(state => ({
      layers: state.layers.map(layer =>
        layer.id === id
          ? { 
              ...layer, 
              style: { ...layer.style, ...style },
              updatedAt: Date.now(),
            }
          : layer
      ),
    })),

  updateLayerTransform: (id: string, transform: Partial<LayerTransform>) => 
    set(state => ({
      layers: state.layers.map(layer =>
        layer.id === id
          ? {
              ...layer,
              transform: { ...layer.transform, ...transform },
              updatedAt: Date.now(),
            }
          : layer
      ),
    })),

  updateLayerBlendMode: (id: string, blendMode: BlendMode) => {
    get().updateLayerStyle(id, { blendMode });
    get().saveHistory();
  },

  updateLayerOpacity: (id: string, opacity: number) => {
    get().updateLayerStyle(id, { opacity: Math.max(0, Math.min(1, opacity)) });
  },

  toggleLayerVisibility: (id: string) => {
    const layer = get().layers.find(l => l.id === id);
    if (layer) {
      get().updateLayerStyle(id, { visible: !layer.style.visible });
    }
  },

  toggleLayerLock: (id: string) => {
    const layer = get().layers.find(l => l.id === id);
    if (layer) {
      get().updateLayerStyle(id, { locked: !layer.style.locked });
    }
  },

  canUndo: () => get().history.past.length > 0,
  canRedo: () => get().history.future.length > 0,

  saveHistory: () => {
    const state = get();
    const snapshot: EditorState = {
      layers: JSON.parse(JSON.stringify(state.layers)),
      canvas: { ...state.canvas },
      selection: { ...state.selection },
      history: { ...state.history },
    };
    
    set(state => ({
      history: {
        ...state.history,
        past: [...state.history.past, snapshot].slice(-state.history.maxHistory),
        future: [],
      },
    }));
  },

  undo: () => {
    const state = get();
    if (state.history.past.length === 0) return;
    
    const past = [...state.history.past];
    const previous = past.pop()!;
    
    const current: EditorState = {
      layers: JSON.parse(JSON.stringify(state.layers)),
      canvas: { ...state.canvas },
      selection: { ...state.selection },
      history: { ...state.history },
    };
    
    set({
      ...previous,
      history: {
        ...state.history,
        past,
        future: [current, ...state.history.future],
      },
    });
  },

  redo: () => {
    const state = get();
    if (state.history.future.length === 0) return;
    
    const future = [...state.history.future];
    const next = future.shift()!;
    
    const current: EditorState = {
      layers: JSON.parse(JSON.stringify(state.layers)),
      canvas: { ...state.canvas },
      selection: { ...state.selection },
      history: { ...state.history },
    };
    
    set({
      ...next,
      history: {
        ...state.history,
        past: [...state.history.past, current],
        future,
      },
    });
  },

  reset: () => {
    stateSnapshot = null;
    set(createInitialState());
  },
}));

export const startTransaction = () => {
  const state = useEditorStore.getState();
  stateSnapshot = {
    layers: JSON.parse(JSON.stringify(state.layers)),
    canvas: { ...state.canvas },
    selection: { ...state.selection },
    history: { ...state.history },
  };
};

export const commitTransaction = () => {
  if (stateSnapshot) {
    const state = useEditorStore.getState();
    useEditorStore.setState({
      history: {
        ...state.history,
        past: [...state.history.past, stateSnapshot].slice(-state.history.maxHistory),
        future: [],
      },
    });
    stateSnapshot = null;
  }
};
