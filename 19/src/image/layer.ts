import * as fs from 'fs';
import * as path from 'path';
import { PackageInfo, FileInfo } from '../types';
import { extractLayer, isWhiteoutFile, isOpaqueWhiteout, getWhiteoutPath } from './manifest';
import { tempDir } from '../utils/fs';

const PACKAGE_FILES: Record<string, string[]> = {
  dpkg: ['var/lib/dpkg/status'],
  apk: ['lib/apk/db/installed'],
  rpm: ['var/lib/rpm/Packages'],
  pip: [
    'usr/lib/python*/site-packages/*.dist-info/METADATA',
    'usr/local/lib/python*/site-packages/*.dist-info/METADATA',
  ],
  npm: [
    'usr/lib/node_modules/*/package.json',
    'usr/local/lib/node_modules/*/package.json',
  ],
  gem: [
    'usr/lib/ruby/gems/*/specifications/*.gemspec',
    'usr/local/lib/ruby/gems/*/specifications/*.gemspec',
  ],
};

export async function analyzeLayer(
  layerPath: string,
  layerIndex: number,
  basePackages: PackageInfo[] = []
): Promise<{ packages: PackageInfo[]; files: FileInfo[] }> {
  const extractDir = tempDir();
  let packages: PackageInfo[] = [...basePackages];
  const files: FileInfo[] = [];

  try {
    await extractLayer(layerPath, extractDir);

    traverseFiles(extractDir, '', files);

    packages = applyWhiteouts(packages, files);

    const newPackages = await extractPackagesFromLayer(extractDir, layerIndex);
    packages = mergePackages(packages, newPackages);

    return { packages, files };
  } finally {
    require('fs').rmSync(extractDir, { recursive: true, force: true });
  }
}

function traverseFiles(dir: string, relativePath: string, files: FileInfo[]): void {
  const entries = fs.readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    const relPath = path.join(relativePath, entry.name);

    try {
      const stat = fs.statSync(fullPath);

      if (entry.isDirectory()) {
        files.push({
          path: `/${relPath.replace(/\\/g, '/')}`,
          size: 0,
          mode: stat.mode,
          type: 'directory',
        });
        traverseFiles(fullPath, relPath, files);
      } else if (entry.isFile()) {
        files.push({
          path: `/${relPath.replace(/\\/g, '/')}`,
          size: stat.size,
          mode: stat.mode,
          type: 'file',
        });
      } else if (entry.isSymbolicLink()) {
        files.push({
          path: `/${relPath.replace(/\\/g, '/')}`,
          size: 0,
          mode: stat.mode,
          type: 'symlink',
        });
      }
    } catch (e) {
      // Skip inaccessible files
    }
  }
}

function applyWhiteouts(packages: PackageInfo[], files: FileInfo[]): PackageInfo[] {
  const whiteouts = files.filter((f) => isWhiteoutFile(path.basename(f.path)));

  if (whiteouts.length === 0) return packages;

  const removedFiles = new Set<string>();
  for (const wh of whiteouts) {
    const baseName = path.basename(wh.path);
    if (isOpaqueWhiteout(baseName)) {
      const dirPath = path.dirname(wh.path);
      packages = packages.filter((p) => !p.name.startsWith(dirPath));
    } else {
      const filePath = path.join(path.dirname(wh.path), getWhiteoutPath(baseName));
      removedFiles.add(filePath);
    }
  }

  return packages;
}

function mergePackages(base: PackageInfo[], newPkgs: PackageInfo[]): PackageInfo[] {
  const pkgMap = new Map<string, PackageInfo>();

  for (const pkg of base) {
    pkgMap.set(`${pkg.packageManager}:${pkg.name}`, pkg);
  }

  for (const pkg of newPkgs) {
    pkgMap.set(`${pkg.packageManager}:${pkg.name}`, pkg);
  }

  return Array.from(pkgMap.values());
}

async function extractPackagesFromLayer(
  extractDir: string,
  layerIndex: number
): Promise<PackageInfo[]> {
  const packages: PackageInfo[] = [];

  const dpkgStatus = path.join(extractDir, 'var/lib/dpkg/status');
  if (fs.existsSync(dpkgStatus)) {
    packages.push(...parseDpkgStatus(dpkgStatus, layerIndex));
  }

  const apkDb = path.join(extractDir, 'lib/apk/db/installed');
  if (fs.existsSync(apkDb)) {
    packages.push(...parseApkDb(apkDb, layerIndex));
  }

  const pythonPkgDirs = findPythonPackages(extractDir);
  for (const pkgDir of pythonPkgDirs) {
    const metadata = path.join(pkgDir, 'METADATA');
    if (fs.existsSync(metadata)) {
      const pkg = parsePythonMetadata(metadata, layerIndex);
      if (pkg) packages.push(pkg);
    }
  }

  const nodeModulesPath = path.join(extractDir, 'usr/lib/node_modules');
  if (fs.existsSync(nodeModulesPath)) {
    packages.push(...parseNodeModules(nodeModulesPath, layerIndex));
  }

  const nodeModulesLocalPath = path.join(extractDir, 'usr/local/lib/node_modules');
  if (fs.existsSync(nodeModulesLocalPath)) {
    packages.push(...parseNodeModules(nodeModulesLocalPath, layerIndex));
  }

  return packages;
}

function parseDpkgStatus(filePath: string, layerIndex: number): PackageInfo[] {
  const content = fs.readFileSync(filePath, 'utf-8');
  const packages: PackageInfo[] = [];
  const entries = content.split('\n\n');

  for (const entry of entries) {
    const lines = entry.trim().split('\n');
    const pkg: any = {};

    for (const line of lines) {
      const match = line.match(/^(\w+):\s*(.+)$/);
      if (match) {
        pkg[match[1].toLowerCase()] = match[2];
      }
    }

    if (pkg.package && pkg.version) {
      packages.push({
        name: pkg.package,
        version: pkg.version,
        source: pkg.source || undefined,
        packageManager: 'dpkg',
        layerIndex,
      });
    }
  }

  return packages;
}

function parseApkDb(filePath: string, layerIndex: number): PackageInfo[] {
  const content = fs.readFileSync(filePath, 'utf-8');
  const packages: PackageInfo[] = [];
  const entries = content.split('\n\n');

  for (const entry of entries) {
    const lines = entry.trim().split('\n');
    const pkg: any = {};

    for (const line of lines) {
      const match = line.match(/^([A-Z]):(.+)$/);
      if (match) {
        switch (match[1]) {
          case 'P':
            pkg.name = match[2];
            break;
          case 'V':
            pkg.version = match[2];
            break;
        }
      }
    }

    if (pkg.name && pkg.version) {
      packages.push({
        name: pkg.name,
        version: pkg.version,
        packageManager: 'apk',
        layerIndex,
      });
    }
  }

  return packages;
}

function findPythonPackages(extractDir: string): string[] {
  const result: string[] = [];
  const searchPaths = [
    path.join(extractDir, 'usr/lib'),
    path.join(extractDir, 'usr/local/lib'),
  ];

  for (const searchPath of searchPaths) {
    if (!fs.existsSync(searchPath)) continue;

    const entries = fs.readdirSync(searchPath, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith('python') && entry.isDirectory()) {
        const sitePackages = path.join(searchPath, entry.name, 'site-packages');
        if (fs.existsSync(sitePackages)) {
          const pkgs = fs.readdirSync(sitePackages, { withFileTypes: true });
          for (const pkg of pkgs) {
            if (pkg.name.endsWith('.dist-info') && pkg.isDirectory()) {
              result.push(path.join(sitePackages, pkg.name));
            }
          }
        }
      }
    }
  }

  return result;
}

function parsePythonMetadata(metadataPath: string, layerIndex: number): PackageInfo | null {
  try {
    const content = fs.readFileSync(metadataPath, 'utf-8');
    let name = '';
    let version = '';

    const nameMatch = content.match(/^Name:\s+(.+)$/m);
    const versionMatch = content.match(/^Version:\s+(.+)$/m);

    if (nameMatch) name = nameMatch[1].trim();
    if (versionMatch) version = versionMatch[1].trim();

    if (name && version) {
      return {
        name,
        version,
        packageManager: 'pip',
        layerIndex,
      };
    }
  } catch (e) {
    // ignore
  }

  return null;
}

function parseNodeModules(dirPath: string, layerIndex: number): PackageInfo[] {
  const packages: PackageInfo[] = [];

  if (!fs.existsSync(dirPath)) return packages;

  const entries = fs.readdirSync(dirPath, { withFileTypes: true });

  for (const entry of entries) {
    if (entry.isDirectory()) {
      const pkgJsonPath = path.join(dirPath, entry.name, 'package.json');
      if (fs.existsSync(pkgJsonPath)) {
        try {
          const pkgJson = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf-8'));
          if (pkgJson.name && pkgJson.version) {
            packages.push({
              name: pkgJson.name,
              version: pkgJson.version,
              packageManager: 'npm',
              layerIndex,
            });
          }
        } catch (e) {
          // ignore
        }
      }
    }
  }

  return packages;
}
