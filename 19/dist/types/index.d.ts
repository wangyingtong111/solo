export interface Manifest {
    schemaVersion: number;
    mediaType?: string;
    config: ManifestLayer;
    layers: ManifestLayer[];
    annotations?: Record<string, string>;
}
export interface ManifestLayer {
    mediaType: string;
    size: number;
    digest: string;
}
export interface ImageConfig {
    architecture: string;
    os: string;
    osVersion?: string;
    osFeatures?: string[];
    config: ContainerConfig;
    rootfs: RootFS;
    history: HistoryEntry[];
    created?: string;
    author?: string;
}
export interface ContainerConfig {
    User?: string;
    ExposedPorts?: Record<string, unknown>;
    Env?: string[];
    Entrypoint?: string[];
    Cmd?: string[];
    Volumes?: Record<string, unknown>;
    WorkingDir?: string;
    Labels?: Record<string, string>;
    StopSignal?: string;
    StopTimeout?: number;
    Shell?: string[];
    Healthcheck?: HealthConfig;
}
export interface HealthConfig {
    Test: string[];
    Interval?: number;
    Timeout?: number;
    Retries?: number;
    StartPeriod?: number;
}
export interface RootFS {
    type: string;
    diff_ids: string[];
}
export interface HistoryEntry {
    created: string;
    created_by?: string;
    author?: string;
    comment?: string;
    empty_layer?: boolean;
}
export interface LayerInfo {
    digest: string;
    diffId: string;
    size: number;
    mediaType: string;
    index: number;
    packages: PackageInfo[];
    files: FileInfo[];
}
export interface PackageInfo {
    name: string;
    version: string;
    source?: string;
    packageManager: string;
    layerIndex: number;
}
export interface FileInfo {
    path: string;
    size: number;
    mode: number;
    type: 'file' | 'directory' | 'symlink';
}
export interface Vulnerability {
    id: string;
    severity: Severity;
    description: string;
    packageName: string;
    packageVersion: string;
    fixedVersion?: string;
    references?: string[];
    cweIds?: string[];
    cvssScore?: number;
    cvssVector?: string;
    publishedDate?: string;
    lastModifiedDate?: string;
}
export type Severity = 'Critical' | 'High' | 'Medium' | 'Low' | 'Unknown';
export interface ScanResult {
    imageName: string;
    imageDigest?: string;
    scanTime: string;
    totalLayers: number;
    scannedLayers: number;
    cachedLayers: number;
    vulnerabilities: Vulnerability[];
    runtimeRisks: RuntimeRisk[];
    summary: ScanSummary;
}
export interface ScanSummary {
    critical: number;
    high: number;
    medium: number;
    low: number;
    unknown: number;
    total: number;
    fixable: number;
}
export interface RuntimeRisk {
    id: string;
    severity: Severity;
    category: string;
    title: string;
    description: string;
    evidence: string;
    remediation: string;
}
export interface CacheEntry {
    layerDigest: string;
    packages: PackageInfo[];
    scanTime: string;
    vulnerabilityCount: number;
}
export interface VulnDatabaseMeta {
    version: string;
    lastUpdate: string;
    totalVulns: number;
    source: string;
}
