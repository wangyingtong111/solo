#!/usr/bin/env node
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
const commander_1 = require("commander");
const path = __importStar(require("path"));
const fs = __importStar(require("fs"));
const chalk_1 = __importDefault(require("chalk"));
const ora_1 = __importDefault(require("ora"));
const table_1 = require("table");
const image_1 = require("./image");
const fs_1 = require("./utils/fs");
const vulndb_1 = require("./vulndb");
const scanner_1 = require("./scanner");
const reporter_1 = require("./reporter");
const constants_1 = require("./constants");
const fs_2 = require("./utils/fs");
const program = new commander_1.Command();
program
    .name('dockerscan')
    .description('Docker镜像漏洞扫描CLI工具')
    .version('1.0.0');
program
    .command('scan <image-archive>')
    .description('扫描Docker镜像归档文件的漏洞')
    .option('-o, --output <path>', '输出报告文件路径')
    .option('-f, --format <format>', '输出格式: json, html, jenkins, table', 'table')
    .option('--no-cache', '不使用层缓存')
    .option('--no-runtime', '不进行运行时风险检测')
    .option('-s, --severity <level>', '只显示指定严重性及以上: Critical, High, Medium, Low')
    .option('--fixable-only', '只显示可修复的漏洞')
    .option('--fail-on <level>', '检测到指定严重性及以上漏洞时退出码为1')
    .option('--incremental', '启用增量扫描模式', true)
    .option('--db-path <path>', '漏洞数据库路径', constants_1.DEFAULT_DB_PATH)
    .option('--cache-dir <path>', '层缓存目录', constants_1.DEFAULT_CACHE_DIR)
    .option('-v, --verbose', '显示详细日志')
    .action(async (imageArchive, options) => {
    try {
        if (!(0, fs_2.fileExists)(imageArchive)) {
            console.error(chalk_1.default.red(`错误: 镜像文件不存在: ${imageArchive}`));
            process.exit(1);
        }
        const dbPath = path.resolve(options.dbPath || constants_1.DEFAULT_DB_PATH);
        const cacheDir = path.resolve(options.cacheDir || constants_1.DEFAULT_CACHE_DIR);
        if (!(0, fs_2.fileExists)(dbPath)) {
            console.log(chalk_1.default.yellow('⚠️  漏洞数据库不存在，正在初始化示例数据...'));
            const db = await vulndb_1.VulnDatabase.create(dbPath);
            const updater = new vulndb_1.VulnDBUpdater(db);
            await updater.seedSampleData();
            db.close();
            console.log(chalk_1.default.green('✅ 示例数据初始化完成'));
        }
        const db = await vulndb_1.VulnDatabase.create(dbPath);
        const cache = new scanner_1.LayerCache(cacheDir);
        const extractDir = (0, fs_1.tempDir)();
        const spinner = (0, ora_1.default)('正在解析镜像归档...').start();
        try {
            const extracted = await (0, image_1.extractImageArchive)(imageArchive, extractDir);
            spinner.succeed(`镜像解析完成，共 ${extracted.layerPaths.length} 层`);
            const scanEngine = new scanner_1.ScanEngine(db, cache, {
                useCache: options.noCache !== true,
                incremental: options.incremental !== false,
                onlyFixable: options.fixableOnly,
                severityFilter: options.severity ? [options.severity] : undefined,
                runtimeChecks: options.noRuntime === true ? {} : undefined,
            });
            const scanSpinner = (0, ora_1.default)('正在扫描...').start();
            let currentLayer = 0;
            scanEngine.on('progress', (progress) => {
                if (progress.type === 'layer_start') {
                    currentLayer = (progress.layerIndex || 0) + 1;
                    scanSpinner.text = `扫描层 ${currentLayer}/${extracted.layerPaths.length}...`;
                }
                else if (progress.type === 'cache_hit') {
                    scanSpinner.text = `缓存命中层 ${currentLayer}/${extracted.layerPaths.length}`;
                }
                else if (progress.type === 'vuln_found') {
                    scanSpinner.text = `层 ${currentLayer}: 发现 ${progress.vulnCount} 个漏洞`;
                }
            });
            const imageName = path.basename(imageArchive, path.extname(imageArchive));
            const result = await scanEngine.scan(imageName, extracted);
            scanSpinner.succeed('扫描完成');
            console.log('');
            console.log(chalk_1.default.bold('📊 扫描摘要:'));
            const summaryData = [
                [chalk_1.default.red('严重'), chalk_1.default.magenta('高危'), chalk_1.default.yellow('中危'), chalk_1.default.green('低危'), '可修复', '总计'],
                [
                    chalk_1.default.red.bold(result.summary.critical),
                    chalk_1.default.magenta.bold(result.summary.high),
                    chalk_1.default.yellow.bold(result.summary.medium),
                    chalk_1.default.green.bold(result.summary.low),
                    chalk_1.default.blue.bold(result.summary.fixable),
                    chalk_1.default.white.bold(result.summary.total),
                ],
            ];
            console.log((0, table_1.table)(summaryData, {
                header: {
                    alignment: 'center',
                    content: '漏洞分布',
                },
            }));
            console.log('');
            console.log(`📦 镜像: ${chalk_1.default.cyan(result.imageName)}`);
            console.log(`📚 总层数: ${chalk_1.default.cyan(result.totalLayers)} (扫描: ${chalk_1.default.green(result.scannedLayers)}, 缓存: ${chalk_1.default.blue(result.cachedLayers)})`);
            console.log(`⏱️  扫描时间: ${chalk_1.default.cyan(result.scanTime)}`);
            const report = (0, reporter_1.generateReport)(result, {
                format: options.format || 'table',
                outputPath: options.output,
                minSeverity: options.severity,
                includeRemediation: true,
            });
            if (options.format === 'table' && !options.output) {
                console.log('');
                console.log(report);
            }
            if (options.output) {
                console.log('');
                console.log(chalk_1.default.green(`✅ 报告已保存到: ${options.output}`));
            }
            if (options.failOn) {
                const failLevels = ['Critical', 'High', 'Medium', 'Low', 'Unknown'];
                const failIndex = failLevels.indexOf(options.failOn);
                if (failIndex >= 0) {
                    const shouldFail = result.vulnerabilities.some((v) => {
                        const vulnIndex = failLevels.indexOf(v.severity);
                        return vulnIndex >= 0 && vulnIndex <= failIndex;
                    });
                    if (shouldFail) {
                        console.log('');
                        console.log(chalk_1.default.red(`❌ 检测到 ${options.failOn} 或更严重的漏洞，退出码: 1`));
                        db.close();
                        process.exit(1);
                    }
                }
            }
            db.close();
        }
        finally {
            fs.rmSync(extractDir, { recursive: true, force: true });
        }
    }
    catch (error) {
        console.error(chalk_1.default.red(`❌ 扫描失败: ${error.message}`));
        if (options.verbose) {
            console.error(error.stack);
        }
        process.exit(1);
    }
});
const dbCommand = program
    .command('db')
    .description('漏洞数据库管理');
dbCommand
    .command('update')
    .description('更新本地漏洞数据库')
    .option('--api-key <key>', 'NVD API 密钥')
    .option('--start-date <date>', '开始日期 (ISO格式)')
    .option('--end-date <date>', '结束日期 (ISO格式)')
    .option('--seed', '初始化示例漏洞数据')
    .option('--db-path <path>', '漏洞数据库路径', constants_1.DEFAULT_DB_PATH)
    .option('-v, --verbose', '显示详细日志')
    .action(async (options) => {
    try {
        const dbPath = path.resolve(options.dbPath || constants_1.DEFAULT_DB_PATH);
        const db = await vulndb_1.VulnDatabase.create(dbPath);
        const updater = new vulndb_1.VulnDBUpdater(db, options.apiKey);
        if (options.seed) {
            const spinner = (0, ora_1.default)('正在初始化示例漏洞数据...').start();
            await updater.seedSampleData();
            spinner.succeed('示例数据初始化完成');
        }
        else {
            const spinner = (0, ora_1.default)('正在从NVD下载漏洞数据...').start();
            const result = await updater.updateFromNVD(options.startDate, options.endDate);
            spinner.succeed(`更新完成，新增 ${result.added} 个漏洞`);
        }
        const meta = db.getMetadata();
        console.log('');
        console.log(chalk_1.default.bold('📋 数据库信息:'));
        console.log(`  版本: ${meta.version}`);
        console.log(`  最后更新: ${meta.lastUpdate || '从未'}`);
        console.log(`  漏洞总数: ${meta.totalVulns}`);
        console.log(`  数据源: ${meta.source}`);
        db.close();
    }
    catch (error) {
        console.error(chalk_1.default.red(`❌ 更新失败: ${error.message}`));
        if (options.verbose) {
            console.error(error.stack);
        }
        process.exit(1);
    }
});
dbCommand
    .command('info')
    .description('显示漏洞数据库信息')
    .option('--db-path <path>', '漏洞数据库路径', constants_1.DEFAULT_DB_PATH)
    .action(async (options) => {
    try {
        const dbPath = path.resolve(options.dbPath || constants_1.DEFAULT_DB_PATH);
        if (!(0, fs_2.fileExists)(dbPath)) {
            console.log(chalk_1.default.yellow('⚠️  数据库不存在，路径: ' + dbPath));
            console.log('运行 "dockerscan db update --seed" 来初始化数据库');
            process.exit(0);
        }
        const db = await vulndb_1.VulnDatabase.create(dbPath);
        const meta = db.getMetadata();
        console.log('');
        console.log(chalk_1.default.bold('📋 漏洞数据库信息:'));
        console.log('');
        const data = [
            [chalk_1.default.cyan('数据库路径'), dbPath],
            [chalk_1.default.cyan('版本'), meta.version],
            [chalk_1.default.cyan('最后更新'), meta.lastUpdate || '从未'],
            [chalk_1.default.cyan('漏洞总数'), meta.totalVulns.toString()],
            [chalk_1.default.cyan('数据源'), meta.source],
        ];
        console.log((0, table_1.table)(data));
        const severities = ['Critical', 'High', 'Medium', 'Low', 'Unknown'];
        console.log('');
        console.log(chalk_1.default.bold('按严重性分布:'));
        for (const sev of severities) {
            const count = db.searchBySeverity(sev).length;
            const color = constants_1.SEVERITY_COLORS[sev] || 'gray';
            const colorFn = chalk_1.default[color];
            console.log(`  ${colorFn ? colorFn(sev.padEnd(10)) : sev.padEnd(10)}: ${count}`);
        }
        db.close();
    }
    catch (error) {
        console.error(chalk_1.default.red(`❌ 失败: ${error.message}`));
        process.exit(1);
    }
});
program
    .command('cache')
    .description('管理层缓存')
    .option('--clear', '清除所有缓存')
    .option('--stats', '显示缓存统计')
    .option('--cache-dir <path>', '层缓存目录', constants_1.DEFAULT_CACHE_DIR)
    .action((options) => {
    try {
        const cacheDir = path.resolve(options.cacheDir || constants_1.DEFAULT_CACHE_DIR);
        const cache = new scanner_1.LayerCache(cacheDir);
        if (options.clear) {
            const spinner = (0, ora_1.default)('正在清除缓存...').start();
            cache.clear();
            spinner.succeed('缓存已清除');
        }
        if (options.stats || (!options.clear && !options.stats)) {
            const stats = cache.getStats();
            console.log('');
            console.log(chalk_1.default.bold('📊 缓存统计:'));
            console.log('');
            const data = [
                [chalk_1.default.cyan('缓存目录'), cacheDir],
                [chalk_1.default.cyan('内存缓存'), stats.memory.toString()],
                [chalk_1.default.cyan('磁盘缓存'), stats.disk.toString()],
                [chalk_1.default.cyan('总条目'), stats.total.toString()],
            ];
            console.log((0, table_1.table)(data));
        }
    }
    catch (error) {
        console.error(chalk_1.default.red(`❌ 失败: ${error.message}`));
        process.exit(1);
    }
});
program
    .command('version')
    .description('显示版本信息')
    .action(() => {
    console.log('');
    console.log(chalk_1.default.bold.cyan('🐳 DockerScan v1.0.0'));
    console.log('');
    console.log('Docker镜像漏洞扫描工具');
    console.log('特性:');
    console.log('  • 自定义Docker镜像解析 (manifest/config/layers)');
    console.log('  • 本地漏洞库 (SQLite, 支持离线更新)');
    console.log('  • 增量扫描 + 层缓存');
    console.log('  • 运行时风险检测 (用户/端口/挂载/密钥)');
    console.log('  • 多种输出格式 (JSON/HTML/Jenkins/Table)');
    console.log('  • CI/CD友好 (退出码控制)');
    console.log('  • 内存优化 (流式处理, 支持100+层大镜像)');
    console.log('');
});
program.parseAsync(process.argv).catch((error) => {
    console.error(chalk_1.default.red(`❌ 错误: ${error.message}`));
    process.exit(1);
});
//# sourceMappingURL=cli.js.map