import * as fs from 'fs';
import * as path from 'path';
import * as tar from 'tar';
import { Manifest, ImageConfig, ManifestLayer } from '../types';
import { readJsonFile } from '../utils/fs';

export function parseManifest(manifestPath: string): Manifest {
  const manifest = readJsonFile<any>(manifestPath);
  
  if (manifest.schemaVersion === 1) {
    return convertV1ToV2(manifest);
  }
  
  return manifest as Manifest;
}

function convertV1ToV2(v1Manifest: any): Manifest {
  const layers: ManifestLayer[] = v1Manifest.fsLayers.map((layer: any, index: number) => ({
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

export function parseImageConfig(configPath: string): ImageConfig {
  return readJsonFile<ImageConfig>(configPath);
}

export interface ExtractedImage {
  manifest: Manifest;
  config: ImageConfig;
  layerPaths: string[];
  extractDir: string;
}

export async function extractImageArchive(
  archivePath: string,
  extractDir: string
): Promise<ExtractedImage> {
  await tar.x({
    file: archivePath,
    cwd: extractDir,
  });

  const manifestPath = path.join(extractDir, 'manifest.json');
  if (!fs.existsSync(manifestPath)) {
    throw new Error('Invalid docker image: manifest.json not found');
  }

  const manifestList = readJsonFile<any[]>(manifestPath);
  if (!manifestList || manifestList.length === 0) {
    throw new Error('Invalid docker image: empty manifest');
  }

  const manifestEntry = manifestList[0];
  const configPath = path.join(extractDir, manifestEntry.Config);
  const config = parseImageConfig(configPath);

  const layerPaths: string[] = manifestEntry.Layers.map(
    (layer: string) => path.join(extractDir, layer)
  );

  const manifest: Manifest = {
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

export async function extractLayer(
  layerPath: string,
  targetDir: string
): Promise<void> {
  await tar.x({
    file: layerPath,
    cwd: targetDir,
  });
}

export function isWhiteoutFile(fileName: string): boolean {
  return fileName.startsWith('.wh.');
}

export function isOpaqueWhiteout(fileName: string): boolean {
  return fileName === '.wh..wh..opq';
}

export function getWhiteoutPath(fileName: string): string {
  return fileName.slice(4);
}
