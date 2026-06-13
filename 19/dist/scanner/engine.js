"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ScanEngine = void 0;
const events_1 = require("events");
const image_1 = require("../image");
const matcher_1 = require("./matcher");
const runtime_1 = require("./runtime");
class ScanEngine extends events_1.EventEmitter {
    constructor(db, cache, options = {}) {
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
    async scan(imageName, extractedImage) {
        const { manifest, config, layerPaths } = extractedImage;
        this.emit('start', {
            imageName,
            totalLayers: layerPaths.length,
        });
        let allPackages = [];
        let allFiles = [];
        let cachedLayers = 0;
        let scannedLayers = 0;
        const allVulnerabilities = [];
        let cumulativePackages = [];
        for (let i = 0; i < layerPaths.length; i++) {
            const layerDigest = manifest.layers[i]?.digest || `layer-${i}`;
            this.emit('progress', {
                type: 'layer_start',
                layerIndex: i,
                layerDigest,
                message: `Analyzing layer ${i + 1}/${layerPaths.length}`,
            });
            let layerPackages = [];
            let layerFiles = [];
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
                    });
                }
            }
            if (!usedCache) {
                const result = await (0, image_1.analyzeLayer)(layerPaths[i], i, cumulativePackages);
                layerPackages = result.packages;
                layerFiles = result.files;
                scannedLayers++;
                if (this.options.useCache) {
                    const layerVulns = (0, matcher_1.matchVulnerabilities)(layerPackages, this.db);
                    this.cache.set(layerDigest, {
                        layerDigest,
                        packages: layerPackages,
                        scanTime: new Date().toISOString(),
                        vulnerabilityCount: layerVulns.length,
                    });
                }
            }
            cumulativePackages = layerPackages;
            const layerVulns = (0, matcher_1.matchVulnerabilities)(layerPackages, this.db);
            if (layerVulns.length > 0) {
                allVulnerabilities.push(...layerVulns);
                this.emit('progress', {
                    type: 'vuln_found',
                    layerIndex: i,
                    layerDigest,
                    vulnCount: layerVulns.length,
                    message: `Found ${layerVulns.length} vulnerabilities in layer ${i + 1}`,
                });
            }
            allFiles = this.mergeFiles(allFiles, layerFiles);
            const usedMemory = process.memoryUsage().heapUsed;
            if (usedMemory > this.options.memoryLimit) {
                await this.freeMemory();
            }
        }
        const dedupedVulns = (0, matcher_1.deduplicateVulnerabilities)(allVulnerabilities);
        const filteredVulns = this.filterVulnerabilities(dedupedVulns);
        this.emit('progress', {
            type: 'complete',
            message: 'Analyzing runtime risks...',
        });
        const runtimeRisks = (0, runtime_1.analyzeRuntimeRisks)(config, allFiles, this.options.runtimeChecks);
        const summary = (0, matcher_1.summarizeVulnerabilities)(filteredVulns);
        const result = {
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
    filterVulnerabilities(vulns) {
        let filtered = vulns;
        if (this.options.severityFilter && this.options.severityFilter.length > 0) {
            filtered = filtered.filter((v) => this.options.severityFilter.includes(v.severity));
        }
        if (this.options.onlyFixable) {
            filtered = filtered.filter((v) => v.fixedVersion && v.fixedVersion.length > 0);
        }
        return filtered;
    }
    mergeFiles(base, additions) {
        const fileMap = new Map();
        for (const f of base) {
            fileMap.set(f.path, f);
        }
        for (const f of additions) {
            fileMap.set(f.path, f);
        }
        return Array.from(fileMap.values());
    }
    async freeMemory() {
        if (global.gc) {
            global.gc();
        }
        await new Promise((resolve) => setTimeout(resolve, 10));
    }
}
exports.ScanEngine = ScanEngine;
//# sourceMappingURL=engine.js.map