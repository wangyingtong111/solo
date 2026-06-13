"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DANGEROUS_PORTS = exports.SENSITIVE_PATHS = exports.OS_PACKAGE_MANAGERS = exports.DEFAULT_DB_PATH = exports.DEFAULT_CACHE_DIR = exports.SEVERITY_COLORS = exports.SEVERITY_ORDER = void 0;
exports.SEVERITY_ORDER = {
    Critical: 0,
    High: 1,
    Medium: 2,
    Low: 3,
    Unknown: 4,
};
exports.SEVERITY_COLORS = {
    Critical: 'red',
    High: 'magenta',
    Medium: 'yellow',
    Low: 'green',
    Unknown: 'gray',
};
exports.DEFAULT_CACHE_DIR = '.dockerscan_cache';
exports.DEFAULT_DB_PATH = '.dockerscan/vulndb.sqlite';
exports.OS_PACKAGE_MANAGERS = [
    'dpkg',
    'apk',
    'rpm',
    'pip',
    'npm',
    'gem',
];
exports.SENSITIVE_PATHS = [
    '/etc/shadow',
    '/etc/passwd',
    '/etc/ssh',
    '/root',
    '/var/run/docker.sock',
    '/proc',
    '/sys',
    '/dev',
];
exports.DANGEROUS_PORTS = [
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
//# sourceMappingURL=constants.js.map