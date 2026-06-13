import * as fs from 'fs';
import * as path from 'path';
import { LRUCache } from 'lru-cache';
import { CacheEntry, PackageInfo, LayerInfo } from '../types';
import { ensureDir, readJsonFile, writeJsonFile, fileExists } from '../utils/fs';

export class LayerCache {
  private cacheDir: string;
  private memoryCache: LRUCache<string, CacheEntry>;
  private dbPath: string;
  private index: Map<string, string>;

  constructor(cacheDir: string, maxMemoryEntries = 100) {
    this.cacheDir = cacheDir;
    ensureDir(cacheDir);
    this.dbPath = path.join(cacheDir, 'cache.db');
    this.index = new Map();

    this.memoryCache = new LRUCache({
      max: maxMemoryEntries,
      ttl: 1000 * 60 * 60 * 24,
    });

    this.loadIndex();
  }

  private loadIndex(): void {
    const indexPath = path.join(this.cacheDir, 'index.json');
    if (fileExists(indexPath)) {
      try {
        const data = readJsonFile<Record<string, string>>(indexPath);
        this.index = new Map(Object.entries(data));
      } catch (e) {
        this.index = new Map();
      }
    }
  }

  private saveIndex(): void {
    const indexPath = path.join(this.cacheDir, 'index.json');
    const data = Object.fromEntries(this.index);
    writeJsonFile(indexPath, data);
  }

  private getCacheFilePath(layerDigest: string): string {
    const safeDigest = layerDigest.replace(/[:/]/g, '_');
    return path.join(this.cacheDir, `${safeDigest}.json`);
  }

  has(layerDigest: string): boolean {
    if (this.memoryCache.has(layerDigest)) {
      return true;
    }

    if (this.index.has(layerDigest)) {
      const filePath = this.index.get(layerDigest)!;
      return fileExists(filePath);
    }

    const filePath = this.getCacheFilePath(layerDigest);
    const exists = fileExists(filePath);
    if (exists) {
      this.index.set(layerDigest, filePath);
    }
    return exists;
  }

  get(layerDigest: string): CacheEntry | null {
    const memEntry = this.memoryCache.get(layerDigest);
    if (memEntry) {
      return memEntry;
    }

    const filePath = this.index.get(layerDigest) || this.getCacheFilePath(layerDigest);
    if (!fileExists(filePath)) {
      return null;
    }

    try {
      const entry = readJsonFile<CacheEntry>(filePath);
      this.memoryCache.set(layerDigest, entry);
      return entry;
    } catch (e) {
      return null;
    }
  }

  set(layerDigest: string, entry: CacheEntry): void {
    this.memoryCache.set(layerDigest, entry);

    const filePath = this.getCacheFilePath(layerDigest);
    writeJsonFile(filePath, entry);
    this.index.set(layerDigest, filePath);
    this.saveIndex();
  }

  delete(layerDigest: string): void {
    this.memoryCache.delete(layerDigest);
    const filePath = this.getCacheFilePath(layerDigest);
    if (fileExists(filePath)) {
      fs.unlinkSync(filePath);
    }
    this.index.delete(layerDigest);
    this.saveIndex();
  }

  clear(): void {
    this.memoryCache.clear();

    const files = fs.readdirSync(this.cacheDir);
    for (const file of files) {
      if (file.endsWith('.json') && file !== 'index.json') {
        fs.unlinkSync(path.join(this.cacheDir, file));
      }
    }

    this.index.clear();
    this.saveIndex();
  }

  getStats(): { total: number; memory: number; disk: number } {
    return {
      total: this.index.size,
      memory: this.memoryCache.size,
      disk: this.index.size,
    };
  }
}
