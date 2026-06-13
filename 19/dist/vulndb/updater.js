"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.VulnDBUpdater = void 0;
const axios_1 = __importDefault(require("axios"));
const NVD_API_BASE = 'https://services.nvd.nist.gov/rest/json/cves/2.0';
class VulnDBUpdater {
    constructor(db, apiKey) {
        this.db = db;
        this.apiKey = apiKey;
    }
    async updateFromNVD(startDate, endDate) {
        let added = 0;
        let updated = 0;
        let startIndex = 0;
        const resultsPerPage = 2000;
        while (true) {
            const params = {
                startIndex,
                resultsPerPage,
            };
            if (startDate) {
                params.pubStartDate = startDate;
            }
            if (endDate) {
                params.pubEndDate = endDate;
            }
            const headers = {
                'Content-Type': 'application/json',
            };
            if (this.apiKey) {
                headers['apiKey'] = this.apiKey;
            }
            try {
                const response = await axios_1.default.get(NVD_API_BASE, {
                    params,
                    headers,
                    timeout: 60000,
                });
                const data = response.data;
                const vulns = data.vulnerabilities || [];
                if (vulns.length === 0)
                    break;
                const parsedVulns = this.parseNvdVulns(vulns);
                this.db.addVulnerabilities(parsedVulns);
                added += vulns.length;
                startIndex += vulns.length;
                if (startIndex >= data.totalResults)
                    break;
                await new Promise((resolve) => setTimeout(resolve, 1000));
            }
            catch (error) {
                if (error.response?.status === 403) {
                    throw new Error('NVD API rate limit exceeded, please use an API key');
                }
                throw error;
            }
        }
        this.db.setMeta('last_update', new Date().toISOString());
        this.db.setMeta('source', 'nvd');
        return { added, updated: 0 };
    }
    parseNvdVulns(nvdVulns) {
        const vulns = [];
        for (const nvdVuln of nvdVulns) {
            const cve = nvdVuln.cve;
            const id = cve.id;
            const descriptions = cve.descriptions || [];
            const description = descriptions.find((d) => d.lang === 'en')?.value || '';
            const metrics = cve.metrics || {};
            const cvssMetricV2 = metrics.cvssMetricV2?.[0];
            const cvssMetricV3 = metrics.cvssMetricV31?.[0] || metrics.cvssMetricV30?.[0];
            let cvssScore;
            let cvssVector;
            let severity = 'Unknown';
            if (cvssMetricV3) {
                cvssScore = cvssMetricV3.cvssData?.baseScore;
                cvssVector = cvssMetricV3.cvssData?.vectorString;
                severity = (cvssMetricV3.cvssData?.baseSeverity || 'Unknown');
            }
            else if (cvssMetricV2) {
                cvssScore = cvssMetricV2.cvssData?.baseScore;
                cvssVector = cvssMetricV2.cvssData?.vectorString;
                severity = this.severityFromScore(cvssScore || 0);
            }
            const cweIds = [];
            const weaknesses = cve.weaknesses || [];
            for (const w of weaknesses) {
                for (const desc of w.description || []) {
                    if (desc.lang === 'en' && desc.value.startsWith('CWE-')) {
                        cweIds.push(desc.value);
                    }
                }
            }
            const references = [];
            const refs = cve.references || [];
            for (const ref of refs) {
                if (ref.url) {
                    references.push(ref.url);
                }
            }
            const configs = cve.configurations || [];
            const affectedPackages = this.extractAffectedPackages(configs);
            if (affectedPackages.length === 0) {
                vulns.push({
                    id,
                    severity,
                    description,
                    packageName: '',
                    packageVersion: '',
                    cvssScore,
                    cvssVector,
                    cweIds,
                    references,
                    publishedDate: cve.published,
                    lastModifiedDate: cve.lastModified,
                });
            }
            else {
                for (const pkg of affectedPackages) {
                    vulns.push({
                        id,
                        severity,
                        description,
                        packageName: pkg.name,
                        packageVersion: pkg.version || '',
                        cvssScore,
                        cvssVector,
                        cweIds,
                        references,
                        publishedDate: cve.published,
                        lastModifiedDate: cve.lastModified,
                    });
                }
            }
        }
        return vulns;
    }
    extractAffectedPackages(configs) {
        const packages = [];
        for (const config of configs) {
            const nodes = config.nodes || [];
            for (const node of nodes) {
                const cpeMatches = node.cpeMatch || [];
                for (const match of cpeMatches) {
                    if (match.vulnerable && match.criteria) {
                        const cpeParts = match.criteria.split(':');
                        if (cpeParts.length >= 5) {
                            const product = cpeParts[4];
                            const version = cpeParts[5] !== '*' && cpeParts[5] !== '-' ? cpeParts[5] : undefined;
                            packages.push({ name: product, version });
                        }
                    }
                }
            }
        }
        return packages;
    }
    severityFromScore(score) {
        if (score >= 9)
            return 'Critical';
        if (score >= 7)
            return 'High';
        if (score >= 4)
            return 'Medium';
        if (score > 0)
            return 'Low';
        return 'Unknown';
    }
    async seedSampleData() {
        const sampleVulns = [
            {
                id: 'CVE-2024-0001',
                severity: 'Critical',
                description: 'Critical vulnerability in OpenSSL that allows remote code execution.',
                packageName: 'openssl',
                packageVersion: '<3.0.12',
                fixedVersion: '3.0.12',
                cvssScore: 9.8,
                cvssVector: 'CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H',
                cweIds: ['CWE-119'],
                references: ['https://www.openssl.org/news/secadv/'],
                publishedDate: '2024-01-01T00:00:00Z',
                lastModifiedDate: '2024-01-02T00:00:00Z',
            },
            {
                id: 'CVE-2024-0002',
                severity: 'High',
                description: 'High severity vulnerability in glibc affecting privilege escalation.',
                packageName: 'glibc',
                packageVersion: '<2.38',
                fixedVersion: '2.38',
                cvssScore: 7.8,
                cweIds: ['CWE-269'],
                references: ['https://sourceware.org/bugzilla/'],
                publishedDate: '2024-01-05T00:00:00Z',
                lastModifiedDate: '2024-01-06T00:00:00Z',
            },
            {
                id: 'CVE-2024-0003',
                severity: 'Medium',
                description: 'Medium severity issue in zlib with potential memory corruption.',
                packageName: 'zlib',
                packageVersion: '<1.3.1',
                fixedVersion: '1.3.1',
                cvssScore: 5.3,
                cweIds: ['CWE-190'],
                publishedDate: '2024-01-10T00:00:00Z',
            },
            {
                id: 'CVE-2024-0004',
                severity: 'Low',
                description: 'Low severity information disclosure in curl.',
                packageName: 'curl',
                packageVersion: '<8.5.0',
                fixedVersion: '8.5.0',
                cvssScore: 3.1,
                cweIds: ['CWE-200'],
                publishedDate: '2024-01-15T00:00:00Z',
            },
            {
                id: 'CVE-2024-0005',
                severity: 'Critical',
                description: 'Critical RCE vulnerability in bash.',
                packageName: 'bash',
                packageVersion: '<5.2.21',
                fixedVersion: '5.2.21',
                cvssScore: 10.0,
                cvssVector: 'CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:C/C:H/I:H/A:H',
                cweIds: ['CWE-78'],
                references: ['https://www.gnu.org/software/bash/'],
                publishedDate: '2024-01-20T00:00:00Z',
                lastModifiedDate: '2024-01-21T00:00:00Z',
            },
            {
                id: 'CVE-2024-0006',
                severity: 'High',
                description: 'High severity vulnerability in libxml2.',
                packageName: 'libxml2',
                packageVersion: '<2.11.6',
                fixedVersion: '2.11.6',
                cvssScore: 8.1,
                cweIds: ['CWE-611'],
                publishedDate: '2024-02-01T00:00:00Z',
            },
            {
                id: 'CVE-2024-0007',
                severity: 'High',
                description: 'SQL injection vulnerability in npm package pg.',
                packageName: 'pg',
                packageVersion: '<8.11.3',
                fixedVersion: '8.11.3',
                cvssScore: 7.5,
                cweIds: ['CWE-89'],
                publishedDate: '2024-02-10T00:00:00Z',
            },
            {
                id: 'CVE-2024-0008',
                severity: 'Medium',
                description: 'Prototype pollution in lodash.',
                packageName: 'lodash',
                packageVersion: '<4.17.21',
                fixedVersion: '4.17.21',
                cvssScore: 5.6,
                cweIds: ['CWE-1321'],
                publishedDate: '2024-02-15T00:00:00Z',
            },
            {
                id: 'CVE-2024-0009',
                severity: 'High',
                description: 'Remote code execution in Python pip.',
                packageName: 'pip',
                packageVersion: '<23.3.2',
                fixedVersion: '23.3.2',
                cvssScore: 7.5,
                cweIds: ['CWE-94'],
                publishedDate: '2024-02-20T00:00:00Z',
            },
            {
                id: 'CVE-2024-0010',
                severity: 'Critical',
                description: 'Critical vulnerability in log4j-style Java library.',
                packageName: 'log4j',
                packageVersion: '<2.17.1',
                fixedVersion: '2.17.1',
                cvssScore: 10.0,
                cvssVector: 'CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:C/C:H/I:H/A:H',
                cweIds: ['CWE-20', 'CWE-917'],
                references: ['https://logging.apache.org/log4j/'],
                publishedDate: '2024-03-01T00:00:00Z',
                lastModifiedDate: '2024-03-02T00:00:00Z',
            },
            {
                id: 'CVE-2024-0011',
                severity: 'Medium',
                description: 'Denial of service in busybox.',
                packageName: 'busybox',
                packageVersion: '<1.36.1',
                fixedVersion: '1.36.1',
                cvssScore: 5.9,
                cweIds: ['CWE-400'],
                publishedDate: '2024-03-10T00:00:00Z',
            },
            {
                id: 'CVE-2024-0012',
                severity: 'Low',
                description: 'Minor security issue in musl libc.',
                packageName: 'musl',
                packageVersion: '<1.2.5',
                fixedVersion: '1.2.5',
                cvssScore: 2.5,
                cweIds: ['CWE-200'],
                publishedDate: '2024-03-15T00:00:00Z',
            },
        ];
        this.db.addVulnerabilities(sampleVulns);
        this.db.setMeta('last_update', new Date().toISOString());
        this.db.setMeta('source', 'sample');
    }
}
exports.VulnDBUpdater = VulnDBUpdater;
//# sourceMappingURL=updater.js.map