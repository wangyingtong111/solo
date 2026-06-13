import { EventEmitter } from 'events';
import { ScanResult } from '../types';
import { VulnDatabase } from '../vulndb';
import { LayerCache } from './cache';
import { ExtractedImage } from '../image';
import { RuntimeCheckOptions } from './runtime';
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
export declare class ScanEngine extends EventEmitter {
    private db;
    private cache;
    private options;
    constructor(db: VulnDatabase, cache: LayerCache, options?: ScanOptions);
    scan(imageName: string, extractedImage: ExtractedImage): Promise<ScanResult>;
    private filterVulnerabilities;
    private mergeFiles;
    private freeMemory;
}
