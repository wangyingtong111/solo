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
exports.generateReport = generateReport;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const handlebars_1 = __importDefault(require("handlebars"));
const fs_1 = require("../utils/fs");
function generateReport(result, options) {
    let report = '';
    switch (options.format) {
        case 'json':
            report = generateJsonReport(result, options);
            break;
        case 'html':
            report = generateHtmlReport(result, options);
            break;
        case 'jenkins':
            report = generateJenkinsReport(result, options);
            break;
        case 'table':
            report = generateTableReport(result, options);
            break;
        default:
            throw new Error(`Unsupported report format: ${options.format}`);
    }
    if (options.outputPath) {
        (0, fs_1.ensureDir)(path.dirname(options.outputPath));
        fs.writeFileSync(options.outputPath, report, 'utf-8');
    }
    return report;
}
function generateJsonReport(result, options) {
    const filtered = filterBySeverity(result, options.minSeverity);
    return JSON.stringify(filtered, null, 2);
}
const HTML_TEMPLATE = `
<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>DockerScan - 漏洞扫描报告</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #f5f7fa; color: #333; padding: 20px; }
        .container { max-width: 1400px; margin: 0 auto; }
        .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 30px; border-radius: 10px; margin-bottom: 20px; }
        .header h1 { font-size: 28px; margin-bottom: 10px; }
        .header .meta { opacity: 0.9; font-size: 14px; }
        .summary { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 15px; margin-bottom: 30px; }
        .stat-card { background: white; padding: 20px; border-radius: 10px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); text-align: center; }
        .stat-card .label { font-size: 14px; color: #666; margin-bottom: 5px; }
        .stat-card .value { font-size: 32px; font-weight: bold; }
        .critical .value { color: #dc2626; }
        .high .value { color: #dc267b; }
        .medium .value { color: #d97706; }
        .low .value { color: #059669; }
        .unknown .value { color: #6b7280; }
        .section { background: white; border-radius: 10px; padding: 25px; margin-bottom: 20px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
        .section h2 { font-size: 20px; margin-bottom: 20px; color: #1f2937; border-bottom: 2px solid #e5e7eb; padding-bottom: 10px; }
        .vuln-table { width: 100%; border-collapse: collapse; }
        .vuln-table th, .vuln-table td { padding: 12px; text-align: left; border-bottom: 1px solid #e5e7eb; }
        .vuln-table th { background: #f9fafb; font-weight: 600; color: #374151; }
        .vuln-table tr:hover { background: #f9fafb; }
        .severity-badge { display: inline-block; padding: 4px 12px; border-radius: 20px; font-size: 12px; font-weight: 600; color: white; }
        .severity-Critical { background: #dc2626; }
        .severity-High { background: #dc267b; }
        .severity-Medium { background: #d97706; }
        .severity-Low { background: #059669; }
        .severity-Unknown { background: #6b7280; }
        .cvss-score { font-weight: 600; font-family: monospace; }
        .remediation { background: #fef3c7; border-left: 4px solid #f59e0b; padding: 12px; margin-top: 10px; border-radius: 4px; }
        .risk-card { border: 1px solid #e5e7eb; border-radius: 8px; padding: 15px; margin-bottom: 10px; }
        .risk-card .risk-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px; }
        .risk-card .risk-title { font-weight: 600; color: #1f2937; }
        .risk-card .risk-category { font-size: 12px; color: #6b7280; background: #f3f4f6; padding: 2px 8px; border-radius: 4px; }
        .risk-card .risk-description { color: #4b5563; font-size: 14px; margin-bottom: 10px; line-height: 1.5; }
        .risk-card .risk-evidence { font-family: monospace; background: #f3f4f6; padding: 8px; border-radius: 4px; font-size: 12px; color: #374151; margin-bottom: 10px; }
        .risk-card .risk-remediation { background: #ecfdf5; border-left: 3px solid #10b981; padding: 10px; border-radius: 4px; font-size: 14px; color: #065f46; }
        .progress-bar { display: flex; height: 8px; border-radius: 4px; overflow: hidden; margin-top: 15px; }
        .progress-segment { height: 100%; }
        .footer { text-align: center; color: #9ca3af; font-size: 12px; margin-top: 30px; padding: 20px; }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>🐳 DockerScan 漏洞扫描报告</h1>
            <div class="meta">
                <strong>镜像:</strong> {{imageName}} | 
                <strong>扫描时间:</strong> {{scanTime}} | 
                <strong>总层数:</strong> {{totalLayers}} (已缓存: {{cachedLayers}})
            </div>
        </div>

        <div class="summary">
            <div class="stat-card critical">
                <div class="label">严重 (Critical)</div>
                <div class="value">{{summary.critical}}</div>
            </div>
            <div class="stat-card high">
                <div class="label">高危 (High)</div>
                <div class="value">{{summary.high}}</div>
            </div>
            <div class="stat-card medium">
                <div class="label">中危 (Medium)</div>
                <div class="value">{{summary.medium}}</div>
            </div>
            <div class="stat-card low">
                <div class="label">低危 (Low)</div>
                <div class="value">{{summary.low}}</div>
            </div>
            <div class="stat-card">
                <div class="label">可修复</div>
                <div class="value" style="color: #2563eb;">{{summary.fixable}}</div>
            </div>
            <div class="stat-card">
                <div class="label">总计</div>
                <div class="value" style="color: #1f2937;">{{summary.total}}</div>
            </div>
        </div>

        <div class="section">
            <h2>🔒 漏洞严重性分布</h2>
            <div class="progress-bar">
                {{#if summary.critical}}<div class="progress-segment severity-Critical" style="width: {{criticalPercent}}%"></div>{{/if}}
                {{#if summary.high}}<div class="progress-segment severity-High" style="width: {{highPercent}}%"></div>{{/if}}
                {{#if summary.medium}}<div class="progress-segment severity-Medium" style="width: {{mediumPercent}}%"></div>{{/if}}
                {{#if summary.low}}<div class="progress-segment severity-Low" style="width: {{lowPercent}}%"></div>{{/if}}
                {{#if summary.unknown}}<div class="progress-segment severity-Unknown" style="width: {{unknownPercent}}%"></div>{{/if}}
            </div>
        </div>

        {{#if vulnerabilities}}
        <div class="section">
            <h2>🐛 发现的漏洞 ({{vulnerabilities.length}})</h2>
            <table class="vuln-table">
                <thead>
                    <tr>
                        <th>严重性</th>
                        <th>CVE ID</th>
                        <th>软件包</th>
                        <th>版本</th>
                        <th>CVSS</th>
                        <th>描述</th>
                        <th>修复版本</th>
                    </tr>
                </thead>
                <tbody>
                    {{#each vulnerabilities}}
                    <tr>
                        <td><span class="severity-badge severity-{{severity}}">{{severity}}</span></td>
                        <td><code>{{id}}</code></td>
                        <td><strong>{{packageName}}</strong></td>
                        <td><code>{{packageVersion}}</code></td>
                        <td><span class="cvss-score">{{#if cvssScore}}{{cvssScore}}{{else}}N/A{{/if}}</span></td>
                        <td style="max-width: 300px;">{{description}}</td>
                        <td>
                            {{#if fixedVersion}}
                            <span style="color: #059669; font-weight: 600;">{{fixedVersion}}</span>
                            {{else}}
                            <span style="color: #9ca3af;">暂无</span>
                            {{/if}}
                        </td>
                    </tr>
                    {{/each}}
                </tbody>
            </table>
        </div>
        {{/if}}

        {{#if runtimeRisks}}
        <div class="section">
            <h2>⚠️ 运行时风险 ({{runtimeRisks.length}})</h2>
            {{#each runtimeRisks}}
            <div class="risk-card">
                <div class="risk-header">
                    <span class="severity-badge severity-{{severity}}">{{severity}}</span>
                    <span class="risk-category">{{category}}</span>
                </div>
                <div class="risk-title">{{title}}</div>
                <div class="risk-description">{{description}}</div>
                <div class="risk-evidence"><strong>证据:</strong> {{evidence}}</div>
                <div class="risk-remediation"><strong>修复建议:</strong> {{remediation}}</div>
            </div>
            {{/each}}
        </div>
        {{/if}}

        <div class="footer">
            由 DockerScan v1.0.0 生成 | {{scanTime}}
        </div>
    </div>
</body>
</html>
`;
function generateHtmlReport(result, options) {
    const filtered = filterBySeverity(result, options.minSeverity);
    const template = handlebars_1.default.compile(HTML_TEMPLATE);
    const total = filtered.summary.total || 1;
    const data = {
        ...filtered,
        criticalPercent: (filtered.summary.critical / total) * 100,
        highPercent: (filtered.summary.high / total) * 100,
        mediumPercent: (filtered.summary.medium / total) * 100,
        lowPercent: (filtered.summary.low / total) * 100,
        unknownPercent: (filtered.summary.unknown / total) * 100,
    };
    return template(data);
}
function generateJenkinsReport(result, options) {
    const filtered = filterBySeverity(result, options.minSeverity);
    const jenkinsIssues = [
        ...filtered.vulnerabilities.map((v) => ({
            type: 'VULNERABILITY',
            severity: v.severity.toUpperCase(),
            message: `${v.id}: ${v.packageName}@${v.packageVersion} - ${v.description}`,
            fileName: 'Dockerfile',
            packageName: v.packageName,
            version: v.packageVersion,
            cve: v.id,
            cvss: v.cvssScore,
            fixVersion: v.fixedVersion,
            category: 'Vulnerability',
        })),
        ...filtered.runtimeRisks.map((r) => ({
            type: 'CONFIGURATION',
            severity: r.severity.toUpperCase(),
            message: r.title,
            fileName: 'Dockerfile',
            category: r.category,
            description: r.description,
            evidence: r.evidence,
            remediation: r.remediation,
        })),
    ];
    const jenkinsReport = {
        _class: 'io.jenkins.plugins.analysis.core.model.AnalysisResult',
        id: 'dockerscan',
        name: 'DockerScan Vulnerability Scan',
        description: 'Docker image vulnerability and configuration risk scan',
        size: jenkinsIssues.length,
        totalSize: jenkinsIssues.length,
        fixedSize: 0,
        outstandingSize: jenkinsIssues.length,
        newSize: 0,
        delta: 0,
        referenceBuild: '',
        issues: jenkinsIssues.map((issue, idx) => ({
            _class: 'io.jenkins.plugins.analysis.core.model.Issue',
            key: `dockerscan-${idx}`,
            origin: 'dockerscan',
            severity: issue.severity,
            message: issue.message,
            fileName: issue.fileName,
            packageName: issue.packageName || '',
            version: issue.version || '',
            category: issue.category,
            type: issue.type,
            lineStart: 0,
            lineEnd: 0,
            columnStart: 0,
            columnEnd: 0,
            fingerprint: Buffer.from(issue.message).toString('base64').slice(0, 32),
            additionalProperties: {
                cve: issue.cve || '',
                cvss: issue.cvss || 0,
                fixVersion: issue.fixVersion || '',
                description: issue.description || '',
                evidence: issue.evidence || '',
                remediation: issue.remediation || '',
            },
        })),
        sizePerSeverity: {
            CRITICAL: filtered.summary.critical,
            HIGH: filtered.summary.high,
            MEDIUM: filtered.summary.medium,
            LOW: filtered.summary.low,
            UNKNOWN: filtered.summary.unknown,
        },
        statistics: {
            critical: filtered.summary.critical,
            high: filtered.summary.high,
            medium: filtered.summary.medium,
            low: filtered.summary.low,
            unknown: filtered.summary.unknown,
            total: filtered.summary.total,
            fixable: filtered.summary.fixable,
        },
    };
    return JSON.stringify(jenkinsReport, null, 2);
}
function generateTableReport(result, options) {
    const filtered = filterBySeverity(result, options.minSeverity);
    const lines = [];
    lines.push('╔══════════════════════════════════════════════════════════════════════════╗');
    lines.push('║                     DockerScan 漏洞扫描报告                             ║');
    lines.push('╚══════════════════════════════════════════════════════════════════════════╝');
    lines.push('');
    lines.push(`镜像: ${filtered.imageName}`);
    lines.push(`扫描时间: ${filtered.scanTime}`);
    lines.push(`总层数: ${filtered.totalLayers} (扫描: ${filtered.scannedLayers}, 缓存: ${filtered.cachedLayers})`);
    lines.push('');
    lines.push('┌──────────┬──────────┬──────────┬──────────┬──────────┬──────────┬──────────┐');
    lines.push('│ 严重     │ 高危     │ 中危     │ 低危     │ 未知     │ 可修复   │ 总计     │');
    lines.push('├──────────┼──────────┼──────────┼──────────┼──────────┼──────────┼──────────┤');
    lines.push(`│ ${filtered.summary.critical.toString().padEnd(8)} │ ${filtered.summary.high.toString().padEnd(8)} │ ${filtered.summary.medium.toString().padEnd(8)} │ ${filtered.summary.low.toString().padEnd(8)} │ ${filtered.summary.unknown.toString().padEnd(8)} │ ${filtered.summary.fixable.toString().padEnd(8)} │ ${filtered.summary.total.toString().padEnd(8)} │`);
    lines.push('└──────────┴──────────┴──────────┴──────────┴──────────┴──────────┴──────────┘');
    lines.push('');
    if (filtered.vulnerabilities.length > 0) {
        lines.push('『漏洞列表』');
        lines.push('─'.repeat(100));
        lines.push(`${'严重性'.padEnd(10)} ${'CVE ID'.padEnd(18)} ${'软件包'.padEnd(20)} ${'版本'.padEnd(15)} ${'CVSS'.padEnd(6)} 描述`);
        lines.push('─'.repeat(100));
        for (const vuln of filtered.vulnerabilities.slice(0, 50)) {
            const desc = vuln.description.length > 30 ? vuln.description.slice(0, 27) + '...' : vuln.description;
            lines.push(`${vuln.severity.padEnd(10)} ${vuln.id.padEnd(18)} ${vuln.packageName.padEnd(20)} ${(vuln.packageVersion || '').padEnd(15)} ${(vuln.cvssScore?.toString() || 'N/A').padEnd(6)} ${desc}`);
        }
        if (filtered.vulnerabilities.length > 50) {
            lines.push(`... 还有 ${filtered.vulnerabilities.length - 50} 个漏洞`);
        }
        lines.push('');
    }
    if (filtered.runtimeRisks.length > 0) {
        lines.push('『运行时风险』');
        lines.push('─'.repeat(100));
        lines.push(`${'严重性'.padEnd(10)} ${'类别'.padEnd(20)} ${'标题'.padEnd(30)} 描述`);
        lines.push('─'.repeat(100));
        for (const risk of filtered.runtimeRisks.slice(0, 30)) {
            const desc = risk.description.length > 35 ? risk.description.slice(0, 32) + '...' : risk.description;
            lines.push(`${risk.severity.padEnd(10)} ${risk.category.padEnd(20)} ${risk.title.padEnd(30)} ${desc}`);
        }
        if (filtered.runtimeRisks.length > 30) {
            lines.push(`... 还有 ${filtered.runtimeRisks.length - 30} 个风险`);
        }
        lines.push('');
    }
    if (options.includeRemediation && filtered.vulnerabilities.length > 0) {
        lines.push('『修复建议』');
        lines.push('─'.repeat(100));
        const fixable = filtered.vulnerabilities.filter((v) => v.fixedVersion);
        for (const vuln of fixable.slice(0, 20)) {
            lines.push(`• ${vuln.packageName}: ${vuln.packageVersion} → ${vuln.fixedVersion}`);
        }
    }
    return lines.join('\n');
}
function filterBySeverity(result, minSeverity) {
    if (!minSeverity)
        return result;
    const severityRank = ['Critical', 'High', 'Medium', 'Low', 'Unknown'];
    const minRank = severityRank.indexOf(minSeverity);
    if (minRank === -1)
        return result;
    const filteredVulns = result.vulnerabilities.filter((v) => severityRank.indexOf(v.severity) <= minRank);
    const filteredRisks = result.runtimeRisks.filter((r) => severityRank.indexOf(r.severity) <= minRank);
    return {
        ...result,
        vulnerabilities: filteredVulns,
        runtimeRisks: filteredRisks,
        summary: {
            ...result.summary,
            total: filteredVulns.length,
        },
    };
}
//# sourceMappingURL=index.js.map