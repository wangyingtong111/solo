import { Manifest, ImageConfig } from '../types';
export declare function parseManifest(manifestPath: string): Manifest;
export declare function parseImageConfig(configPath: string): ImageConfig;
export interface ExtractedImage {
    manifest: Manifest;
    config: ImageConfig;
    layerPaths: string[];
    extractDir: string;
}
export declare function extractImageArchive(archivePath: string, extractDir: string): Promise<ExtractedImage>;
export declare function extractLayer(layerPath: string, targetDir: string): Promise<void>;
export declare function isWhiteoutFile(fileName: string): boolean;
export declare function isOpaqueWhiteout(fileName: string): boolean;
export declare function getWhiteoutPath(fileName: string): string;
