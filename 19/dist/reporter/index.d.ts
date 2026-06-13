import { ScanResult } from '../types';
export type ReportFormat = 'json' | 'html' | 'jenkins' | 'table';
export interface ReportOptions {
    format: ReportFormat;
    outputPath?: string;
    includeRemediation?: boolean;
    minSeverity?: string;
}
export declare function generateReport(result: ScanResult, options: ReportOptions): string;
