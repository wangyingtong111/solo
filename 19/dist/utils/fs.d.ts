export declare function ensureDir(dirPath: string): void;
export declare function fileExists(filePath: string): boolean;
export declare function readJsonFile<T>(filePath: string): T;
export declare function writeJsonFile<T>(filePath: string, data: T): void;
export declare function getFileSize(filePath: string): number;
export declare function listFiles(dirPath: string, recursive?: boolean): string[];
export declare function deleteDir(dirPath: string): void;
export declare function tempDir(): string;
