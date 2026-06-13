import type { PSDLayerInfo, ImageLayer, Layer } from '@/types';
import { readPsd, Psd } from 'ag-psd';
import { createDefaultStyle, createDefaultTransform } from '@/utils/layer';
import { generateId } from '@/utils/id';

export class PSDParserService {
  private psdData: Psd | null = null;

  public async parseFile(file: File): Promise<PSDLayerInfo[]> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      
      reader.onload = async (e) => {
        try {
          const buffer = e.target?.result as ArrayBuffer;
          const uint8Array = new Uint8Array(buffer);
          
          this.psdData = readPsd(uint8Array, {
            skipLayerImageData: false,
            useImageData: true,
          });
          
          const layers = this.extractLayers();
          resolve(layers);
        } catch (error) {
          reject(error);
        }
      };
      
      reader.onerror = () => reject(reader.error);
      reader.readAsArrayBuffer(file);
    });
  }

  private extractLayers(): PSDLayerInfo[] {
    if (!this.psdData?.children) {
      return [];
    }
    
    const layers: PSDLayerInfo[] = [];
    
    const processLayer = (layer: any, parentVisible: boolean = true): void => {
      if (layer.children) {
        const groupVisible = parentVisible && layer.visible !== false;
        layer.children.forEach((child: any) => processLayer(child, groupVisible));
        return;
      }
      
      const canvas = layer.canvas as HTMLCanvasElement | undefined;
      let imageData: ImageData | null = null;
      
      if (canvas) {
        const ctx = canvas.getContext('2d');
        if (ctx) {
          imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        }
      }
      
      const layerInfo: PSDLayerInfo = {
        name: layer.name || '未命名图层',
        opacity: (layer.opacity ?? 255) / 255,
        blendMode: this.convertBlendMode(layer.blendMode),
        visible: parentVisible && layer.visible !== false,
        x: layer.left || 0,
        y: layer.top || 0,
        width: (layer.right || 0) - (layer.left || 0),
        height: (layer.bottom || 0) - (layer.top || 0),
        imageData,
      };
      
      if (layer.text) {
        layerInfo.textData = {
          text: layer.text.text || '',
          fontSize: layer.text.fontSize || 16,
          fontFamily: layer.text.font?.name || 'Arial',
          color: layer.text.fillColor ? this.rgbToHex(layer.text.fillColor) : '#000000',
        };
      }
      
      layers.push(layerInfo);
    };
    
    for (let i = this.psdData.children.length - 1; i >= 0; i--) {
      processLayer(this.psdData.children[i]);
    }
    
    return layers;
  }

  private convertBlendMode(blendMode: string | undefined): string {
    const modeMap: Record<string, string> = {
      'norm': 'normal',
      'mul ': 'multiply',
      'scrn': 'screen',
      'over': 'overlay',
      'dark': 'darken',
      'lite': 'lighten',
      'div ': 'color-dodge',
      'idiv': 'color-burn',
      'hLit': 'hard-light',
      'sLit': 'soft-light',
      'diff': 'difference',
      'smud': 'exclusion',
      'hue ': 'hue',
      'sat ': 'saturation',
      'colr': 'color',
      'lum ': 'luminosity',
    };
    
    return modeMap[blendMode || ''] || 'normal';
  }

  private rgbToHex(rgb: { r: number; g: number; b: number }): string {
    const toHex = (n: number) => Math.round(n * 255).toString(16).padStart(2, '0');
    return `#${toHex(rgb.r)}${toHex(rgb.g)}${toHex(rgb.b)}`;
  }

  public convertToEditorLayers(psdLayers: PSDLayerInfo[], canvasWidth: number, canvasHeight: number): Layer[] {
    const layers: Layer[] = [];
    const now = Date.now();
    
    for (const psdLayer of psdLayers) {
      if (psdLayer.textData && psdLayer.textData.text) {
        layers.push(this.createTextLayer(psdLayer, now));
      } else if (psdLayer.imageData) {
        layers.push(this.createImageLayer(psdLayer, now, canvasWidth, canvasHeight));
      }
    }
    
    return layers;
  }

  private createImageLayer(psdLayer: PSDLayerInfo, timestamp: number, canvasWidth: number, canvasHeight: number): ImageLayer {
    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = psdLayer.width;
    tempCanvas.height = psdLayer.height;
    const tempCtx = tempCanvas.getContext('2d')!;
    
    if (psdLayer.imageData) {
      tempCtx.putImageData(psdLayer.imageData, 0, 0);
    }
    
    const img = new Image();
    img.src = tempCanvas.toDataURL();
    
    const scaledWidth = Math.min(psdLayer.width, canvasWidth * 0.8);
    const scaledHeight = (psdLayer.height / psdLayer.width) * scaledWidth;
    
    const centerX = (canvasWidth - scaledWidth) / 2;
    const centerY = (canvasHeight - scaledHeight) / 2;
    
    return {
      id: generateId(),
      name: psdLayer.name,
      type: 'image',
      style: {
        ...createDefaultStyle(),
        opacity: psdLayer.opacity,
        blendMode: psdLayer.blendMode as any,
        visible: psdLayer.visible,
      },
      transform: {
        ...createDefaultTransform(),
        x: centerX,
        y: centerY,
        width: scaledWidth,
        height: scaledHeight,
        scaleX: scaledWidth / psdLayer.width,
        scaleY: scaledHeight / psdLayer.height,
      },
      mask: {
        enabled: false,
        data: null,
        invert: false,
      },
      parentId: null,
      createdAt: timestamp,
      updatedAt: timestamp,
      imageData: psdLayer.imageData,
      textureId: null,
      originalImage: img,
      originalWidth: psdLayer.width,
      originalHeight: psdLayer.height,
    };
  }

  private createTextLayer(psdLayer: any, timestamp: number): Layer {
    return {
      id: generateId(),
      name: psdLayer.name,
      type: 'text',
      style: {
        ...createDefaultStyle(),
        opacity: psdLayer.opacity,
        blendMode: psdLayer.blendMode as any,
        visible: psdLayer.visible,
      },
      transform: {
        ...createDefaultTransform(),
        x: psdLayer.x,
        y: psdLayer.y,
        width: psdLayer.width,
        height: psdLayer.height,
      },
      mask: {
        enabled: false,
        data: null,
        invert: false,
      },
      parentId: null,
      createdAt: timestamp,
      updatedAt: timestamp,
      content: psdLayer.textData.text,
      fontSize: psdLayer.textData.fontSize,
      fontFamily: psdLayer.textData.fontFamily,
      color: psdLayer.textData.color,
      fontWeight: 400,
      fontStyle: 'normal',
      textAlign: 'left',
      lineHeight: 1.2,
      letterSpacing: 0,
    };
  }

  public getCanvasSize(): { width: number; height: number } | null {
    if (!this.psdData) return null;
    return {
      width: this.psdData.width || 0,
      height: this.psdData.height || 0,
    };
  }

  public getPsdData(): Psd | null {
    return this.psdData;
  }

  public reset(): void {
    this.psdData = null;
  }
}

export const psdParserService = new PSDParserService();
