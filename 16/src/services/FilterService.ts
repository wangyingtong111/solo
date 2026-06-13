import type { FilterType, FilterWorkerMessage, FilterWorkerResult } from '@/types';

interface PendingRequest {
  id: string;
  resolve: (result: ImageData) => void;
  reject: (error: string) => void;
  timeout: ReturnType<typeof setTimeout>;
}

export class FilterService {
  private worker: Worker | null = null;
  private pendingRequests: Map<string, PendingRequest> = new Map();
  private currentRequestId: string | null = null;
  private workerPool: Worker[] = [];
  private maxWorkers: number = 4;

  constructor() {
    this.initWorkerPool();
  }

  private initWorkerPool(): void {
    const cpuCount = navigator.hardwareConcurrency || 2;
    this.maxWorkers = Math.min(cpuCount, 4);
    
    for (let i = 0; i < this.maxWorkers; i++) {
      const worker = new Worker(
        new URL('../workers/filterWorker.ts', import.meta.url),
        { type: 'module' }
      );
      
      worker.addEventListener('message', (e: MessageEvent<FilterWorkerResult>) => {
        this.handleWorkerMessage(e.data);
      });
      
      worker.addEventListener('error', (error) => {
        console.error('Filter worker error:', error);
      });
      
      this.workerPool.push(worker);
    }
  }

  private getAvailableWorker(): Worker | null {
    return this.workerPool[0] || null;
  }

  private handleWorkerMessage(result: FilterWorkerResult): void {
    const request = this.pendingRequests.get(result.id);
    if (!request) return;
    
    clearTimeout(request.timeout);
    this.pendingRequests.delete(result.id);
    this.currentRequestId = null;
    
    if (result.success && result.imageData) {
      request.resolve(result.imageData);
    } else {
      request.reject(result.error || 'Filter failed');
    }
  }

  public applyFilter(
    filterType: FilterType,
    value: number,
    imageData: ImageData,
    options: { timeout?: number; lowPriority?: boolean } = {}
  ): Promise<ImageData> {
    return new Promise((resolve, reject) => {
      const id = `filter_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      
      if (this.currentRequestId && !options.lowPriority) {
        this.cancelRequest(this.currentRequestId);
      }
      
      const timeout = setTimeout(() => {
        const request = this.pendingRequests.get(id);
        if (request) {
          clearTimeout(request.timeout);
          this.pendingRequests.delete(id);
          reject('Filter timeout');
        }
      }, options.timeout || 30000);
      
      this.pendingRequests.set(id, { id, resolve, reject, timeout });
      this.currentRequestId = id;
      
      const worker = this.getAvailableWorker();
      if (!worker) {
        reject('No available worker');
        return;
      }
      
      const message: FilterWorkerMessage = {
        type: 'apply-filter',
        id,
        filterType,
        value,
        imageData,
        width: imageData.width,
        height: imageData.height,
      };
      
      worker.postMessage(message, [imageData.data.buffer]);
    });
  }

  public cancelRequest(id: string): void {
    const request = this.pendingRequests.get(id);
    if (request) {
      clearTimeout(request.timeout);
      this.pendingRequests.delete(id);
      
      const cancelMessage: FilterWorkerMessage = {
        type: 'cancel',
        id,
      };
      
      this.workerPool.forEach(worker => worker.postMessage(cancelMessage));
    }
  }

  public cancelAll(): void {
    this.pendingRequests.forEach((request, id) => {
      clearTimeout(request.timeout);
      request.reject('Cancelled');
    });
    
    this.pendingRequests.clear();
    this.currentRequestId = null;
    
    this.workerPool.forEach(worker => {
      worker.postMessage({ type: 'cancel', id: 'all' } as FilterWorkerMessage);
    });
  }

  public createThumbnail(imageData: ImageData, maxSize: number = 256): ImageData {
    const ratio = Math.min(maxSize / imageData.width, maxSize / imageData.height);
    const newWidth = Math.floor(imageData.width * ratio);
    const newHeight = Math.floor(imageData.height * ratio);
    
    const canvas = document.createElement('canvas');
    canvas.width = newWidth;
    canvas.height = newHeight;
    const ctx = canvas.getContext('2d')!;
    
    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = imageData.width;
    tempCanvas.height = imageData.height;
    const tempCtx = tempCanvas.getContext('2d')!;
    tempCtx.putImageData(imageData, 0, 0);
    
    ctx.drawImage(tempCanvas, 0, 0, newWidth, newHeight);
    
    return ctx.getImageData(0, 0, newWidth, newHeight);
  }

  public async applyFilterWithPreview(
    filterType: FilterType,
    value: number,
    fullImageData: ImageData,
    onProgress?: (preview: ImageData) => void
  ): Promise<ImageData> {
    const thumbnail = this.createThumbnail(fullImageData, 512);
    
    const previewPromise = this.applyFilter(filterType, value, thumbnail, { lowPriority: true })
      .then(preview => {
        onProgress?.(preview);
        return preview;
      })
      .catch(() => {});
    
    const fullPromise = this.applyFilter(filterType, value, fullImageData);
    
    await previewPromise;
    
    return fullPromise;
  }

  public destroy(): void {
    this.cancelAll();
    this.workerPool.forEach(worker => worker.terminate());
    this.workerPool = [];
  }
}

export const filterService = new FilterService();
