#!/usr/bin/env node

import { Command } from 'commander';
import * as path from 'path';
import * as fs from 'fs';
import chalk from 'chalk';
import ora from 'ora';
import { table } from 'table';
import { extractImageArchive } from './image';
import { tempDir } from './utils/fs';
import { VulnDatabase, VulnDBUpdater } from './vulndb';
import { ScanEngine, LayerCache } from './scanner';
import { generateReport, ReportFormat } from './reporter';
import { DEFAULT_CACHE_DIR, DEFAULT_DB_PATH, SEVERITY_COLORS } from './constants';
import { ensureDir, fileExists } from './utils/fs';

const program = new Command();

program
  .name('dockerscan')
  .description('Docker镜像漏洞扫描CLI工具')
  .version('1.0.0');

interface GlobalOptions {
  dbPath?: string;
  cacheDir?: string;
  verbose?: boolean;
}

interface ScanOptions extends GlobalOptions {
  output?: string;
  format?: ReportFormat;
  noCache?: boolean;
  noRuntime?: boolean;
  severity?: string;
  fixableOnly?: boolean;
  failOn?: string;
  incremental?: boolean;
}

interface DBUpdateOptions extends GlobalOptions {
  apiKey?: string;
  startDate?: string;
  endDate?: string;
  seed?: boolean;
}

interface CacheOptions extends GlobalOptions {
  clear?: boolean;
  stats?: boolean;
}

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
  .option('--db-path <path>', '漏洞数据库路径', DEFAULT_DB_PATH)
  .option('--cache-dir <path>', '层缓存目录', DEFAULT_CACHE_DIR)
  .option('-v, --verbose', '显示详细日志')
  .action(async (imageArchive: string, options: ScanOptions) => {
    try {
      if (!fileExists(imageArchive)) {
        console.error(chalk.red(`错误: 镜像文件不存在: ${imageArchive}`));
        process.exit(1);
      }

      const dbPath = path.resolve(options.dbPath || DEFAULT_DB_PATH);
      const cacheDir = path.resolve(options.cacheDir || DEFAULT_CACHE_DIR);

      if (!fileExists(dbPath)) {
        console.log(chalk.yellow('⚠️  漏洞数据库不存在，正在初始化示例数据...'));
        const db = await VulnDatabase.create(dbPath);
        const updater = new VulnDBUpdater(db);
        await updater.seedSampleData();
        db.close();
        console.log(chalk.green('✅ 示例数据初始化完成'));
      }

      const db = await VulnDatabase.create(dbPath);
      const cache = new LayerCache(cacheDir);
      const extractDir = tempDir();

      const spinner = ora('正在解析镜像归档...').start();

      try {
        const extracted = await extractImageArchive(imageArchive, extractDir);
        spinner.succeed(`镜像解析完成，共 ${extracted.layerPaths.length} 层`);

        const scanEngine = new ScanEngine(db, cache, {
          useCache: options.noCache !== true,
          incremental: options.incremental !== false,
          onlyFixable: options.fixableOnly,
          severityFilter: options.severity ? [options.severity] : undefined,
          runtimeChecks: options.noRuntime === true ? {} : undefined,
        });

        const scanSpinner = ora('正在扫描...').start();
        let currentLayer = 0;

        scanEngine.on('progress', (progress: any) => {
          if (progress.type === 'layer_start') {
            currentLayer = (progress.layerIndex || 0) + 1;
            scanSpinner.text = `扫描层 ${currentLayer}/${extracted.layerPaths.length}...`;
          } else if (progress.type === 'cache_hit') {
            scanSpinner.text = `缓存命中层 ${currentLayer}/${extracted.layerPaths.length}`;
          } else if (progress.type === 'vuln_found') {
            scanSpinner.text = `层 ${currentLayer}: 发现 ${progress.vulnCount} 个漏洞`;
          }
        });

        const imageName = path.basename(imageArchive, path.extname(imageArchive));
        const result = await scanEngine.scan(imageName, extracted);

        scanSpinner.succeed('扫描完成');

        console.log('');
        console.log(chalk.bold('📊 扫描摘要:'));
        const summaryData = [
          [chalk.red('严重'), chalk.magenta('高危'), chalk.yellow('中危'), chalk.green('低危'), '可修复', '总计'],
          [
            chalk.red.bold(result.summary.critical),
            chalk.magenta.bold(result.summary.high),
            chalk.yellow.bold(result.summary.medium),
            chalk.green.bold(result.summary.low),
            chalk.blue.bold(result.summary.fixable),
            chalk.white.bold(result.summary.total),
          ],
        ];
        console.log(table(summaryData, {
          header: {
            alignment: 'center',
            content: '漏洞分布',
          },
        }));

        console.log('');
        console.log(`📦 镜像: ${chalk.cyan(result.imageName)}`);
        console.log(`📚 总层数: ${chalk.cyan(result.totalLayers)} (扫描: ${chalk.green(result.scannedLayers)}, 缓存: ${chalk.blue(result.cachedLayers)})`);
        console.log(`⏱️  扫描时间: ${chalk.cyan(result.scanTime)}`);

        const report = generateReport(result, {
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
          console.log(chalk.green(`✅ 报告已保存到: ${options.output}`));
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
              console.log(chalk.red(`❌ 检测到 ${options.failOn} 或更严重的漏洞，退出码: 1`));
              db.close();
              process.exit(1);
            }
          }
        }

        db.close();
      } finally {
        fs.rmSync(extractDir, { recursive: true, force: true });
      }
    } catch (error: any) {
      console.error(chalk.red(`❌ 扫描失败: ${error.message}`));
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
  .option('--db-path <path>', '漏洞数据库路径', DEFAULT_DB_PATH)
  .option('-v, --verbose', '显示详细日志')
  .action(async (options: DBUpdateOptions) => {
    try {
      const dbPath = path.resolve(options.dbPath || DEFAULT_DB_PATH);
      const db = await VulnDatabase.create(dbPath);
      const updater = new VulnDBUpdater(db, options.apiKey);

      if (options.seed) {
        const spinner = ora('正在初始化示例漏洞数据...').start();
        await updater.seedSampleData();
        spinner.succeed('示例数据初始化完成');
      } else {
        const spinner = ora('正在从NVD下载漏洞数据...').start();
        const result = await updater.updateFromNVD(options.startDate, options.endDate);
        spinner.succeed(`更新完成，新增 ${result.added} 个漏洞`);
      }

      const meta = db.getMetadata();
      console.log('');
      console.log(chalk.bold('📋 数据库信息:'));
      console.log(`  版本: ${meta.version}`);
      console.log(`  最后更新: ${meta.lastUpdate || '从未'}`);
      console.log(`  漏洞总数: ${meta.totalVulns}`);
      console.log(`  数据源: ${meta.source}`);

      db.close();
    } catch (error: any) {
      console.error(chalk.red(`❌ 更新失败: ${error.message}`));
      if (options.verbose) {
        console.error(error.stack);
      }
      process.exit(1);
    }
  });

dbCommand
  .command('info')
  .description('显示漏洞数据库信息')
  .option('--db-path <path>', '漏洞数据库路径', DEFAULT_DB_PATH)
  .action(async (options: GlobalOptions) => {
    try {
      const dbPath = path.resolve(options.dbPath || DEFAULT_DB_PATH);
      if (!fileExists(dbPath)) {
        console.log(chalk.yellow('⚠️  数据库不存在，路径: ' + dbPath));
        console.log('运行 "dockerscan db update --seed" 来初始化数据库');
        process.exit(0);
      }

      const db = await VulnDatabase.create(dbPath);
      const meta = db.getMetadata();

      console.log('');
      console.log(chalk.bold('📋 漏洞数据库信息:'));
      console.log('');
      const data = [
        [chalk.cyan('数据库路径'), dbPath],
        [chalk.cyan('版本'), meta.version],
        [chalk.cyan('最后更新'), meta.lastUpdate || '从未'],
        [chalk.cyan('漏洞总数'), meta.totalVulns.toString()],
        [chalk.cyan('数据源'), meta.source],
      ];
      console.log(table(data));

      const severities = ['Critical', 'High', 'Medium', 'Low', 'Unknown'];
      console.log('');
      console.log(chalk.bold('按严重性分布:'));
      for (const sev of severities) {
        const count = db.searchBySeverity(sev as any).length;
        const color = SEVERITY_COLORS[sev] || 'gray';
        const colorFn = (chalk as any)[color];
        console.log(`  ${colorFn ? colorFn(sev.padEnd(10)) : sev.padEnd(10)}: ${count}`);
      }

      db.close();
    } catch (error: any) {
      console.error(chalk.red(`❌ 失败: ${error.message}`));
      process.exit(1);
    }
  });

program
  .command('cache')
  .description('管理层缓存')
  .option('--clear', '清除所有缓存')
  .option('--stats', '显示缓存统计')
  .option('--cache-dir <path>', '层缓存目录', DEFAULT_CACHE_DIR)
  .action((options: CacheOptions) => {
    try {
      const cacheDir = path.resolve(options.cacheDir || DEFAULT_CACHE_DIR);
      const cache = new LayerCache(cacheDir);

      if (options.clear) {
        const spinner = ora('正在清除缓存...').start();
        cache.clear();
        spinner.succeed('缓存已清除');
      }

      if (options.stats || (!options.clear && !options.stats)) {
        const stats = cache.getStats();
        console.log('');
        console.log(chalk.bold('📊 缓存统计:'));
        console.log('');
        const data = [
          [chalk.cyan('缓存目录'), cacheDir],
          [chalk.cyan('内存缓存'), stats.memory.toString()],
          [chalk.cyan('磁盘缓存'), stats.disk.toString()],
          [chalk.cyan('总条目'), stats.total.toString()],
        ];
        console.log(table(data));
      }
    } catch (error: any) {
      console.error(chalk.red(`❌ 失败: ${error.message}`));
      process.exit(1);
    }
  });

program
  .command('version')
  .description('显示版本信息')
  .action(() => {
    console.log('');
    console.log(chalk.bold.cyan('🐳 DockerScan v1.0.0'));
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
  console.error(chalk.red(`❌ 错误: ${error.message}`));
  process.exit(1);
});
