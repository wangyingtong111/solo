import { PackageInfo, FileInfo } from '../types';
export declare function analyzeLayer(layerPath: string, layerIndex: number, basePackages?: PackageInfo[]): Promise<{
    packages: PackageInfo[];
    files: FileInfo[];
}>;
