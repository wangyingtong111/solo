import type { Layer, ImageLayer } from '@/types';
import { WebGLRenderer } from '@/engine/WebGLRenderer';

export type ExportFormat = 'png' | 'jpeg' | 'webp' | 'svg' | 'json';

interface ExportOptions {
  format: ExportFormat;
  quality?: number;
  scale?: number;
  transparent?: boolean;
  onlySelected?: boolean;
  includeMetadata?: boolean;
}

export class ExportService {
  private renderer: WebGLRenderer | null = null;

  public setRenderer(renderer: WebGLRenderer): void {
    this.renderer = renderer;
  }

  public async export(
    layers: Layer[],
    canvasSize: { width: number; height: number },
    options: ExportOptions
  ): Promise<Blob> {
    const { format = 'png', quality = 0.92, scale = 1, transparent = false, onlySelected = false } = options;
    
    const exportLayers = onlySelected 
      ? layers.filter(l => l.style.visible)
      : layers.filter(l => l.style.visible);
    
    switch (format) {
      case 'png':
      case 'jpeg':
      case 'webp':
        return this.exportAsRaster(exportLayers, canvasSize, format, quality, scale, transparent);
      case 'svg':
        return this.exportAsSVG(exportLayers, canvasSize, scale);
      case 'json':
        return this.exportAsJSON(layers, canvasSize);
      default:
        throw new Error(`Unsupported format: ${format}`);
    }
  }

  private async exportAsRaster(
    layers: Layer[],
    canvasSize: { width: number; height: number },
    format: 'png' | 'jpeg' | 'webp',
    quality: number,
    scale: number,
    transparent: boolean
  ): Promise<Blob> {
    const exportCanvas = document.createElement('canvas');
    exportCanvas.width = Math.floor(canvasSize.width * scale);
    exportCanvas.height = Math.floor(canvasSize.height * scale);
    
    const ctx = exportCanvas.getContext('2d')!;
    
    if (!transparent && format !== 'png') {
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, exportCanvas.width, exportCanvas.height);
    }
    
    ctx.scale(scale, scale);
    
    for (const layer of layers) {
      if (!layer.style.visible) continue;
      
      ctx.save();
      ctx.globalAlpha = layer.style.opacity;
      ctx.globalCompositeOperation = this.getCompositeOperation(layer.style.blendMode);
      
      const { transform } = layer;
      ctx.translate(transform.x + transform.width / 2, transform.y + transform.height / 2);
      ctx.rotate(transform.rotation);
      ctx.scale(transform.scaleX, transform.scaleY);
      ctx.translate(-transform.width / 2, -transform.height / 2);
      
      if (layer.style.shadow.enabled) {
        ctx.shadowColor = layer.style.shadow.color;
        ctx.shadowBlur = layer.style.shadow.blur;
        ctx.shadowOffsetX = layer.style.shadow.offsetX;
        ctx.shadowOffsetY = layer.style.shadow.offsetY;
      }
      
      if (layer.type === 'image') {
        await this.drawImageLayer(ctx, layer, transform);
      } else if (layer.type === 'text') {
        this.drawTextLayer(ctx, layer);
      } else if (layer.type === 'shape') {
        this.drawShapeLayer(ctx, layer);
      }
      
      ctx.restore();
    }
    
    const mimeType = format === 'png' ? 'image/png' : format === 'jpeg' ? 'image/jpeg' : 'image/webp';
    return new Promise((resolve, reject) => {
      exportCanvas.toBlob(
        (blob) => blob ? resolve(blob) : reject(new Error('Export failed')),
        mimeType,
        quality
      );
    });
  }

  private async drawImageLayer(
    ctx: CanvasRenderingContext2D,
    layer: ImageLayer,
    transform: { width: number; height: number }
  ): Promise<void> {
    if (layer.originalImage) {
      if (layer.originalImage.complete) {
        this.drawImageWithMask(ctx, layer, layer.originalImage, transform);
      } else {
        await new Promise((resolve) => {
          layer.originalImage!.onload = resolve;
        });
        this.drawImageWithMask(ctx, layer, layer.originalImage, transform);
      }
    } else if (layer.imageData) {
      const tempCanvas = document.createElement('canvas');
      tempCanvas.width = layer.imageData.width;
      tempCanvas.height = layer.imageData.height;
      tempCanvas.getContext('2d')!.putImageData(layer.imageData, 0, 0);
      this.drawImageWithMask(ctx, layer, tempCanvas, transform);
    }
  }

  private drawImageWithMask(
    ctx: CanvasRenderingContext2D,
    layer: ImageLayer,
    image: CanvasImageSource,
    transform: { width: number; height: number }
  ): void {
    if (layer.mask.enabled && layer.mask.data) {
      ctx.save();
      
      const maskCanvas = document.createElement('canvas');
      maskCanvas.width = layer.originalWidth || transform.width;
      maskCanvas.height = layer.originalHeight || transform.height;
      const maskCtx = maskCanvas.getContext('2d')!;
      
      const maskImageData = maskCtx.createImageData(maskCanvas.width, maskCanvas.height);
      for (let i = 0; i < layer.mask.data.length; i++) {
        const alpha = layer.mask.invert ? 255 - layer.mask.data[i] : layer.mask.data[i];
        maskImageData.data[i * 4] = 255;
        maskImageData.data[i * 4 + 1] = 255;
        maskImageData.data[i * 4 + 2] = 255;
        maskImageData.data[i * 4 + 3] = alpha;
      }
      maskCtx.putImageData(maskImageData, 0, 0);
      
      const tempCanvas = document.createElement('canvas');
      tempCanvas.width = transform.width;
      tempCanvas.height = transform.height;
      const tempCtx = tempCanvas.getContext('2d')!;
      
      tempCtx.drawImage(image, 0, 0, transform.width, transform.height);
      tempCtx.globalCompositeOperation = 'destination-in';
      tempCtx.drawImage(maskCanvas, 0, 0, transform.width, transform.height);
      
      ctx.drawImage(tempCanvas, 0, 0);
      ctx.restore();
    } else {
      ctx.drawImage(image, 0, 0, transform.width, transform.height);
    }
  }

  private drawTextLayer(ctx: CanvasRenderingContext2D, layer: any): void {
    const fontStyle = layer.fontStyle === 'italic' ? 'italic ' : '';
    const fontWeight = layer.fontWeight || 400;
    
    ctx.font = `${fontStyle}${fontWeight} ${layer.fontSize}px ${layer.fontFamily}`;
    ctx.fillStyle = layer.color;
    ctx.textBaseline = 'top';
    
    const lines = layer.content.split('\n');
    lines.forEach((line: string, i: number) => {
      ctx.fillText(line, 0, i * layer.fontSize * layer.lineHeight);
    });
  }

  private drawShapeLayer(ctx: CanvasRenderingContext2D, layer: any): void {
    ctx.fillStyle = layer.fill;
    ctx.strokeStyle = layer.stroke.color;
    ctx.lineWidth = layer.stroke.width;
    
    if (layer.shapeType === 'rectangle') {
      if (layer.fill) {
        ctx.fillRect(0, 0, layer.transform.width, layer.transform.height);
      }
      if (layer.stroke.width > 0) {
        ctx.strokeRect(0, 0, layer.transform.width, layer.transform.height);
      }
    } else if (layer.shapeType === 'ellipse') {
      ctx.beginPath();
      ctx.ellipse(
        layer.transform.width / 2,
        layer.transform.height / 2,
        layer.transform.width / 2,
        layer.transform.height / 2,
        0, 0, Math.PI * 2
      );
      if (layer.fill) ctx.fill();
      if (layer.stroke.width > 0) ctx.stroke();
    }
  }

  private getCompositeOperation(blendMode: string): GlobalCompositeOperation {
    const modeMap: Record<string, GlobalCompositeOperation> = {
      'normal': 'source-over',
      'multiply': 'multiply',
      'screen': 'screen',
      'overlay': 'overlay',
      'darken': 'darken',
      'lighten': 'lighten',
      'color-dodge': 'color-dodge',
      'color-burn': 'color-burn',
      'hard-light': 'hard-light',
      'soft-light': 'soft-light',
      'difference': 'difference',
      'exclusion': 'exclusion',
      'hue': 'hue',
      'saturation': 'saturation',
      'color': 'color',
      'luminosity': 'luminosity',
    };
    return modeMap[blendMode] || 'source-over';
  }

  private async exportAsSVG(
    layers: Layer[],
    canvasSize: { width: number; height: number },
    scale: number
  ): Promise<Blob> {
    const width = canvasSize.width * scale;
    const height = canvasSize.height * scale;
    
    let svgContent = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${canvasSize.width} ${canvasSize.height}">
  <defs>
    <filter id="default-shadow" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="0" dy="4" stdDeviation="8" flood-opacity="0.25"/>
    </filter>
  </defs>
  <rect width="100%" height="100%" fill="#ffffff"/>
`;

    for (const layer of layers) {
      if (!layer.style.visible) continue;
      
      const { transform, style } = layer;
      const centerX = transform.x + transform.width / 2;
      const centerY = transform.y + transform.height / 2;
      
      let transformAttr = `translate(${centerX}, ${centerY})`;
      if (transform.rotation !== 0) {
        transformAttr += ` rotate(${transform.rotation * 180 / Math.PI})`;
      }
      transformAttr += ` scale(${transform.scaleX}, ${transform.scaleY})`;
      transformAttr += ` translate(${-transform.width / 2}, ${-transform.height / 2})`;
      
      const opacity = style.opacity;
      const blendMode = style.blendMode !== 'normal' ? `mix-blend-mode="${style.blendMode}"` : '';
      const filter = style.shadow.enabled ? 'filter="url(#default-shadow)"' : '';
      
      svgContent += `  <g transform="${transformAttr}" opacity="${opacity}" ${blendMode} ${filter}>\n`;
      
      if (layer.type === 'image' && (layer as ImageLayer).originalImage) {
        const imgLayer = layer as ImageLayer;
        const dataUrl = await this.imageToDataURL(imgLayer.originalImage!);
        svgContent += `    <image width="${transform.width}" height="${transform.height}" href="${dataUrl}"/>\n`;
      } else if (layer.type === 'text') {
        const textLayer = layer as any;
        svgContent += `    <text x="0" y="${textLayer.fontSize}" font-family="${textLayer.fontFamily}" font-size="${textLayer.fontSize}px" fill="${textLayer.color}">${this.escapeXml(textLayer.content)}</text>\n`;
      } else if (layer.type === 'shape') {
        const shapeLayer = layer as any;
        if (shapeLayer.shapeType === 'rectangle') {
          svgContent += `    <rect width="${transform.width}" height="${transform.height}" fill="${shapeLayer.fill}" stroke="${shapeLayer.stroke.color}" stroke-width="${shapeLayer.stroke.width}"/>\n`;
        } else if (shapeLayer.shapeType === 'ellipse') {
          svgContent += `    <ellipse cx="${transform.width / 2}" cy="${transform.height / 2}" rx="${transform.width / 2}" ry="${transform.height / 2}" fill="${shapeLayer.fill}" stroke="${shapeLayer.stroke.color}" stroke-width="${shapeLayer.stroke.width}"/>\n`;
        }
      }
      
      svgContent += '  </g>\n';
    }
    
    svgContent += '</svg>';
    
    return new Blob([svgContent], { type: 'image/svg+xml' });
  }

  private async imageToDataURL(img: HTMLImageElement): Promise<string> {
    if (img.src.startsWith('data:')) {
      return img.src;
    }
    
    const canvas = document.createElement('canvas');
    canvas.width = img.width;
    canvas.height = img.height;
    canvas.getContext('2d')!.drawImage(img, 0, 0);
    return canvas.toDataURL('image/png');
  }

  private escapeXml(str: string): string {
    return str.replace(/[<>&'"]/g, (c) => {
      switch (c) {
        case '<': return '&lt;';
        case '>': return '&gt;';
        case '&': return '&amp;';
        case "'": return '&apos;';
        case '"': return '&quot;';
        default: return c;
      }
    });
  }

  private async exportAsJSON(
    layers: Layer[],
    canvasSize: { width: number; height: number }
  ): Promise<Blob> {
    const exportData = {
      version: '1.0.0',
      createdAt: new Date().toISOString(),
      canvas: canvasSize,
      layers: layers.map(layer => {
        const layerData: any = { ...layer };
        
        if (layer.type === 'image' && layer.originalImage) {
          layerData.imageDataUrl = layer.originalImage.src;
          delete layerData.originalImage;
          delete layerData.textureId;
        }
        
        if (layerData.imageData) {
          delete layerData.imageData;
        }
        
        return layerData;
      }),
    };
    
    return new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
  }

  public download(blob: Blob, filename: string): void {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }

  public getFilename(baseName: string, format: ExportFormat): string {
    const date = new Date();
    const timestamp = `${date.getFullYear()}${(date.getMonth() + 1).toString().padStart(2, '0')}${date.getDate().toString().padStart(2, '0')}`;
    
    const extensions: Record<ExportFormat, string> = {
      png: 'png',
      jpeg: 'jpg',
      webp: 'webp',
      svg: 'svg',
      json: 'json',
    };
    
    return `${baseName}_${timestamp}.${extensions[format]}`;
  }
}

export const exportService = new ExportService();
