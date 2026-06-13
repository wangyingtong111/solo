export const SEVERITY_ORDER: Record<string, number> = {
  Critical: 0,
  High: 1,
  Medium: 2,
  Low: 3,
  Unknown: 4,
};

export const SEVERITY_COLORS: Record<string, string> = {
  Critical: 'red',
  High: 'magenta',
  Medium: 'yellow',
  Low: 'green',
  Unknown: 'gray',
};

export const DEFAULT_CACHE_DIR = '.dockerscan_cache';
export const DEFAULT_DB_PATH = '.dockerscan/vulndb.sqlite';

export const OS_PACKAGE_MANAGERS = [
  'dpkg',
  'apk',
  'rpm',
  'pip',
  'npm',
  'gem',
];

export const SENSITIVE_PATHS = [
  '/etc/shadow',
  '/etc/passwd',
  '/etc/ssh',
  '/root',
  '/var/run/docker.sock',
  '/proc',
  '/sys',
  '/dev',
];

export const DANGEROUS_PORTS = [
  22,
  23,
  3306,
  5432,
  6379,
  27017,
  9200,
  5601,
  10250,
  10255,
  2375,
  2376,
  4243,
];
