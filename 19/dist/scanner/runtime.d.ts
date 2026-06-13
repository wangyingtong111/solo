import { RuntimeRisk, ImageConfig, FileInfo } from '../types';
export interface RuntimeCheckOptions {
    checkPrivileged?: boolean;
    checkPorts?: boolean;
    checkMounts?: boolean;
    checkUser?: boolean;
    checkEnv?: boolean;
    checkHealthcheck?: boolean;
}
export declare function analyzeRuntimeRisks(config: ImageConfig, files: FileInfo[], options?: RuntimeCheckOptions): RuntimeRisk[];
