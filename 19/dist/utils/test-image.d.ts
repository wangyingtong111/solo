export interface TestImageConfig {
    name: string;
    layers: TestLayerConfig[];
    config?: Partial<{
        User: string;
        ExposedPorts: Record<string, unknown>;
        Env: string[];
        Cmd: string[];
        Volumes: Record<string, unknown>;
        WorkingDir: string;
    }>;
}
export interface TestLayerConfig {
    files: TestFileConfig[];
    packages?: TestPackageConfig[];
}
export interface TestFileConfig {
    path: string;
    content?: string;
    mode?: number;
    type?: 'file' | 'directory';
}
export interface TestPackageConfig {
    name: string;
    version: string;
    manager: 'dpkg' | 'apk' | 'pip' | 'npm';
}
export declare function createTestImage(outputPath: string, imageConfig: TestImageConfig): Promise<void>;
export declare function createVulnerableTestImage(outputPath: string): Promise<void>;
