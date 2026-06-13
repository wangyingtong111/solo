import type { TextureCacheEntry } from '@/types';
import { generateTextureId } from '@/utils/id';

interface TextureCacheOptions {
  maxSize?: number;
  maxMemoryMB?: number;
}

export class TextureCache {
  private gl: WebGL2RenderingContext;
  private cache: Map<string, TextureCacheEntry> = new Map();
  private maxSize: number;
  private maxMemoryBytes: number;
  private currentMemoryBytes: number = 0;

  constructor(gl: WebGL2RenderingContext, options: TextureCacheOptions = {}) {
    this.gl = gl;
    this.maxSize = options.maxSize || 100;
    this.maxMemoryBytes = (options.maxMemoryMB || 512) * 1024 * 1024;
  }

  createTexture(
    image: HTMLImageElement | ImageData | HTMLCanvasElement | VideoFrame,
    width?: number,
    height?: number
  ): { id: string; texture: WebGLTexture; width: number; height: number } {
    const texWidth = width || (image as HTMLImageElement).width || (image as ImageData).width;
    const texHeight = height || (image as HTMLImageElement).height || (image as ImageData).height;

    const memorySize = texWidth * texHeight * 4;

    if (this.currentMemoryBytes + memorySize > this.maxMemoryBytes || this.cache.size >= this.maxSize) {
      this.evictOldest(memorySize);
    }

    const texture = this.gl.createTexture()!;
    this.gl.bindTexture(this.gl.TEXTURE_2D, texture);
    
    this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_WRAP_S, this.gl.CLAMP_TO_EDGE);
    this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_WRAP_T, this.gl.CLAMP_TO_EDGE);
    this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_MIN_FILTER, this.gl.LINEAR);
    this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_MAG_FILTER, this.gl.LINEAR);

    if (image instanceof ImageData) {
      this.gl.texImage2D(
        this.gl.TEXTURE_2D,
        0,
        this.gl.RGBA,
        this.gl.RGBA,
        this.gl.UNSIGNED_BYTE,
        image
      );
    } else {
      this.gl.texImage2D(
        this.gl.TEXTURE_2D,
        0,
        this.gl.RGBA,
        this.gl.RGBA,
        this.gl.UNSIGNED_BYTE,
        image as TexImageSource
      );
    }

    const id = generateTextureId();
    const entry: TextureCacheEntry = {
      texture,
      width: texWidth,
      height: texHeight,
      lastUsed: Date.now(),
      refCount: 1,
    };

    this.cache.set(id, entry);
    this.currentMemoryBytes += memorySize;

    return { id, texture, width: texWidth, height: texHeight };
  }

  updateTexture(id: string, image: HTMLImageElement | ImageData | HTMLCanvasElement): void {
    const entry = this.cache.get(id);
    if (!entry) return;

    const oldMemory = entry.width * entry.height * 4;
    this.currentMemoryBytes -= oldMemory;

    this.gl.bindTexture(this.gl.TEXTURE_2D, entry.texture);
    
    if (image instanceof ImageData) {
      entry.width = image.width;
      entry.height = image.height;
      this.gl.texImage2D(
        this.gl.TEXTURE_2D,
        0,
        this.gl.RGBA,
        this.gl.RGBA,
        this.gl.UNSIGNED_BYTE,
        image
      );
    } else {
      entry.width = image.width;
      entry.height = image.height;
      this.gl.texImage2D(
        this.gl.TEXTURE_2D,
        0,
        this.gl.RGBA,
        this.gl.RGBA,
        this.gl.UNSIGNED_BYTE,
        image
      );
    }

    const newMemory = entry.width * entry.height * 4;
    this.currentMemoryBytes += newMemory;
    entry.lastUsed = Date.now();
  }

  getTexture(id: string): WebGLTexture | null {
    const entry = this.cache.get(id);
    if (entry) {
      entry.lastUsed = Date.now();
      return entry.texture;
    }
    return null;
  }

  getTextureInfo(id: string): { width: number; height: number } | null {
    const entry = this.cache.get(id);
    if (entry) {
      entry.lastUsed = Date.now();
      return { width: entry.width, height: entry.height };
    }
    return null;
  }

  retain(id: string): void {
    const entry = this.cache.get(id);
    if (entry) {
      entry.refCount++;
    }
  }

  release(id: string): void {
    const entry = this.cache.get(id);
    if (entry) {
      entry.refCount--;
      if (entry.refCount <= 0) {
        this.deleteTexture(id);
      }
    }
  }

  deleteTexture(id: string): void {
    const entry = this.cache.get(id);
    if (entry) {
      this.gl.deleteTexture(entry.texture);
      this.currentMemoryBytes -= entry.width * entry.height * 4;
      this.cache.delete(id);
    }
  }

  private evictOldest(requiredBytes: number): void {
    const entries = Array.from(this.cache.entries())
      .filter(([, entry]) => entry.refCount <= 1)
      .sort((a, b) => a[1].lastUsed - b[1].lastUsed);

    let freedBytes = 0;
    for (const [id, entry] of entries) {
      if (freedBytes >= requiredBytes || this.cache.size <= 10) break;
      
      freedBytes += entry.width * entry.height * 4;
      this.deleteTexture(id);
    }
  }

  clear(): void {
    for (const id of this.cache.keys()) {
      this.deleteTexture(id);
    }
    this.cache.clear();
    this.currentMemoryBytes = 0;
  }

  getStats(): { count: number; memoryMB: number; maxMemoryMB: number } {
    return {
      count: this.cache.size,
      memoryMB: this.currentMemoryBytes / (1024 * 1024),
      maxMemoryMB: this.maxMemoryBytes / (1024 * 1024),
    };
  }
}
