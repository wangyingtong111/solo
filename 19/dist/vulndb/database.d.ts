import { Vulnerability, Severity, VulnDatabaseMeta } from '../types';
export declare class VulnDatabase {
    private db;
    private dbPath;
    private initialized;
    private constructor();
    static create(dbPath: string): Promise<VulnDatabase>;
    private init;
    private initSchema;
    getMeta(key: string): string | null;
    setMeta(key: string, value: string): void;
    getMetadata(): VulnDatabaseMeta;
    addVulnerability(vuln: Vulnerability): void;
    addVulnerabilities(vulns: Vulnerability[]): void;
    searchByPackage(packageName: string, version?: string): Vulnerability[];
    searchBySeverity(severity: Severity): Vulnerability[];
    getVulnerabilityById(id: string): Vulnerability | null;
    getAllVulnerabilities(limit?: number, offset?: number): Vulnerability[];
    private updateCount;
    clearAll(): void;
    private save;
    close(): void;
    getDbPath(): string;
    isInitialized(): boolean;
}
export declare function compareVersions(v1: string, v2: string): number;
export declare function isVersionAffected(version: string, affectedRange: string): boolean;
