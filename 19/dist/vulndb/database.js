"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.VulnDatabase = void 0;
exports.compareVersions = compareVersions;
exports.isVersionAffected = isVersionAffected;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const sql_js_1 = __importDefault(require("sql.js"));
const fs_1 = require("../utils/fs");
let SQL;
async function getSqlInstance() {
    if (!SQL) {
        SQL = await (0, sql_js_1.default)({
            locateFile: (file) => require.resolve(`sql.js/dist/${file}`),
        });
    }
    return SQL;
}
class VulnDatabase {
    constructor(dbPath) {
        this.db = null;
        this.initialized = false;
        this.dbPath = dbPath;
        const dir = path.dirname(dbPath);
        (0, fs_1.ensureDir)(dir);
    }
    static async create(dbPath) {
        const instance = new VulnDatabase(dbPath);
        await instance.init();
        return instance;
    }
    async init() {
        const sql = await getSqlInstance();
        if ((0, fs_1.fileExists)(this.dbPath)) {
            const data = fs.readFileSync(this.dbPath);
            this.db = new sql.Database(data);
        }
        else {
            this.db = new sql.Database();
        }
        this.initSchema();
        this.initialized = true;
    }
    initSchema() {
        if (!this.db)
            throw new Error('Database not initialized');
        this.db.exec(`
      CREATE TABLE IF NOT EXISTS vulnerabilities (
        id TEXT PRIMARY KEY,
        severity TEXT NOT NULL,
        description TEXT,
        package_name TEXT NOT NULL,
        package_version TEXT,
        fixed_version TEXT,
        cvss_score REAL,
        cvss_vector TEXT,
        cwe_ids TEXT,
        refs TEXT,
        published_date TEXT,
        last_modified_date TEXT,
        created_at TEXT DEFAULT (datetime('now'))
      );

      CREATE INDEX IF NOT EXISTS idx_vulns_package 
        ON vulnerabilities(package_name);
      
      CREATE INDEX IF NOT EXISTS idx_vulns_severity 
        ON vulnerabilities(severity);

      CREATE TABLE IF NOT EXISTS meta (
        key TEXT PRIMARY KEY,
        value TEXT
      );

      CREATE TABLE IF NOT EXISTS package_versions (
        package_name TEXT NOT NULL,
        version TEXT NOT NULL,
        vuln_id TEXT NOT NULL,
        PRIMARY KEY (package_name, version, vuln_id),
        FOREIGN KEY (vuln_id) REFERENCES vulnerabilities(id)
      );

      CREATE INDEX IF NOT EXISTS idx_pkg_versions 
        ON package_versions(package_name, version);
    `);
        const metaStmt = this.db.prepare("SELECT 1 FROM meta WHERE key = ?");
        const result = metaStmt.getAsObject(['version']);
        metaStmt.free();
        if (!result) {
            this.setMeta('version', '1.0.0');
            this.setMeta('last_update', '');
            this.setMeta('total_vulns', '0');
            this.setMeta('source', 'internal');
        }
    }
    getMeta(key) {
        if (!this.db)
            throw new Error('Database not initialized');
        const stmt = this.db.prepare('SELECT value FROM meta WHERE key = ?');
        const result = stmt.getAsObject([key]);
        stmt.free();
        return result ? result.value : null;
    }
    setMeta(key, value) {
        if (!this.db)
            throw new Error('Database not initialized');
        const stmt = this.db.prepare('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)');
        stmt.run([key, value]);
        stmt.free();
        this.save();
    }
    getMetadata() {
        return {
            version: this.getMeta('version') || '1.0.0',
            lastUpdate: this.getMeta('last_update') || '',
            totalVulns: parseInt(this.getMeta('total_vulns') || '0', 10),
            source: this.getMeta('source') || 'internal',
        };
    }
    addVulnerability(vuln) {
        if (!this.db)
            throw new Error('Database not initialized');
        const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO vulnerabilities (
        id, severity, description, package_name, package_version,
        fixed_version, cvss_score, cvss_vector, cwe_ids, refs,
        published_date, last_modified_date
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
        stmt.run([
            vuln.id,
            vuln.severity,
            vuln.description || '',
            vuln.packageName,
            vuln.packageVersion || '',
            vuln.fixedVersion || '',
            vuln.cvssScore !== undefined ? vuln.cvssScore : null,
            vuln.cvssVector || '',
            vuln.cweIds ? JSON.stringify(vuln.cweIds) : '',
            vuln.references ? JSON.stringify(vuln.references) : '',
            vuln.publishedDate || '',
            vuln.lastModifiedDate || '',
        ]);
        stmt.free();
        this.save();
    }
    addVulnerabilities(vulns) {
        if (!this.db)
            throw new Error('Database not initialized');
        this.db.run('BEGIN TRANSACTION');
        try {
            const stmt = this.db.prepare(`
        INSERT OR REPLACE INTO vulnerabilities (
          id, severity, description, package_name, package_version,
          fixed_version, cvss_score, cvss_vector, cwe_ids, refs,
          published_date, last_modified_date
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
            for (const vuln of vulns) {
                stmt.run([
                    vuln.id,
                    vuln.severity,
                    vuln.description || '',
                    vuln.packageName,
                    vuln.packageVersion || '',
                    vuln.fixedVersion || '',
                    vuln.cvssScore !== undefined ? vuln.cvssScore : null,
                    vuln.cvssVector || '',
                    vuln.cweIds ? JSON.stringify(vuln.cweIds) : '',
                    vuln.references ? JSON.stringify(vuln.references) : '',
                    vuln.publishedDate || '',
                    vuln.lastModifiedDate || '',
                ]);
            }
            stmt.free();
            this.db.run('COMMIT');
        }
        catch (e) {
            this.db.run('ROLLBACK');
            throw e;
        }
        this.updateCount();
        this.save();
    }
    searchByPackage(packageName, version) {
        if (!this.db)
            throw new Error('Database not initialized');
        let query = `
      SELECT id, severity, description, package_name, package_version,
             fixed_version, cvss_score, cvss_vector, cwe_ids, refs,
             published_date, last_modified_date
      FROM vulnerabilities
      WHERE package_name = ?
    `;
        const params = [packageName];
        if (version) {
            query += ' AND (package_version = ? OR package_version = "")';
            params.push(version);
        }
        query += ' ORDER BY severity DESC';
        const stmt = this.db.prepare(query);
        const results = stmt.getAsObject(params);
        stmt.free();
        if (!results || Object.keys(results).length === 0) {
            return [];
        }
        const rows = this.db.exec(query, params);
        if (rows.length === 0 || rows[0].values.length === 0) {
            return [];
        }
        const columns = rows[0].columns;
        return rows[0].values.map((row) => {
            const obj = {};
            columns.forEach((col, idx) => {
                obj[col] = row[idx];
            });
            return {
                id: obj.id,
                severity: obj.severity,
                description: obj.description,
                packageName: obj.package_name,
                packageVersion: obj.package_version,
                fixedVersion: obj.fixed_version || undefined,
                cvssScore: obj.cvss_score !== null ? obj.cvss_score : undefined,
                cvssVector: obj.cvss_vector || undefined,
                cweIds: obj.cwe_ids ? JSON.parse(obj.cwe_ids) : undefined,
                references: obj.refs ? JSON.parse(obj.refs) : undefined,
                publishedDate: obj.published_date || undefined,
                lastModifiedDate: obj.last_modified_date || undefined,
            };
        });
    }
    searchBySeverity(severity) {
        if (!this.db)
            throw new Error('Database not initialized');
        const query = `
      SELECT id, severity, description, package_name, package_version,
             fixed_version, cvss_score, cvss_vector, cwe_ids, refs,
             published_date, last_modified_date
      FROM vulnerabilities
      WHERE severity = ?
      ORDER BY published_date DESC
    `;
        const rows = this.db.exec(query, [severity]);
        if (rows.length === 0 || rows[0].values.length === 0) {
            return [];
        }
        const columns = rows[0].columns;
        return rows[0].values.map((row) => {
            const obj = {};
            columns.forEach((col, idx) => {
                obj[col] = row[idx];
            });
            return {
                id: obj.id,
                severity: obj.severity,
                description: obj.description,
                packageName: obj.package_name,
                packageVersion: obj.package_version,
                fixedVersion: obj.fixed_version || undefined,
                cvssScore: obj.cvss_score !== null ? obj.cvss_score : undefined,
                cvssVector: obj.cvss_vector || undefined,
                cweIds: obj.cwe_ids ? JSON.parse(obj.cwe_ids) : undefined,
                references: obj.refs ? JSON.parse(obj.refs) : undefined,
                publishedDate: obj.published_date || undefined,
                lastModifiedDate: obj.last_modified_date || undefined,
            };
        });
    }
    getVulnerabilityById(id) {
        if (!this.db)
            throw new Error('Database not initialized');
        const query = `
      SELECT id, severity, description, package_name, package_version,
             fixed_version, cvss_score, cvss_vector, cwe_ids, refs,
             published_date, last_modified_date
      FROM vulnerabilities
      WHERE id = ?
    `;
        const rows = this.db.exec(query, [id]);
        if (rows.length === 0 || rows[0].values.length === 0) {
            return null;
        }
        const obj = {};
        const columns = rows[0].columns;
        const row = rows[0].values[0];
        columns.forEach((col, idx) => {
            obj[col] = row[idx];
        });
        return {
            id: obj.id,
            severity: obj.severity,
            description: obj.description,
            packageName: obj.package_name,
            packageVersion: obj.package_version,
            fixedVersion: obj.fixed_version || undefined,
            cvssScore: obj.cvss_score !== null ? obj.cvss_score : undefined,
            cvssVector: obj.cvss_vector || undefined,
            cweIds: obj.cwe_ids ? JSON.parse(obj.cwe_ids) : undefined,
            references: obj.refs ? JSON.parse(obj.refs) : undefined,
            publishedDate: obj.published_date || undefined,
            lastModifiedDate: obj.last_modified_date || undefined,
        };
    }
    getAllVulnerabilities(limit = 100, offset = 0) {
        if (!this.db)
            throw new Error('Database not initialized');
        const query = `
      SELECT id, severity, description, package_name, package_version,
             fixed_version, cvss_score, cvss_vector, cwe_ids, refs,
             published_date, last_modified_date
      FROM vulnerabilities
      ORDER BY severity, published_date DESC
      LIMIT ? OFFSET ?
    `;
        const rows = this.db.exec(query, [limit, offset]);
        if (rows.length === 0 || rows[0].values.length === 0) {
            return [];
        }
        const columns = rows[0].columns;
        return rows[0].values.map((row) => {
            const obj = {};
            columns.forEach((col, idx) => {
                obj[col] = row[idx];
            });
            return {
                id: obj.id,
                severity: obj.severity,
                description: obj.description,
                packageName: obj.package_name,
                packageVersion: obj.package_version,
                fixedVersion: obj.fixed_version || undefined,
                cvssScore: obj.cvss_score !== null ? obj.cvss_score : undefined,
                cvssVector: obj.cvss_vector || undefined,
                cweIds: obj.cwe_ids ? JSON.parse(obj.cwe_ids) : undefined,
                references: obj.refs ? JSON.parse(obj.refs) : undefined,
                publishedDate: obj.published_date || undefined,
                lastModifiedDate: obj.last_modified_date || undefined,
            };
        });
    }
    updateCount() {
        if (!this.db)
            throw new Error('Database not initialized');
        const rows = this.db.exec('SELECT COUNT(*) as cnt FROM vulnerabilities');
        if (rows.length > 0 && rows[0].values.length > 0) {
            const count = rows[0].values[0][0];
            this.setMeta('total_vulns', count.toString());
        }
    }
    clearAll() {
        if (!this.db)
            throw new Error('Database not initialized');
        this.db.run('BEGIN TRANSACTION');
        try {
            this.db.exec('DELETE FROM vulnerabilities');
            this.db.exec('DELETE FROM package_versions');
            this.db.run('COMMIT');
        }
        catch (e) {
            this.db.run('ROLLBACK');
            throw e;
        }
        this.updateCount();
        this.save();
    }
    save() {
        if (!this.db)
            return;
        const data = this.db.export();
        fs.writeFileSync(this.dbPath, Buffer.from(data));
    }
    close() {
        if (this.db) {
            this.save();
            this.db.close();
            this.db = null;
        }
    }
    getDbPath() {
        return this.dbPath;
    }
    isInitialized() {
        return this.initialized;
    }
}
exports.VulnDatabase = VulnDatabase;
function compareVersions(v1, v2) {
    const parts1 = v1.split(/[.\-+]/).map((p) => parseInt(p, 10) || p);
    const parts2 = v2.split(/[.\-+]/).map((p) => parseInt(p, 10) || p);
    for (let i = 0; i < Math.max(parts1.length, parts2.length); i++) {
        const p1 = parts1[i] ?? 0;
        const p2 = parts2[i] ?? 0;
        if (typeof p1 === 'number' && typeof p2 === 'number') {
            if (p1 < p2)
                return -1;
            if (p1 > p2)
                return 1;
        }
        else if (typeof p1 === 'number') {
            return 1;
        }
        else if (typeof p2 === 'number') {
            return -1;
        }
        else {
            const cmp = String(p1).localeCompare(String(p2));
            if (cmp !== 0)
                return cmp;
        }
    }
    return 0;
}
function isVersionAffected(version, affectedRange) {
    if (!affectedRange || affectedRange === '*')
        return true;
    const ranges = affectedRange.split(',').map((r) => r.trim());
    for (const range of ranges) {
        if (range.startsWith('>=')) {
            const target = range.slice(2);
            if (compareVersions(version, target) < 0)
                return false;
        }
        else if (range.startsWith('>')) {
            const target = range.slice(1);
            if (compareVersions(version, target) <= 0)
                return false;
        }
        else if (range.startsWith('<=')) {
            const target = range.slice(2);
            if (compareVersions(version, target) > 0)
                return false;
        }
        else if (range.startsWith('<')) {
            const target = range.slice(1);
            if (compareVersions(version, target) >= 0)
                return false;
        }
        else if (range.startsWith('=')) {
            const target = range.slice(1);
            if (compareVersions(version, target) !== 0)
                return false;
        }
        else {
            if (compareVersions(version, range) !== 0)
                return false;
        }
    }
    return true;
}
//# sourceMappingURL=database.js.map