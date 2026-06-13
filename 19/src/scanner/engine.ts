import { EventEmitter } from 'events';
import {
  ScanResult,
  Vulnerability,
  RuntimeRisk,
  PackageInfo,
  LayerInfo,
  ImageConfig,
  Manifest,
  FileInfo,
} from '../types';
import { VulnDatabase } from '../vulndb';
import { LayerCache } from './cache';
import { analyzeLayer, ExtractedImage } from '../image';
import { matchVulnerabilities, deduplicateVulnerabilities, summarizeVulnerabilities } from './matcher';
import { analyzeRuntimeRisks, RuntimeCheckOptions } from './runtime';

export interface ScanOptions {
  incremental?: boolean;
  useCache?: boolean;
  maxParallelLayers?: number;
  memoryLimit?: number;
  runtimeChecks?: RuntimeCheckOptions;
  severityFilter?: string[];
  onlyFixable?: boolean;
}

export interface ScanProgress {
  type: 'layer_start' | 'layer_complete' | 'cache_hit' | 'vuln_found' | 'complete';
  layerIndex?: number;
  layerDigest?: string;
  message?: string;
  vulnCount?: number;
}

export class ScanEngine extends EventEmitter {
  private db: VulnDatabase;
  private cache: LayerCache;
  private options: Required<ScanOptions>;

  constructor(db: VulnDatabase, cache: LayerCache, options: ScanOptions = {}) {
    super();
    this.db = db;
    this.cache = cache;
    this.options = {
      incremental: true,
      useCache: true,
      maxParallelLayers: 2,
      memoryLimit: 512 * 1024 * 1024,
      runtimeChecks: {},
      severityFilter: [],
      onlyFixable: false,
      ...options,
    };
  }

  async scan(
    imageName: string,
    extractedImage: ExtractedImage
  ): Promise<ScanResult> {
    const { manifest, config, layerPaths } = extractedImage;

    this.emit('start', {
      imageName,
      totalLayers: layerPaths.length,
    });

    let allPackages: PackageInfo[] = [];
    let allFiles: FileInfo[] = [];
    let cachedLayers = 0;
    let scannedLayers = 0;
    const allVulnerabilities: Vulnerability[] = [];

    let cumulativePackages: PackageInfo[] = [];

    for (let i = 0; i < layerPaths.length; i++) {
      const layerDigest = manifest.layers[i]?.digest || `layer-${i}`;

      this.emit('progress', {
        type: 'layer_start',
        layerIndex: i,
        layerDigest,
        message: `Analyzing layer ${i + 1}/${layerPaths.length}`,
      } as ScanProgress);

      let layerPackages: PackageInfo[] = [];
      let layerFiles: FileInfo[] = [];
      let usedCache = false;

      if (this.options.useCache && this.cache.has(layerDigest)) {
        const cached = this.cache.get(layerDigest);
        if (cached) {
          layerPackages = cached.packages;
          usedCache = true;
          cachedLayers++;

          this.emit('progress', {
            type: 'cache_hit',
            layerIndex: i,
            layerDigest,
            message: `Cache hit for layer ${i + 1}`,
          } as ScanProgress);
        }
      }

      if (!usedCache) {
        const result = await analyzeLayer(layerPaths[i], i, cumulativePackages);
        layerPackages = result.packages;
        layerFiles = result.files;
        scannedLayers++;

        if (this.options.useCache) {
          const layerVulns = matchVulnerabilities(layerPackages, this.db);
          this.cache.set(layerDigest, {
            layerDigest,
            packages: layerPackages,
            scanTime: new Date().toISOString(),
            vulnerabilityCount: layerVulns.length,
          });
        }
      }

      cumulativePackages = layerPackages;

      const layerVulns = matchVulnerabilities(layerPackages, this.db);
      if (layerVulns.length > 0) {
        allVulnerabilities.push(...layerVulns);
        this.emit('progress', {
          type: 'vuln_found',
          layerIndex: i,
          layerDigest,
          vulnCount: layerVulns.length,
          message: `Found ${layerVulns.length} vulnerabilities in layer ${i + 1}`,
        } as ScanProgress);
      }

      allFiles = this.mergeFiles(allFiles, layerFiles);

      const usedMemory = process.memoryUsage().heapUsed;
      if (usedMemory > this.options.memoryLimit) {
        await this.freeMemory();
      }
    }

    const dedupedVulns = deduplicateVulnerabilities(allVulnerabilities);
    const filteredVulns = this.filterVulnerabilities(dedupedVulns);

    this.emit('progress', {
      type: 'complete',
      message: 'Analyzing runtime risks...',
    } as ScanProgress);

    const runtimeRisks = analyzeRuntimeRisks(config, allFiles, this.options.runtimeChecks);

    const summary = summarizeVulnerabilities(filteredVulns);

    const result: ScanResult = {
      imageName,
      imageDigest: manifest.config.digest,
      scanTime: new Date().toISOString(),
      totalLayers: layerPaths.length,
      scannedLayers,
      cachedLayers,
      vulnerabilities: filteredVulns,
      runtimeRisks,
      summary,
    };

    this.emit('scan_complete', result);

    return result;
  }

  private filterVulnerabilities(vulns: Vulnerability[]): Vulnerability[] {
    let filtered = vulns;

    if (this.options.severityFilter && this.options.severityFilter.length > 0) {
      filtered = filtered.filter((v) =>
        this.options.severityFilter.includes(v.severity)
      );
    }

    if (this.options.onlyFixable) {
      filtered = filtered.filter((v) => v.fixedVersion && v.fixedVersion.length > 0);
    }

    return filtered;
  }

  private mergeFiles(base: FileInfo[], additions: FileInfo[]): FileInfo[] {
    const fileMap = new Map<string, FileInfo>();

    for (const f of base) {
      fileMap.set(f.path, f);
    }

    for (const f of additions) {
      fileMap.set(f.path, f);
    }

    return Array.from(fileMap.values());
  }

  private async freeMemory(): Promise<void> {
    if (global.gc) {
      global.gc();
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}
