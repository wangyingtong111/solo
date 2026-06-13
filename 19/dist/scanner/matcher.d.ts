import { Vulnerability, PackageInfo } from '../types';
import { VulnDatabase } from '../vulndb';
export declare function matchVulnerabilities(packages: PackageInfo[], db: VulnDatabase): Vulnerability[];
export declare function sortBySeverity(vulns: Vulnerability[]): Vulnerability[];
export declare function deduplicateVulnerabilities(vulns: Vulnerability[]): Vulnerability[];
export declare function getFixableCount(vulns: Vulnerability[]): number;
export declare function summarizeVulnerabilities(vulns: Vulnerability[]): {
    critical: number;
    high: number;
    medium: number;
    low: number;
    unknown: number;
    total: number;
    fixable: number;
};
export declare function getSeverityAdvice(vuln: Vulnerability): string;
