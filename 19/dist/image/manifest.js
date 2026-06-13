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
exports.parseManifest = parseManifest;
exports.parseImageConfig = parseImageConfig;
exports.extractImageArchive = extractImageArchive;
exports.extractLayer = extractLayer;
exports.isWhiteoutFile = isWhiteoutFile;
exports.isOpaqueWhiteout = isOpaqueWhiteout;
exports.getWhiteoutPath = getWhiteoutPath;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const tar = __importStar(require("tar"));
const fs_1 = require("../utils/fs");
function parseManifest(manifestPath) {
    const manifest = (0, fs_1.readJsonFile)(manifestPath);
    if (manifest.schemaVersion === 1) {
        return convertV1ToV2(manifest);
    }
    return manifest;
}
function convertV1ToV2(v1Manifest) {
    const layers = v1Manifest.fsLayers.map((layer, index) => ({
        mediaType: 'application/vnd.docker.image.rootfs.diff.tar.gzip',
        size: 0,
        digest: layer.blobSum,
    })).reverse();
    return {
        schemaVersion: 2,
        mediaType: 'application/vnd.docker.distribution.manifest.v2+json',
        config: {
            mediaType: 'application/vnd.docker.container.image.v1+json',
            size: 0,
            digest: v1Manifest.blobSum || '',
        },
        layers,
    };
}
function parseImageConfig(configPath) {
    return (0, fs_1.readJsonFile)(configPath);
}
async function extractImageArchive(archivePath, extractDir) {
    await tar.x({
        file: archivePath,
        cwd: extractDir,
    });
    const manifestPath = path.join(extractDir, 'manifest.json');
    if (!fs.existsSync(manifestPath)) {
        throw new Error('Invalid docker image: manifest.json not found');
    }
    const manifestList = (0, fs_1.readJsonFile)(manifestPath);
    if (!manifestList || manifestList.length === 0) {
        throw new Error('Invalid docker image: empty manifest');
    }
    const manifestEntry = manifestList[0];
    const configPath = path.join(extractDir, manifestEntry.Config);
    const config = parseImageConfig(configPath);
    const layerPaths = manifestEntry.Layers.map((layer) => path.join(extractDir, layer));
    const manifest = {
        schemaVersion: 2,
        config: {
            mediaType: 'application/vnd.docker.container.image.v1+json',
            size: fs.statSync(configPath).size,
            digest: '',
        },
        layers: layerPaths.map((_, index) => ({
            mediaType: 'application/vnd.docker.image.rootfs.diff.tar.gzip',
            size: fs.statSync(layerPaths[index]).size,
            digest: `sha256:${config.rootfs.diff_ids[index] || ''}`,
        })),
    };
    return {
        manifest,
        config,
        layerPaths,
        extractDir,
    };
}
async function extractLayer(layerPath, targetDir) {
    await tar.x({
        file: layerPath,
        cwd: targetDir,
    });
}
function isWhiteoutFile(fileName) {
    return fileName.startsWith('.wh.');
}
function isOpaqueWhiteout(fileName) {
    return fileName === '.wh..wh..opq';
}
function getWhiteoutPath(fileName) {
    return fileName.slice(4);
}
//# sourceMappingURL=manifest.js.map