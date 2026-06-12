import { useState } from 'react';
import ReactECharts from 'echarts-for-react';
import type { EChartsOption } from 'echarts';
import {
  Download,
  FileSpreadsheet,
  BarChart3,
  CalendarDays,
  BatteryCharging,
  TrendingDown,
  Activity,
  Check,
  Loader2
} from 'lucide-react';
import { useBmsStore } from '@/store/bmsStore';
import type { ReportConfig } from '@/types';
import { cn } from '@/lib/utils';
import { saveAs } from 'file-saver';

type ReportType = 'SOH' | 'BALANCE' | 'DECAY';
type ExportFormat = 'xlsx' | 'csv';

interface CardConfig {
  startDate: string;
  includeConfidence: boolean;
  format: ExportFormat;
}

const todayStr = () => {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
};

const agoStr = (days: number) => {
  const d = new Date();
  d.setDate(d.getDate() - days);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
};

const sohPreviewOption = (): EChartsOption => ({
  backgroundColor: 'transparent',
  grid: { left: 2, right: 2, top: 10, bottom: 2 },
  xAxis: { type: 'category', show: false, data: Array.from({ length: 30 }, (_, i) => i) },
  yAxis: { type: 'value', show: false, min: 80, max: 100 },
  series: [
    {
      type: 'line',
      smooth: true,
      symbol: 'none',
      data: Array.from({ length: 30 }, (_, i) => 98 - i * 0.4 + Math.sin(i / 3) * 0.5),
      lineStyle: { color: '#00e676', width: 2, shadowColor: '#00e676', shadowBlur: 6 },
      areaStyle: { color: 'rgba(0,230,118,0.15)' },
    },
  ],
});

const balancePreviewOption = (): EChartsOption => ({
  backgroundColor: 'transparent',
  grid: { left: 2, right: 2, top: 10, bottom: 2 },
  xAxis: { type: 'category', show: false, data: Array.from({ length: 30 }, (_, i) => i) },
  yAxis: { type: 'value', show: false },
  series: [
    {
      type: 'bar',
      data: Array.from({ length: 30 }, (_, i) => Math.max(0.001, 0.05 * Math.exp(-i / 8) + Math.random() * 0.003)),
      itemStyle: {
        color: (p: { dataIndex: number }) => {
          const c = p.dataIndex / 30;
          return `rgb(${Math.round(255 - c * 200)}, ${Math.round(80 + c * 150)}, 100)`;
        },
        borderRadius: [2, 2, 0, 0],
      },
      barWidth: '60%',
    },
  ],
});

const decayPreviewOption = (): EChartsOption => ({
  backgroundColor: 'transparent',
  grid: { left: 2, right: 2, top: 10, bottom: 2 },
  xAxis: { type: 'category', show: false, data: Array.from({ length: 50 }, (_, i) => i) },
  yAxis: { type: 'value', show: false },
  series: [
    {
      type: 'line',
      smooth: true,
      symbol: 'none',
      data: Array.from({ length: 50 }, (_, i) => {
        const mean = 280 - (i / 50) * 40;
        return mean + Math.sin(i / 5) * 1.5;
      }),
      lineStyle: { color: '#00f0ff', width: 2, shadowColor: '#00f0ff', shadowBlur: 6 },
    },
    {
      type: 'line',
      smooth: true,
      symbol: 'none',
      data: Array.from({ length: 50 }, (_, i) => {
        const mean = 280 - (i / 50) * 40;
        return mean + 4 + Math.sin(i / 5) * 1;
      }),
      lineStyle: { opacity: 0 },
      stack: 'ci',
      areaStyle: { color: 'rgba(0,240,255,0.12)' },
    },
    {
      type: 'line',
      smooth: true,
      symbol: 'none',
      data: Array.from({ length: 50 }, (_, i) => {
        const mean = 280 - (i / 50) * 40;
        return -mean - 4 - Math.sin(i / 5) * 1;
      }),
      lineStyle: { opacity: 0 },
      stack: 'ci',
    },
  ],
});

interface ReportCardProps {
  type: ReportType;
  title: string;
  description: string;
  icon: React.ReactNode;
  accentColor: string;
  previewOption: EChartsOption;
  config: CardConfig;
  onConfigChange: (patch: Partial<CardConfig>) => void;
  onExport: () => void;
  isExporting: boolean;
}

function ReportCard({
  type,
  title,
  description,
  icon,
  accentColor,
  previewOption,
  config,
  onConfigChange,
  onExport,
  isExporting,
}: ReportCardProps) {
  const styleVars = { '--accent': accentColor } as React.CSSProperties;

  return (
    <div
      style={styleVars}
      className={cn(
        'group relative rounded-xl border p-5 bg-bms-panel/40 backdrop-blur-sm',
        'transition-all duration-300 hover:-translate-y-1',
        'overflow-hidden',
      )}
      onMouseEnter={e => {
        e.currentTarget.style.borderColor = accentColor;
        e.currentTarget.style.boxShadow = `0 0 24px ${accentColor}25, 0 8px 32px rgba(0,0,0,0.4)`;
      }}
      onMouseLeave={e => {
        e.currentTarget.style.borderColor = '';
        e.currentTarget.style.boxShadow = '';
      }}
    >
      <div
        className="absolute inset-0 opacity-10 pointer-events-none"
        style={{
          background: `radial-gradient(circle at 20% 0%, ${accentColor} 0%, transparent 60%)`,
        }}
      />

      <div className="relative flex items-start justify-between mb-4">
        <div className="flex items-center gap-3">
          <div
            className="w-11 h-11 rounded-lg flex items-center justify-center border"
            style={{
              backgroundColor: `${accentColor}15`,
              borderColor: `${accentColor}50`,
              color: accentColor,
              boxShadow: `0 0 12px ${accentColor}30`,
            }}
          >
            {icon}
          </div>
          <div>
            <h3 className="font-bold text-base text-bms-text" style={{ textShadow: `0 0 8px ${accentColor}30` }}>
              {title}
            </h3>
            <span className="text-[10px] font-mono uppercase tracking-wider" style={{ color: accentColor, opacity: 0.8 }}>
              Report · {type}
            </span>
          </div>
        </div>
        <FileSpreadsheet size={18} className="text-bms-textDim opacity-40 group-hover:opacity-80 transition-opacity" />
      </div>

      <div
        className="relative rounded-lg border mb-4 h-24 overflow-hidden"
        style={{ borderColor: `${accentColor}30`, backgroundColor: `${accentColor}06` }}
      >
        <ReactECharts option={previewOption} style={{ height: '100%', width: '100%' }} notMerge={true} />
        <div className="absolute bottom-1 right-2 text-[9px] font-mono text-bms-textDim opacity-60">PREVIEW</div>
      </div>

      <p className="text-xs text-bms-textDim leading-relaxed mb-4 min-h-[32px]">
        {description}
      </p>

      <div className="space-y-3 p-3 rounded-lg bg-bms-bg/60 border border-bms-border/50 mb-4">
        <div>
          <label className="flex items-center gap-1.5 text-[11px] font-mono text-bms-textDim mb-1.5">
            <CalendarDays size={12} />
            开始日期
          </label>
          <input
            type="date"
            value={config.startDate}
            onChange={e => onConfigChange({ startDate: e.target.value })}
            className="w-full bg-bms-panel border border-bms-border rounded px-2 py-1.5 text-xs font-mono text-bms-text focus:outline-none transition-colors"
            onFocus={e => { e.target.style.borderColor = accentColor; }}
            onBlur={e => { e.target.style.borderColor = ''; }}
          />
        </div>

        <label className="flex items-center justify-between cursor-pointer select-none group/cb">
          <span className="text-[11px] font-mono text-bms-textDim">包含95%置信区间</span>
          <div className="relative">
            <input
              type="checkbox"
              checked={config.includeConfidence}
              onChange={e => onConfigChange({ includeConfidence: e.target.checked })}
              className="sr-only peer"
            />
            <div
              className={cn(
                'w-9 h-5 rounded-full border transition-all duration-200 relative',
                config.includeConfidence
                  ? 'bg-bms-ok/20 border-bms-ok'
                  : 'bg-bms-panel border-bms-border group-hover/cb:border-bms-textDim'
              )}
            >
              <div
                className={cn(
                  'absolute top-0.5 w-3.5 h-3.5 rounded-full transition-all duration-200 flex items-center justify-center',
                  config.includeConfidence
                    ? 'left-[18px] bg-bms-ok shadow-glow-green'
                    : 'left-0.5 bg-bms-textDim'
                )}
              >
                {config.includeConfidence && <Check size={9} className="text-bms-bg" />}
              </div>
            </div>
          </div>
        </label>

        <div>
          <span className="text-[11px] font-mono text-bms-textDim block mb-1.5">导出格式</span>
          <div className="flex gap-2">
            {(['xlsx', 'csv'] as ExportFormat[]).map(fmt => (
              <button
                key={fmt}
                onClick={() => onConfigChange({ format: fmt })}
                className={cn(
                  'flex-1 py-1.5 rounded text-[11px] font-mono font-bold uppercase border transition-all duration-200',
                  config.format === fmt
                    ? 'text-bms-bg border-transparent shadow-glow-cyan'
                    : 'border-bms-border bg-bms-panel text-bms-textDim hover:border-bms-textDim'
                )}
                style={
                  config.format === fmt
                    ? { backgroundColor: accentColor, boxShadow: `0 0 12px ${accentColor}60` }
                    : {}
                }
              >
                {fmt}
              </button>
            ))}
          </div>
        </div>
      </div>

      <button
        onClick={onExport}
        disabled={isExporting}
        className={cn(
          'w-full py-2.5 rounded-lg font-bold text-sm flex items-center justify-center gap-2 border transition-all duration-200',
          'disabled:opacity-50 disabled:cursor-not-allowed',
          'text-bms-bg font-mono'
        )}
        style={{
          backgroundColor: accentColor,
          borderColor: accentColor,
          boxShadow: isExporting ? 'none' : `0 0 16px ${accentColor}50`,
        }}
        onMouseEnter={e => {
          if (!isExporting) e.currentTarget.style.boxShadow = `0 0 28px ${accentColor}80`;
        }}
        onMouseLeave={e => {
          if (!isExporting) e.currentTarget.style.boxShadow = `0 0 16px ${accentColor}50`;
        }}
      >
        {isExporting ? (
          <>
            <Loader2 size={16} className="animate-spin" />
            生成中...
          </>
        ) : (
          <>
            <Download size={16} />
            导出 {config.format.toUpperCase()}
          </>
        )}
      </button>
    </div>
  );
}

export default function ReportPanel() {
  const { generateReport } = useBmsStore();

  const [configs, setConfigs] = useState<Record<ReportType, CardConfig>>({
    SOH: { startDate: agoStr(30), includeConfidence: true, format: 'xlsx' },
    BALANCE: { startDate: agoStr(7), includeConfidence: false, format: 'xlsx' },
    DECAY: { startDate: agoStr(90), includeConfidence: true, format: 'xlsx' },
  });

  const [exportingType, setExportingType] = useState<ReportType | null>(null);

  const updateConfig = (type: ReportType, patch: Partial<CardConfig>) => {
    setConfigs(prev => ({ ...prev, [type]: { ...prev[type], ...patch } }));
  };

  const handleExport = async (type: ReportType) => {
    const cfg = configs[type];
    const start = new Date(cfg.startDate).getTime();
    const end = Date.now();

    const reportConfig: ReportConfig = {
      type,
      startDate: start,
      endDate: end,
      includeConfidence: cfg.includeConfidence,
      format: cfg.format,
    };

    setExportingType(type);
    try {
      const blob = await generateReport(reportConfig);
      const ext = cfg.format;
      const datePart = todayStr().replace(/-/g, '');
      const filename = `report_${type.toLowerCase()}_${datePart}.${ext}`;
      saveAs(blob, filename);
    } catch (err) {
      console.error('Export failed:', err);
    } finally {
      setTimeout(() => setExportingType(null), 400);
    }
  };

  const cards: Omit<ReportCardProps, 'config' | 'onConfigChange' | 'onExport' | 'isExporting'>[] = [
    {
      type: 'SOH',
      title: 'SOH报表',
      description: '分析各电芯健康状态(SOH)估计值、95%置信区间边界及估算误差统计，评估电池包老化一致性。',
      icon: <Activity size={22} strokeWidth={2} />,
      accentColor: '#00e676',
      previewOption: sohPreviewOption(),
    },
    {
      type: 'BALANCE',
      title: '均衡效果报表',
      description: '统计主动均衡前后各电芯压差变化、收敛速率及能量消耗，评估均衡系统效率与性能。',
      icon: <BatteryCharging size={22} strokeWidth={2} />,
      accentColor: '#ff8c00',
      previewOption: balancePreviewOption(),
    },
    {
      type: 'DECAY',
      title: '容量衰减趋势报表',
      description: '预测容量衰减长期趋势，包含95%置信区间与剩余使用寿命(RUL)预测，辅助运维决策。',
      icon: <TrendingDown size={22} strokeWidth={2} />,
      accentColor: '#00f0ff',
      previewOption: decayPreviewOption(),
    },
  ];

  return (
    <div className="h-full w-full bg-bms-bg text-bms-text p-6 overflow-auto">
      <div className="max-w-7xl mx-auto">
        <div className="mb-8 flex items-end justify-between flex-wrap gap-4">
          <div>
            <div className="flex items-center gap-3 mb-2">
              <BarChart3 size={28} className="text-bms-accent" />
              <h1 className="text-2xl font-bold tracking-tight">
                报表<span className="text-bms-accent">导出中心</span>
              </h1>
            </div>
            <p className="text-sm text-bms-textDim font-mono">
              生成BMS数据导出报表 · 支持 xlsx / csv 格式 · 含95%置信区间
            </p>
          </div>

          <div className="flex items-center gap-2 px-4 py-2 rounded-lg border border-bms-border bg-bms-panel/60">
            <div className="w-2 h-2 rounded-full bg-bms-ok animate-pulse shadow-glow-green" />
            <span className="text-xs font-mono text-bms-textDim">引擎就绪 · 模拟数据模式</span>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {cards.map(card => (
            <ReportCard
              key={card.type}
              {...card}
              config={configs[card.type]}
              onConfigChange={patch => updateConfig(card.type, patch)}
              onExport={() => handleExport(card.type)}
              isExporting={exportingType === card.type}
            />
          ))}
        </div>

        <div className="mt-10 p-5 rounded-xl border border-bms-border bg-bms-panel/30 backdrop-blur">
          <h4 className="text-sm font-bold text-bms-text mb-3 flex items-center gap-2">
            <FileSpreadsheet size={14} className="text-bms-accent" />
            报表字段说明
          </h4>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 text-xs">
            <div>
              <div className="text-bms-ok font-bold font-mono mb-2">SOH报表</div>
              <ul className="space-y-1 text-bms-textDim font-mono">
                <li>• cellId — 电芯编号</li>
                <li>• SOH估计 — 健康度估算值(%)</li>
                <li>• 置信下界/上界 — 95%区间</li>
                <li>• 误差 — 估计值残差</li>
              </ul>
            </div>
            <div>
              <div className="text-bms-warn font-bold font-mono mb-2">均衡报表</div>
              <ul className="space-y-1 text-bms-textDim font-mono">
                <li>• cellId — 电芯编号</li>
                <li>• 均衡前/后压差 — (V)</li>
                <li>• 收敛时间 — 分钟</li>
                <li>• 能量消耗 — (Wh)</li>
              </ul>
            </div>
            <div>
              <div className="text-bms-accent font-bold font-mono mb-2">衰减报表</div>
              <ul className="space-y-1 text-bms-textDim font-mono">
                <li>• 日期 — 统计日期</li>
                <li>• 平均容量 — (Ah)</li>
                <li>• 置信下界/上界 — 95%</li>
                <li>• RUL预测 — 剩余寿命</li>
              </ul>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
