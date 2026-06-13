import { VulnDatabase } from './database';
export declare class VulnDBUpdater {
    private db;
    private apiKey?;
    constructor(db: VulnDatabase, apiKey?: string);
    updateFromNVD(startDate?: string, endDate?: string): Promise<{
        added: number;
        updated: number;
    }>;
    private parseNvdVulns;
    private extractAffectedPackages;
    private severityFromScore;
    seedSampleData(): Promise<void>;
}
