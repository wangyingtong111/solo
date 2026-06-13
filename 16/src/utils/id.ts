export const generateId = (): string => {
  return `layer_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
};

export const generateTextureId = (): string => {
  return `tex_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
};
