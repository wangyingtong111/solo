import type { LayerStyle, LayerTransform, FilterConfig, ShadowConfig, StrokeConfig } from '@/types';

export const createDefaultStyle = (): LayerStyle => ({
  opacity: 1,
  blendMode: 'normal',
  visible: true,
  locked: false,
  shadow: createDefaultShadow(),
  stroke: createDefaultStroke(),
  filters: createDefaultFilters(),
});

export const createDefaultShadow = (): ShadowConfig => ({
  enabled: false,
  offsetX: 0,
  offsetY: 4,
  blur: 8,
  color: '#000000',
  opacity: 0.25,
});

export const createDefaultStroke = (): StrokeConfig => ({
  enabled: false,
  width: 1,
  color: '#000000',
  position: 'center',
});

export const createDefaultFilters = (): FilterConfig[] => [
  { type: 'brightness', value: 0, enabled: false },
  { type: 'contrast', value: 0, enabled: false },
  { type: 'saturation', value: 0, enabled: false },
  { type: 'hue-rotate', value: 0, enabled: false },
  { type: 'blur', value: 0, enabled: false },
  { type: 'sharpen', value: 0, enabled: false },
];

export const createDefaultTransform = (): LayerTransform => ({
  x: 0,
  y: 0,
  width: 0,
  height: 0,
  rotation: 0,
  scaleX: 1,
  scaleY: 1,
});

export const getBlendModeGL = (mode: string): { func: number; equation: number } => {
  const blendModes: Record<string, { func: number; equation: number }> = {
    'normal': { func: 0x8006, equation: 0x8006 },
    'multiply': { func: 0x8006, equation: 0x8006 },
    'screen': { func: 0x8006, equation: 0x8006 },
    'overlay': { func: 0x8006, equation: 0x8006 },
  };
  
  return blendModes[mode] || blendModes['normal'];
};

export const getCSSBlendMode = (mode: string): GlobalCompositeOperation => {
  return mode as GlobalCompositeOperation || 'source-over';
};
