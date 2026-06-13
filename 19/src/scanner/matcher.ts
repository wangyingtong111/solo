import { Vulnerability, PackageInfo, Severity, Vulnerability as TVulnerability } from '../types';
import { VulnDatabase, isVersionAffected } from '../vulndb';
import { SEVERITY_ORDER } from '../constants';

export function matchVulnerabilities(
  packages: PackageInfo[],
  db: VulnDatabase
): Vulnerability[] {
  const vulnerabilities: Vulnerability[] = [];
  const seen = new Set<string>();

  for (const pkg of packages) {
    const vulns = db.searchByPackage(pkg.name);

    for (const vuln of vulns) {
      const key = `${vuln.id}:${pkg.name}:${pkg.version}`;
      if (seen.has(key)) continue;
      seen.add(key);

      if (vuln.packageVersion) {
        if (!isVersionAffected(pkg.version, vuln.packageVersion)) {
          continue;
        }
      }

      vulnerabilities.push({
        ...vuln,
        packageVersion: pkg.version,
      });
    }
  }

  return sortBySeverity(vulnerabilities);
}

export function sortBySeverity(vulns: Vulnerability[]): Vulnerability[] {
  return [...vulns].sort((a, b) => {
    const orderA = SEVERITY_ORDER[a.severity] ?? 999;
    const orderB = SEVERITY_ORDER[b.severity] ?? 999;

    if (orderA !== orderB) return orderA - orderB;

    const scoreA = a.cvssScore ?? 0;
    const scoreB = b.cvssScore ?? 0;
    if (scoreA !== scoreB) return scoreB - scoreA;

    return a.id.localeCompare(b.id);
  });
}

export function deduplicateVulnerabilities(vulns: Vulnerability[]): Vulnerability[] {
  const seen = new Map<string, Vulnerability>();

  for (const vuln of vulns) {
    const key = `${vuln.id}:${vuln.packageName}`;
    const existing = seen.get(key);

    if (!existing) {
      seen.set(key, vuln);
    } else {
      if (vuln.packageVersion && !existing.packageVersion) {
        seen.set(key, vuln);
      } else if (vuln.cvssScore && existing.cvssScore && vuln.cvssScore > existing.cvssScore) {
        seen.set(key, vuln);
      }
    }
  }

  return sortBySeverity(Array.from(seen.values()));
}

export function getFixableCount(vulns: Vulnerability[]): number {
  return vulns.filter((v) => v.fixedVersion && v.fixedVersion.length > 0).length;
}

export function summarizeVulnerabilities(vulns: Vulnerability[]): {
  critical: number;
  high: number;
  medium: number;
  low: number;
  unknown: number;
  total: number;
  fixable: number;
} {
  const summary = {
    critical: 0,
    high: 0,
    medium: 0,
    low: 0,
    unknown: 0,
    total: vulns.length,
    fixable: getFixableCount(vulns),
  };

  for (const vuln of vulns) {
    switch (vuln.severity) {
      case 'Critical':
        summary.critical++;
        break;
      case 'High':
        summary.high++;
        break;
      case 'Medium':
        summary.medium++;
        break;
      case 'Low':
        summary.low++;
        break;
      default:
        summary.unknown++;
    }
  }

  return summary;
}

export function getSeverityAdvice(vuln: Vulnerability): string {
  switch (vuln.severity) {
    case 'Critical':
      return `CRITICAL: 立即修复！升级 ${vuln.packageName} 到 ${vuln.fixedVersion || '最新版本'}`;
    case 'High':
      return `HIGH: 尽快修复！升级 ${vuln.packageName} 到 ${vuln.fixedVersion || '最新版本'}`;
    case 'Medium':
      return `MEDIUM: 计划修复！考虑升级 ${vuln.packageName} 到 ${vuln.fixedVersion || '最新版本'}`;
    case 'Low':
      return `LOW: 观察跟踪，或升级到 ${vuln.fixedVersion || '最新版本'}`;
    default:
      return 'UNKNOWN: 需要进一步评估';
  }
}
