import { CacheEntry } from '../types';
export declare class LayerCache {
    private cacheDir;
    private memoryCache;
    private dbPath;
    private index;
    constructor(cacheDir: string, maxMemoryEntries?: number);
    private loadIndex;
    private saveIndex;
    private getCacheFilePath;
    has(layerDigest: string): boolean;
    get(layerDigest: string): CacheEntry | null;
    set(layerDigest: string, entry: CacheEntry): void;
    delete(layerDigest: string): void;
    clear(): void;
    getStats(): {
        total: number;
        memory: number;
        disk: number;
    };
}
