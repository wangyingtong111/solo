"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.LayerCache = void 0;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const lru_cache_1 = require("lru-cache");
const fs_1 = require("../utils/fs");
class LayerCache {
    constructor(cacheDir, maxMemoryEntries = 100) {
        this.cacheDir = cacheDir;
        (0, fs_1.ensureDir)(cacheDir);
        this.dbPath = path.join(cacheDir, 'cache.db');
        this.index = new Map();
        this.memoryCache = new lru_cache_1.LRUCache({
            max: maxMemoryEntries,
            ttl: 1000 * 60 * 60 * 24,
        });
        this.loadIndex();
    }
    loadIndex() {
        const indexPath = path.join(this.cacheDir, 'index.json');
        if ((0, fs_1.fileExists)(indexPath)) {
            try {
                const data = (0, fs_1.readJsonFile)(indexPath);
                this.index = new Map(Object.entries(data));
            }
            catch (e) {
                this.index = new Map();
            }
        }
    }
    saveIndex() {
        const indexPath = path.join(this.cacheDir, 'index.json');
        const data = Object.fromEntries(this.index);
        (0, fs_1.writeJsonFile)(indexPath, data);
    }
    getCacheFilePath(layerDigest) {
        const safeDigest = layerDigest.replace(/[:/]/g, '_');
        return path.join(this.cacheDir, `${safeDigest}.json`);
    }
    has(layerDigest) {
        if (this.memoryCache.has(layerDigest)) {
            return true;
        }
        if (this.index.has(layerDigest)) {
            const filePath = this.index.get(layerDigest);
            return (0, fs_1.fileExists)(filePath);
        }
        const filePath = this.getCacheFilePath(layerDigest);
        const exists = (0, fs_1.fileExists)(filePath);
        if (exists) {
            this.index.set(layerDigest, filePath);
        }
        return exists;
    }
    get(layerDigest) {
        const memEntry = this.memoryCache.get(layerDigest);
        if (memEntry) {
            return memEntry;
        }
        const filePath = this.index.get(layerDigest) || this.getCacheFilePath(layerDigest);
        if (!(0, fs_1.fileExists)(filePath)) {
            return null;
        }
        try {
            const entry = (0, fs_1.readJsonFile)(filePath);
            this.memoryCache.set(layerDigest, entry);
            return entry;
        }
        catch (e) {
            return null;
        }
    }
    set(layerDigest, entry) {
        this.memoryCache.set(layerDigest, entry);
        const filePath = this.getCacheFilePath(layerDigest);
        (0, fs_1.writeJsonFile)(filePath, entry);
        this.index.set(layerDigest, filePath);
        this.saveIndex();
    }
    delete(layerDigest) {
        this.memoryCache.delete(layerDigest);
        const filePath = this.getCacheFilePath(layerDigest);
        if ((0, fs_1.fileExists)(filePath)) {
            fs.unlinkSync(filePath);
        }
        this.index.delete(layerDigest);
        this.saveIndex();
    }
    clear() {
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
    getStats() {
        return {
            total: this.index.size,
            memory: this.memoryCache.size,
            disk: this.index.size,
        };
    }
}
exports.LayerCache = LayerCache;
//# sourceMappingURL=cache.js.map