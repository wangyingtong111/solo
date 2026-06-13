export type BlendMode = 
  | 'normal' | 'multiply' | 'screen' | 'overlay' | 'darken' 
  | 'lighten' | 'color-dodge' | 'color-burn' | 'hard-light' 
  | 'soft-light' | 'difference' | 'exclusion' | 'hue' 
  | 'saturation' | 'color' | 'luminosity';

export type FilterType = 
  | 'brightness' | 'contrast' | 'saturation' | 'hue-rotate'
  | 'blur' | 'sharpen' | 'vintage' | 'grayscale' | 'sepia'
  | 'invert' | 'emboss' | 'gaussian-blur' | 'box-blur';

export interface FilterConfig {
  type: FilterType;
  value: number;
  enabled: boolean;
}

export interface ShadowConfig {
  enabled: boolean;
  offsetX: number;
  offsetY: number;
  blur: number;
  color: string;
  opacity: number;
}

export interface StrokeConfig {
  enabled: boolean;
  width: number;
  color: string;
  position: 'inside' | 'outside' | 'center';
}

export interface LayerStyle {
  opacity: number;
  blendMode: BlendMode;
  visible: boolean;
  locked: boolean;
  shadow: ShadowConfig;
  stroke: StrokeConfig;
  filters: FilterConfig[];
}

export interface LayerTransform {
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  scaleX: number;
  scaleY: number;
}

export interface LayerMask {
  enabled: boolean;
  data: Uint8ClampedArray | null;
  invert: boolean;
}

export interface BaseLayer {
  id: string;
  name: string;
  type: 'image' | 'text' | 'shape' | 'adjustment' | 'group';
  style: LayerStyle;
  transform: LayerTransform;
  mask: LayerMask;
  parentId: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface ImageLayer extends BaseLayer {
  type: 'image';
  imageData: ImageData | null;
  textureId: string | null;
  originalImage: HTMLImageElement | null;
  originalWidth: number;
  originalHeight: number;
}

export interface TextLayer extends BaseLayer {
  type: 'text';
  content: string;
  fontSize: number;
  fontFamily: string;
  color: string;
  fontWeight: number;
  fontStyle: 'normal' | 'italic';
  textAlign: 'left' | 'center' | 'right';
  lineHeight: number;
  letterSpacing: number;
}

export interface ShapeLayer extends BaseLayer {
  type: 'shape';
  shapeType: 'rectangle' | 'ellipse' | 'polygon' | 'path';
  fill: string;
  stroke: {
    width: number;
    color: string;
  };
  pathData?: string;
}

export interface AdjustmentLayer extends BaseLayer {
  type: 'adjustment';
  adjustmentType: 'curves' | 'levels' | 'color-balance' | 'channel-mixer';
  data: Record<string, unknown>;
}

export interface GroupLayer extends BaseLayer {
  type: 'group';
  children: string[];
  collapsed: boolean;
}

export type Layer = ImageLayer | TextLayer | ShapeLayer | AdjustmentLayer | GroupLayer;

export interface CanvasState {
  width: number;
  height: number;
  zoom: number;
  panX: number;
  panY: number;
  backgroundColor: string;
  showGrid: boolean;
  showGuides: boolean;
  showRulers: boolean;
  pixelRatio: number;
}

export interface HistoryState {
  past: EditorState[];
  future: EditorState[];
  maxHistory: number;
}

export interface SelectionState {
  activeLayerId: string | null;
  selectedLayerIds: string[];
  marquee: { x: number; y: number; width: number; height: number } | null;
}

export interface EditorState {
  layers: Layer[];
  canvas: CanvasState;
  selection: SelectionState;
  history: HistoryState;
}

export interface FilterWorkerMessage {
  type: 'apply-filter' | 'cancel';
  id: string;
  filterType?: FilterType;
  value?: number;
  imageData?: ImageData;
  width?: number;
  height?: number;
}

export interface FilterWorkerResult {
  id: string;
  success: boolean;
  imageData?: ImageData;
  error?: string;
}

export interface AISegmentationResult {
  mask: Uint8ClampedArray;
  width: number;
  height: number;
  confidence: number;
}

export interface PSDLayerInfo {
  name: string;
  opacity: number;
  blendMode: string;
  visible: boolean;
  x: number;
  y: number;
  width: number;
  height: number;
  imageData: ImageData | null;
  textData?: {
    text: string;
    fontSize: number;
    fontFamily: string;
    color: string;
  };
}

export interface TextureCacheEntry {
  texture: WebGLTexture;
  width: number;
  height: number;
  lastUsed: number;
  refCount: number;
}
