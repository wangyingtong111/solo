import type { AISegmentationResult } from '@/types';

interface SegmentationConfig {
  apiEndpoint?: string;
  apiKey?: string;
  model?: 'u2net' | 'isnet' | 'modnet' | 'birefnet';
}

interface BrushToolState {
  active: boolean;
  mode: 'add' | 'remove';
  size: number;
  hardness: number;
  feather: number;
}

export class SegmentationService {
  private config: SegmentationConfig;
  private isProcessing: boolean = false;
  private abortController: AbortController | null = null;
  private maskCanvas: HTMLCanvasElement | null = null;
  private maskCtx: CanvasRenderingContext2D | null = null;
  private brushState: BrushToolState = {
    active: false,
    mode: 'add',
    size: 30,
    hardness: 0.8,
    feather: 5,
  };
  private lastDrawPoint: { x: number; y: number } | null = null;

  constructor(config: SegmentationConfig = {}) {
    this.config = {
      apiEndpoint: config.apiEndpoint || '/api/segmentation',
      apiKey: config.apiKey,
      model: config.model || 'isnet',
    };
    
    this.maskCanvas = document.createElement('canvas');
    this.maskCtx = this.maskCanvas.getContext('2d');
  }

  public async segmentImage(
    imageData: ImageData,
    onProgress?: (progress: number) => void
  ): Promise<AISegmentationResult> {
    if (this.isProcessing) {
      throw new Error('Segmentation already in progress');
    }
    
    this.isProcessing = true;
    this.abortController = new AbortController();
    
    try {
      if (this.config.apiEndpoint && this.config.apiEndpoint.startsWith('http')) {
        return await this.callRemoteAPI(imageData, onProgress);
      } else {
        return await this.simulateSegmentation(imageData, onProgress);
      }
    } finally {
      this.isProcessing = false;
      this.abortController = null;
    }
  }

  private async callRemoteAPI(
    imageData: ImageData,
    onProgress?: (progress: number) => void
  ): Promise<AISegmentationResult> {
    const canvas = document.createElement('canvas');
    canvas.width = imageData.width;
    canvas.height = imageData.height;
    const ctx = canvas.getContext('2d')!;
    ctx.putImageData(imageData, 0, 0);
    
    const blob = await new Promise<Blob>((resolve) => {
      canvas.toBlob((b) => resolve(b!), 'image/png');
    });
    
    const formData = new FormData();
    formData.append('image', blob, 'image.png');
    formData.append('model', this.config.model!);
    
    onProgress?.(0.1);
    
    const response = await fetch(this.config.apiEndpoint!, {
      method: 'POST',
      body: formData,
      headers: this.config.apiKey ? { 'Authorization': `Bearer ${this.config.apiKey}` } : {},
      signal: this.abortController?.signal,
    });
    
    if (!response.ok) {
      throw new Error(`Segmentation failed: ${response.statusText}`);
    }
    
    onProgress?.(0.5);
    
    const reader = response.body?.getReader();
    const contentLength = Number(response.headers.get('Content-Length') || 0);
    let receivedLength = 0;
    const chunks: BlobPart[] = [];
    
    if (reader) {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        receivedLength += value.length;
        if (contentLength > 0) {
          onProgress?.(0.5 + 0.4 * (receivedLength / contentLength));
        }
      }
    }
    
    onProgress?.(0.9);
    
    const maskBlob = new Blob(chunks, { type: 'image/png' });
    const maskImage = await this.loadImage(URL.createObjectURL(maskBlob));
    
    const maskCanvas = document.createElement('canvas');
    maskCanvas.width = imageData.width;
    maskCanvas.height = imageData.height;
    const maskCtx = maskCanvas.getContext('2d')!;
    maskCtx.drawImage(maskImage, 0, 0, imageData.width, imageData.height);
    
    const maskData = maskCtx.getImageData(0, 0, imageData.width, imageData.height);
    const alphaMask = new Uint8ClampedArray(imageData.width * imageData.height);
    
    for (let i = 0; i < maskData.data.length; i += 4) {
      alphaMask[i / 4] = maskData.data[i];
    }
    
    onProgress?.(1.0);
    
    return {
      mask: alphaMask,
      width: imageData.width,
      height: imageData.height,
      confidence: 0.95,
    };
  }

  private async simulateSegmentation(
    imageData: ImageData,
    onProgress?: (progress: number) => void
  ): Promise<AISegmentationResult> {
    const steps = 20;
    for (let i = 0; i <= steps; i++) {
      await new Promise(resolve => setTimeout(resolve, 50));
      onProgress?.(i / steps);
      
      if (this.abortController?.signal.aborted) {
        throw new Error('Segmentation cancelled');
      }
    }
    
    const { width, height, data } = imageData;
    const mask = new Uint8ClampedArray(width * height);
    
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const idx = (y * width + x) * 4;
        const r = data[idx];
        const g = data[idx + 1];
        const b = data[idx + 2];
        
        const brightness = (r + g + b) / 3;
        const edgeX = Math.min(x, width - x) / (width / 2);
        const edgeY = Math.min(y, height - y) / (height / 2);
        const edgeFactor = Math.min(edgeX, edgeY);
        
        const centerX = width / 2;
        const centerY = height / 2;
        const distFromCenter = Math.sqrt((x - centerX) ** 2 + (y - centerY) ** 2);
        const maxDist = Math.sqrt(centerX ** 2 + centerY ** 2);
        const centerFactor = 1 - distFromCenter / maxDist;
        
        let alpha = 255;
        if (brightness > 240 && edgeFactor < 0.3) {
          alpha = Math.floor(brightness * edgeFactor * 0.8);
        } else if (centerFactor > 0.3) {
          alpha = 255;
        } else {
          alpha = Math.floor(255 * (0.5 + centerFactor * 0.5));
        }
        
        mask[y * width + x] = alpha;
      }
    }
    
    return {
      mask,
      width,
      height,
      confidence: 0.85,
    };
  }

  private loadImage(src: string): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = src;
    });
  }

  public applyMaskToImage(imageData: ImageData, mask: Uint8ClampedArray): ImageData {
    const result = new ImageData(
      new Uint8ClampedArray(imageData.data),
      imageData.width,
      imageData.height
    );
    
    for (let i = 0; i < mask.length; i++) {
      result.data[i * 4 + 3] = mask[i];
    }
    
    return result;
  }

  public initMaskCanvas(width: number, height: number, initialMask?: Uint8ClampedArray): void {
    if (!this.maskCanvas || !this.maskCtx) return;
    
    this.maskCanvas.width = width;
    this.maskCanvas.height = height;
    
    if (initialMask) {
      const imageData = this.maskCtx.createImageData(width, height);
      for (let i = 0; i < initialMask.length; i++) {
        imageData.data[i * 4 + 3] = initialMask[i];
        imageData.data[i * 4] = 255;
        imageData.data[i * 4 + 1] = 255;
        imageData.data[i * 4 + 2] = 255;
      }
      this.maskCtx.putImageData(imageData, 0, 0);
    } else {
      this.maskCtx.fillStyle = 'rgba(255, 255, 255, 1)';
      this.maskCtx.fillRect(0, 0, width, height);
    }
  }

  public startBrush(x: number, y: number, mode: 'add' | 'remove'): void {
    this.brushState.active = true;
    this.brushState.mode = mode;
    this.lastDrawPoint = { x, y };
    this.drawBrush(x, y);
  }

  public moveBrush(x: number, y: number): void {
    if (!this.brushState.active) return;
    
    if (this.lastDrawPoint) {
      this.drawLine(this.lastDrawPoint.x, this.lastDrawPoint.y, x, y);
    }
    
    this.lastDrawPoint = { x, y };
  }

  public endBrush(): void {
    this.brushState.active = false;
    this.lastDrawPoint = null;
  }

  private drawBrush(x: number, y: number): void {
    if (!this.maskCtx) return;
    
    const { size, hardness, feather, mode } = this.brushState;
    const color = mode === 'add' ? 'rgba(255, 255, 255, 1)' : 'rgba(0, 0, 0, 1)';
    const erase = mode === 'remove';
    
    this.maskCtx.globalCompositeOperation = erase ? 'destination-out' : 'source-over';
    
    const gradient = this.maskCtx.createRadialGradient(x, y, 0, x, y, size);
    const innerAlpha = hardness;
    const outerAlpha = Math.max(0, hardness - feather / size);
    
    gradient.addColorStop(0, mode === 'add' ? `rgba(255, 255, 255, ${innerAlpha})` : `rgba(0, 0, 0, ${innerAlpha})`);
    gradient.addColorStop(1, mode === 'add' ? `rgba(255, 255, 255, ${outerAlpha})` : `rgba(0, 0, 0, ${outerAlpha})`);
    
    this.maskCtx.fillStyle = gradient;
    this.maskCtx.beginPath();
    this.maskCtx.arc(x, y, size, 0, Math.PI * 2);
    this.maskCtx.fill();
    
    this.maskCtx.globalCompositeOperation = 'source-over';
  }

  private drawLine(x1: number, y1: number, x2: number, y2: number): void {
    const dist = Math.sqrt((x2 - x1) ** 2 + (y2 - y1) ** 2);
    const steps = Math.ceil(dist / (this.brushState.size * 0.3));
    
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const x = x1 + (x2 - x1) * t;
      const y = y1 + (y2 - y1) * t;
      this.drawBrush(x, y);
    }
  }

  public getMaskData(): Uint8ClampedArray {
    if (!this.maskCanvas || !this.maskCtx) {
      return new Uint8ClampedArray();
    }
    
    const imageData = this.maskCtx.getImageData(0, 0, this.maskCanvas.width, this.maskCanvas.height);
    const mask = new Uint8ClampedArray(this.maskCanvas.width * this.maskCanvas.height);
    
    for (let i = 0; i < imageData.data.length; i += 4) {
      mask[i / 4] = imageData.data[i + 3];
    }
    
    return mask;
  }

  public getMaskCanvas(): HTMLCanvasElement | null {
    return this.maskCanvas;
  }

  public setBrushSize(size: number): void {
    this.brushState.size = Math.max(1, Math.min(500, size));
  }

  public getBrushSize(): number {
    return this.brushState.size;
  }

  public setBrushHardness(hardness: number): void {
    this.brushState.hardness = Math.max(0, Math.min(1, hardness));
  }

  public setBrushFeather(feather: number): void {
    this.brushState.feather = Math.max(0, feather);
  }

  public invertMask(): void {
    if (!this.maskCanvas || !this.maskCtx) return;
    
    const imageData = this.maskCtx.getImageData(0, 0, this.maskCanvas.width, this.maskCanvas.height);
    
    for (let i = 0; i < imageData.data.length; i += 4) {
      imageData.data[i + 3] = 255 - imageData.data[i + 3];
    }
    
    this.maskCtx.putImageData(imageData, 0, 0);
  }

  public featherMask(radius: number): void {
    if (!this.maskCanvas || !this.maskCtx || radius <= 0) return;
    
    const { width, height } = this.maskCanvas;
    const imageData = this.maskCtx.getImageData(0, 0, width, height);
    const data = imageData.data;
    const temp = new Uint8ClampedArray(data);
    
    const kernelSize = Math.ceil(radius * 2) * 2 + 1;
    const sigma = radius;
    const kernel: number[] = [];
    let sum = 0;
    
    for (let i = 0; i < kernelSize; i++) {
      const x = i - kernelSize / 2;
      const value = Math.exp(-(x * x) / (2 * sigma * sigma));
      kernel.push(value);
      sum += value;
    }
    
    for (let i = 0; i < kernelSize; i++) {
      kernel[i] /= sum;
    }
    
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        let alpha = 0;
        
        for (let k = 0; k < kernelSize; k++) {
          const offset = k - kernelSize / 2;
          const kx = Math.max(0, Math.min(width - 1, x + offset));
          const idx = (y * width + kx) * 4 + 3;
          alpha += temp[idx] * kernel[k];
        }
        
        data[(y * width + x) * 4 + 3] = Math.round(alpha);
      }
    }
    
    const temp2 = new Uint8ClampedArray(data);
    
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        let alpha = 0;
        
        for (let k = 0; k < kernelSize; k++) {
          const offset = k - kernelSize / 2;
          const ky = Math.max(0, Math.min(height - 1, y + offset));
          const idx = (ky * width + x) * 4 + 3;
          alpha += temp2[idx] * kernel[k];
        }
        
        data[(y * width + x) * 4 + 3] = Math.round(alpha);
      }
    }
    
    this.maskCtx.putImageData(imageData, 0, 0);
  }

  public cancel(): void {
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
    this.isProcessing = false;
  }

  public getIsProcessing(): boolean {
    return this.isProcessing;
  }

  public destroy(): void {
    this.cancel();
    this.maskCanvas = null;
    this.maskCtx = null;
  }
}

export const segmentationService = new SegmentationService();
