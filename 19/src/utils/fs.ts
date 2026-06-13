import * as fs from 'fs';
import * as path from 'path';

export function ensureDir(dirPath: string): void {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

export function fileExists(filePath: string): boolean {
  try {
    fs.accessSync(filePath, fs.constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

export function readJsonFile<T>(filePath: string): T {
  const content = fs.readFileSync(filePath, 'utf-8');
  return JSON.parse(content) as T;
}

export function writeJsonFile<T>(filePath: string, data: T): void {
  const dir = path.dirname(filePath);
  ensureDir(dir);
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
}

export function getFileSize(filePath: string): number {
  const stat = fs.statSync(filePath);
  return stat.size;
}

export function listFiles(dirPath: string, recursive = true): string[] {
  const files: string[] = [];
  const entries = fs.readdirSync(dirPath, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory() && recursive) {
      files.push(...listFiles(fullPath, recursive));
    } else if (entry.isFile()) {
      files.push(fullPath);
    }
  }

  return files;
}

export function deleteDir(dirPath: string): void {
  if (fs.existsSync(dirPath)) {
    fs.rmSync(dirPath, { recursive: true, force: true });
  }
}

export function tempDir(): string {
  const tmpDir = path.join(
    require('os').tmpdir(),
    `dockerscan_${Date.now()}_${Math.random().toString(36).slice(2)}`
  );
  ensureDir(tmpDir);
  return tmpDir;
}
