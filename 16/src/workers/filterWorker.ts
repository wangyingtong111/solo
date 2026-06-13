/// <reference lib="webworker" />

import type { FilterWorkerMessage, FilterWorkerResult, FilterType } from '@/types';

interface FilterContext {
  width: number;
  height: number;
  pixels: Uint8ClampedArray;
}

const ctx: Worker = self as unknown as Worker;

let cancelled = false;

ctx.addEventListener('message', async (e: MessageEvent<FilterWorkerMessage>) => {
  const { type, id, filterType, value, imageData } = e.data;
  
  if (type === 'cancel') {
    cancelled = true;
    return;
  }
  
  if (type === 'apply-filter' && filterType && imageData) {
    cancelled = false;
    
    try {
      const result = await applyFilter(
        filterType,
        value || 0,
        imageData,
        () => cancelled
      );
      
      ctx.postMessage({
        id,
        success: true,
        imageData: result,
      } as FilterWorkerResult);
    } catch (error) {
      ctx.postMessage({
        id,
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      } as FilterWorkerResult);
    }
  }
});

async function applyFilter(
  filterType: FilterType,
  value: number,
  imageData: ImageData,
  isCancelled: () => boolean
): Promise<ImageData> {
  const pixels = new Uint8ClampedArray(imageData.data);
  const width = imageData.width;
  const height = imageData.height;
  
  const context: FilterContext = { width, height, pixels };
  
  switch (filterType) {
    case 'brightness':
      applyBrightness(context, value);
      break;
    case 'contrast':
      applyContrast(context, value);
      break;
    case 'saturation':
      applySaturation(context, value);
      break;
    case 'hue-rotate':
      applyHueRotate(context, value);
      break;
    case 'grayscale':
      applyGrayscale(context);
      break;
    case 'sepia':
      applySepia(context);
      break;
    case 'invert':
      applyInvert(context);
      break;
    case 'blur':
    case 'gaussian-blur':
      applyGaussianBlur(context, value);
      break;
    case 'box-blur':
      applyBoxBlur(context, value);
      break;
    case 'sharpen':
      applySharpen(context, value);
      break;
    case 'emboss':
      applyEmboss(context);
      break;
    case 'vintage':
      applyVintage(context);
      break;
    default:
      break;
  }
  
  if (isCancelled()) {
    throw new Error('Filter cancelled');
  }
  
  return new ImageData(pixels, width, height);
}

function applyBrightness(ctx: FilterContext, value: number): void {
  const adjust = value * 2.55;
  for (let i = 0; i < ctx.pixels.length; i += 4) {
    ctx.pixels[i] = clamp(ctx.pixels[i] + adjust);
    ctx.pixels[i + 1] = clamp(ctx.pixels[i + 1] + adjust);
    ctx.pixels[i + 2] = clamp(ctx.pixels[i + 2] + adjust);
  }
}

function applyContrast(ctx: FilterContext, value: number): void {
  const factor = (259 * (value + 255)) / (255 * (259 - value));
  for (let i = 0; i < ctx.pixels.length; i += 4) {
    ctx.pixels[i] = clamp(factor * (ctx.pixels[i] - 128) + 128);
    ctx.pixels[i + 1] = clamp(factor * (ctx.pixels[i + 1] - 128) + 128);
    ctx.pixels[i + 2] = clamp(factor * (ctx.pixels[i + 2] - 128) + 128);
  }
}

function applySaturation(ctx: FilterContext, value: number): void {
  const amount = value / 100;
  for (let i = 0; i < ctx.pixels.length; i += 4) {
    const r = ctx.pixels[i];
    const g = ctx.pixels[i + 1];
    const b = ctx.pixels[i + 2];
    
    const gray = 0.2989 * r + 0.587 * g + 0.114 * b;
    
    ctx.pixels[i] = clamp(gray + (r - gray) * (1 + amount));
    ctx.pixels[i + 1] = clamp(gray + (g - gray) * (1 + amount));
    ctx.pixels[i + 2] = clamp(gray + (b - gray) * (1 + amount));
  }
}

function applyHueRotate(ctx: FilterContext, degrees: number): void {
  const rad = (degrees * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  
  const a00 = 0.213 + cos * 0.787 - sin * 0.213;
  const a01 = 0.715 - cos * 0.715 - sin * 0.715;
  const a02 = 0.072 - cos * 0.072 + sin * 0.928;
  const a10 = 0.213 - cos * 0.213 + sin * 0.143;
  const a11 = 0.715 + cos * 0.285 + sin * 0.140;
  const a12 = 0.072 - cos * 0.072 - sin * 0.283;
  const a20 = 0.213 - cos * 0.213 - sin * 0.787;
  const a21 = 0.715 - cos * 0.715 + sin * 0.715;
  const a22 = 0.072 + cos * 0.928 + sin * 0.072;
  
  for (let i = 0; i < ctx.pixels.length; i += 4) {
    const r = ctx.pixels[i];
    const g = ctx.pixels[i + 1];
    const b = ctx.pixels[i + 2];
    
    ctx.pixels[i] = clamp(r * a00 + g * a01 + b * a02);
    ctx.pixels[i + 1] = clamp(r * a10 + g * a11 + b * a12);
    ctx.pixels[i + 2] = clamp(r * a20 + g * a21 + b * a22);
  }
}

function applyGrayscale(ctx: FilterContext): void {
  for (let i = 0; i < ctx.pixels.length; i += 4) {
    const gray = 0.299 * ctx.pixels[i] + 0.587 * ctx.pixels[i + 1] + 0.114 * ctx.pixels[i + 2];
    ctx.pixels[i] = ctx.pixels[i + 1] = ctx.pixels[i + 2] = clamp(gray);
  }
}

function applySepia(ctx: FilterContext): void {
  for (let i = 0; i < ctx.pixels.length; i += 4) {
    const r = ctx.pixels[i];
    const g = ctx.pixels[i + 1];
    const b = ctx.pixels[i + 2];
    
    ctx.pixels[i] = clamp(r * 0.393 + g * 0.769 + b * 0.189);
    ctx.pixels[i + 1] = clamp(r * 0.349 + g * 0.686 + b * 0.168);
    ctx.pixels[i + 2] = clamp(r * 0.272 + g * 0.534 + b * 0.131);
  }
}

function applyInvert(ctx: FilterContext): void {
  for (let i = 0; i < ctx.pixels.length; i += 4) {
    ctx.pixels[i] = 255 - ctx.pixels[i];
    ctx.pixels[i + 1] = 255 - ctx.pixels[i + 1];
    ctx.pixels[i + 2] = 255 - ctx.pixels[i + 2];
  }
}

function applyGaussianBlur(ctx: FilterContext, radius: number): void {
  if (radius <= 0) return;
  
  const r = Math.floor(radius);
  const sigma = radius / 3;
  const kernel = generateGaussianKernel(r, sigma);
  
  const temp = new Uint8ClampedArray(ctx.pixels);
  
  applyConvolution(ctx, temp, kernel, r, true);
  applyConvolution(ctx, ctx.pixels, kernel, r, false);
}

function generateGaussianKernel(radius: number, sigma: number): number[] {
  const size = radius * 2 + 1;
  const kernel: number[] = [];
  let sum = 0;
  
  for (let i = 0; i < size; i++) {
    const x = i - radius;
    const value = Math.exp(-(x * x) / (2 * sigma * sigma));
    kernel.push(value);
    sum += value;
  }
  
  for (let i = 0; i < size; i++) {
    kernel[i] /= sum;
  }
  
  return kernel;
}

function applyBoxBlur(ctx: FilterContext, radius: number): void {
  if (radius <= 0) return;
  
  const r = Math.floor(radius);
  const kernelSize = r * 2 + 1;
  const weight = 1 / kernelSize;
  const kernel = new Array(kernelSize).fill(weight);
  
  const temp = new Uint8ClampedArray(ctx.pixels);
  
  applyConvolution(ctx, temp, kernel, r, true);
  applyConvolution(ctx, ctx.pixels, kernel, r, false);
}

function applyConvolution(
  ctx: FilterContext,
  source: Uint8ClampedArray,
  kernel: number[],
  radius: number,
  horizontal: boolean
): void {
  const { width, height, pixels } = ctx;
  const kernelSize = kernel.length;
  
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let r = 0, g = 0, b = 0;
      
      for (let k = 0; k < kernelSize; k++) {
        const offset = k - radius;
        let kx = horizontal ? x + offset : x;
        let ky = horizontal ? y : y + offset;
        
        kx = Math.max(0, Math.min(width - 1, kx));
        ky = Math.max(0, Math.min(height - 1, ky));
        
        const idx = (ky * width + kx) * 4;
        const w = kernel[k];
        
        r += source[idx] * w;
        g += source[idx + 1] * w;
        b += source[idx + 2] * w;
      }
      
      const idx = (y * width + x) * 4;
      pixels[idx] = clamp(r);
      pixels[idx + 1] = clamp(g);
      pixels[idx + 2] = clamp(b);
    }
  }
}

function applySharpen(ctx: FilterContext, amount: number): void {
  const intensity = amount / 50;
  const kernel = [
    0, -intensity, 0,
    -intensity, 1 + 4 * intensity, -intensity,
    0, -intensity, 0,
  ];
  
  applyConvolution2D(ctx, kernel, 3);
}

function applyEmboss(ctx: FilterContext): void {
  const kernel = [
    -2, -1, 0,
    -1, 1, 1,
    0, 1, 2,
  ];
  
  applyConvolution2D(ctx, kernel, 3, true);
}

function applyConvolution2D(
  ctx: FilterContext,
  kernel: number[],
  kernelSize: number,
  grayscale: boolean = false
): void {
  const { width, height, pixels } = ctx;
  const half = Math.floor(kernelSize / 2);
  const temp = new Uint8ClampedArray(pixels);
  
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let r = 0, g = 0, b = 0;
      
      for (let ky = 0; ky < kernelSize; ky++) {
        for (let kx = 0; kx < kernelSize; kx++) {
          const px = Math.max(0, Math.min(width - 1, x + kx - half));
          const py = Math.max(0, Math.min(height - 1, y + ky - half));
          const idx = (py * width + px) * 4;
          const w = kernel[ky * kernelSize + kx];
          
          r += temp[idx] * w;
          g += temp[idx + 1] * w;
          b += temp[idx + 2] * w;
        }
      }
      
      const idx = (y * width + x) * 4;
      
      if (grayscale) {
        const gray = (r + g + b) / 3 + 128;
        pixels[idx] = pixels[idx + 1] = pixels[idx + 2] = clamp(gray);
      } else {
        pixels[idx] = clamp(r);
        pixels[idx + 1] = clamp(g);
        pixels[idx + 2] = clamp(b);
      }
    }
  }
}

function applyVintage(ctx: FilterContext): void {
  for (let i = 0; i < ctx.pixels.length; i += 4) {
    let r = ctx.pixels[i];
    let g = ctx.pixels[i + 1];
    let b = ctx.pixels[i + 2];
    
    r = r * 0.9 + 40;
    g = g * 0.7 + 60;
    b = b * 0.5 + 30;
    
    const x = (i / 4) % ctx.width;
    const y = Math.floor((i / 4) / ctx.width);
    const centerX = ctx.width / 2;
    const centerY = ctx.height / 2;
    const dist = Math.sqrt((x - centerX) ** 2 + (y - centerY) ** 2);
    const maxDist = Math.sqrt(centerX ** 2 + centerY ** 2);
    const vignette = 1 - (dist / maxDist) * 0.5;
    
    r *= vignette;
    g *= vignette;
    b *= vignette;
    
    ctx.pixels[i] = clamp(r);
    ctx.pixels[i + 1] = clamp(g);
    ctx.pixels[i + 2] = clamp(b);
  }
}

function clamp(value: number): number {
  return Math.max(0, Math.min(255, value));
}

export {};
