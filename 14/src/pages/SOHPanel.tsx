import { useState, useMemo, useEffect } from 'react';
import ReactECharts from 'echarts-for-react';
import {
  Activity,
  Target,
  Gauge,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  ChevronLeft,
  ChevronRight,
  BarChart3,
  LineChart,
  Table2
} from 'lucide-react';
import { useBmsStore } from '@/store/bmsStore';
import { cn } from '@/lib/utils';
import type { SOHResult } from '@/types';

const BIN_START = 95;
const BIN_END = 101;
const BIN_COUNT = 12;
const BIN_WIDTH = (BIN_END - BIN_START) / BIN_COUNT;
const PAGE_SIZE = 20;

function getErrorStatus(errorAbs: number): 'ok' | 'warn' | 'error' {
  if (errorAbs < 1) return 'ok';
  if (errorAbs <= 2) return 'warn';
  return 'error';
}

function buildHistogramBoxplotOption(
  distribution: number[],
  boxplot: { min: number; q1: number; median: number; q3: number; max: number; outliers: number[] }
) {
  const xAxisLabels: string[] = [];
  for (let i = 0; i < BIN_COUNT; i++) {
    const lo = BIN_START + i * BIN_WIDTH;
    const hi = lo + BIN_WIDTH;
    xAxisLabels.push(`${lo.toFixed(1)}-${hi.toFixed(1)}`);
  }

  const boxData = [
    [
      xAxisLabels[0],
      boxplot.min,
      boxplot.q1,
      boxplot.median,
      boxplot.q3,
      boxplot.max
    ]
  ];

  const outlierPoints: [string, number][] = boxplot.outliers.map(v => {
    const idx = Math.min(BIN_COUNT - 1, Math.max(0, Math.floor((v - BIN_START) / BIN_WIDTH)));
    return [xAxisLabels[idx], v];
  });

  const markLines = {
    silent: true,
    symbol: 'none',
    lineStyle: {
      type: 'dashed',
      color: '#ff1744',
      width: 2
    },
    label: {
      show: true,
      color: '#ff1744',
      fontSize: 11,
      fontWeight: 'bold',
      backgroundColor: 'rgba(255,23,68,0.1)',
      padding: [2, 6],
      borderRadius: 3
    },
    data: [
      {
        yAxis: 0,
        label: { formatter: '±2% 误差阈值' },
        x2: BIN_COUNT
      }
    ]
  };

  return {
    backgroundColor: 'transparent',
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'shadow' },
      backgroundColor: 'rgba(17,24,39,0.95)',
      borderColor: '#1e3a5f',
      borderWidth: 1,
      textStyle: { color: '#e0f7ff', fontSize: 12 }
    },
    legend: {
      data: ['电芯数量', '箱线统计', '异常点'],
      textStyle: { color: '#8ba3c7', fontSize: 12 },
      top: 5,
      right: 10,
      icon: 'roundRect'
    },
    grid: {
      left: 50,
      right: 30,
      top: 50,
      bottom: 40
    },
    xAxis: {
      type: 'category',
      data: xAxisLabels,
      axisLabel: {
        color: '#8ba3c7',
        fontSize: 10,
        rotate: 30
      },
      axisLine: { lineStyle: { color: '#1e3a5f' } },
      splitLine: { show: false },
      name: 'SOH (%)',
      nameTextStyle: { color: '#8ba3c7', fontSize: 12, padding: [10, 0, 0, 0] }
    },
    yAxis: [
      {
        type: 'value',
        name: '电芯数',
        nameTextStyle: { color: '#8ba3c7', fontSize: 12 },
        axisLabel: { color: '#8ba3c7', fontSize: 11 },
        axisLine: { show: true, lineStyle: { color: '#1e3a5f' } },
        splitLine: { lineStyle: { color: 'rgba(30,58,95,0.5)', type: 'dashed' } }
      },
      {
        type: 'value',
        name: 'SOH (%)',
        min: BIN_START - 1,
        max: BIN_END + 1,
        nameTextStyle: { color: '#8ba3c7', fontSize: 12 },
        axisLabel: { color: '#8ba3c7', fontSize: 11, formatter: '{value}' },
        axisLine: { show: true, lineStyle: { color: '#1e3a5f' } },
        splitLine: { show: false }
      }
    ],
    series: [
      {
        name: '电芯数量',
        type: 'bar',
        yAxisIndex: 0,
        barWidth: '70%',
        data: distribution,
        itemStyle: {
          borderRadius: [4, 4, 0, 0],
          color: {
            type: 'linear',
            x: 0, y: 0, x2: 0, y2: 1,
            colorStops: [
              { offset: 0, color: '#00f0ff' },
              { offset: 0.6, color: '#0088ff' },
              { offset: 1, color: 'rgba(0,136,255,0.2)' }
            ]
          }
        }
      },
      {
        name: '箱线统计',
        type: 'boxplot',
        yAxisIndex: 1,
        data: boxData,
        boxWidth: [30, 60],
        itemStyle: {
          color: 'rgba(0,230,118,0.3)',
          borderColor: '#00e676',
          borderWidth: 2
        },
        markLine: markLines
      },
      {
        name: '异常点',
        type: 'scatter',
        yAxisIndex: 1,
        data: outlierPoints,
        symbolSize: 8,
        itemStyle: {
          color: '#ff1744',
          shadowColor: 'rgba(255,23,68,0.6)',
          shadowBlur: 10
        }
      }
    ]
  };
}

function buildCycleChartOption(
  history: { cycle: number; estimated: number; actual: number; lower: number; upper: number; error: number }[]
) {
  const cycles = history.map(h => h.cycle);
  const estimated = history.map(h => h.estimated);
  const actual = history.map(h => h.actual);
  const upperBand = history.map(h => h.upper);
  const lowerBand = history.map(h => h.lower);

  return {
    backgroundColor: 'transparent',
    tooltip: {
      trigger: 'axis',
      backgroundColor: 'rgba(17,24,39,0.95)',
      borderColor: '#1e3a5f',
      borderWidth: 1,
      textStyle: { color: '#e0f7ff', fontSize: 12 },
      formatter: (params: { seriesName: string; value: number; axisValue: number }[]) => {
        let html = `<div style="font-weight:bold;margin-bottom:4px;">循环 ${params[0].axisValue}</div>`;
        params.forEach(p => {
          if (p.seriesName !== '置信区间带') {
            html += `<div style="display:flex;justify-content:space-between;gap:20px;"><span>${p.seriesName}</span><span style="font-weight:bold;">${p.value.toFixed(2)}%</span></div>`;
          }
        });
        return html;
      }
    },
    legend: {
      data: ['Estimated SOH', 'Actual SOH', '误差条', '置信区间带'],
      textStyle: { color: '#8ba3c7', fontSize: 12 },
      top: 5,
      right: 10,
      icon: 'roundRect'
    },
    grid: {
      left: 55,
      right: 25,
      top: 50,
      bottom: 40
    },
    xAxis: {
      type: 'category',
      data: cycles,
      name: '循环次数',
      nameTextStyle: { color: '#8ba3c7', fontSize: 12, padding: [10, 0, 0, 0] },
      axisLabel: { color: '#8ba3c7', fontSize: 10 },
      axisLine: { lineStyle: { color: '#1e3a5f' } },
      splitLine: { show: false }
    },
    yAxis: {
      type: 'value',
      name: 'SOH (%)',
      min: 92,
      max: 102,
      nameTextStyle: { color: '#8ba3c7', fontSize: 12 },
      axisLabel: { color: '#8ba3c7', fontSize: 11, formatter: '{value}' },
      axisLine: { lineStyle: { color: '#1e3a5f' } },
      splitLine: { lineStyle: { color: 'rgba(30,58,95,0.5)', type: 'dashed' } }
    },
    series: [
      {
        name: '置信区间带',
        type: 'line',
        data: upperBand,
        lineStyle: { opacity: 0 },
        stack: 'confidence-band',
        symbol: 'none',
        silent: true
      },
      {
        name: '置信区间带',
        type: 'line',
        data: lowerBand.map((v, i) => upperBand[i] - v),
        lineStyle: { opacity: 0 },
        areaStyle: {
          color: 'rgba(0,240,255,0.12)'
        },
        stack: 'confidence-band',
        symbol: 'none',
        silent: true
      },
      {
        name: '误差条',
        type: 'custom',
        renderItem: (params, api) => {
          const h = history[params.dataIndex];
          const cx = api.coord([h.cycle, h.estimated])[0];
          const topY = api.coord([h.cycle, h.estimated + Math.abs(h.error)])[1];
          const botY = api.coord([h.cycle, h.estimated - Math.abs(h.error)])[1];
          return {
            type: 'group',
            children: [
              {
                type: 'line',
                shape: { x1: cx, y1: topY, x2: cx, y2: botY },
                style: { stroke: 'rgba(255,140,0,0.6)', lineWidth: 1 }
              },
              {
                type: 'line',
                shape: { x1: cx - 3, y1: topY, x2: cx + 3, y2: topY },
                style: { stroke: 'rgba(255,140,0,0.6)', lineWidth: 1 }
              },
              {
                type: 'line',
                shape: { x1: cx - 3, y1: botY, x2: cx + 3, y2: botY },
                style: { stroke: 'rgba(255,140,0,0.6)', lineWidth: 1 }
              }
            ]
          };
        },
        data: history.map(h => [h.cycle, h.estimated])
      },
      {
        name: 'Estimated SOH',
        type: 'line',
        data: estimated,
        smooth: true,
        symbol: 'circle',
        symbolSize: 5,
        lineStyle: {
          width: 2.5,
          color: '#00f0ff',
          shadowColor: 'rgba(0,240,255,0.4)',
          shadowBlur: 10
        },
        itemStyle: { color: '#00f0ff' }
      },
      {
        name: 'Actual SOH',
        type: 'line',
        data: actual,
        smooth: true,
        symbol: 'diamond',
        symbolSize: 5,
        lineStyle: {
          width: 2.5,
          color: '#00e676',
          type: 'solid',
          shadowColor: 'rgba(0,230,118,0.4)',
          shadowBlur: 10
        },
        itemStyle: { color: '#00e676' }
      }
    ]
  };
}

export default function SOHPanel() {
  const { sohResults, cells, sohEngine, sohHistory, loadSOHHistory } = useBmsStore();
  const [currentPage, setCurrentPage] = useState(1);
  const [initialized, setInitialized] = useState(false);

  useEffect(() => {
    if (!initialized && sohHistory.length === 0) {
      loadSOHHistory(100);
      setInitialized(true);
    } else if (!initialized) {
      setInitialized(true);
    }
  }, [initialized, sohHistory.length, loadSOHHistory]);

  const errorStats = useMemo(() => {
    if (sohResults.length === 0 || cells.length === 0) {
      return {
        avgSoh: { mean: 0, lower95: 0, upper95: 0, standardDeviation: 0, sampleSize: 0 },
        within2PercentRate: 0,
        maxError: 0,
        mae: 0,
        rmse: 0,
        sohDistribution: new Array(BIN_COUNT).fill(0),
        boxplotStats: { min: 0, q1: 0, median: 0, q3: 0, max: 0, outliers: [] as number[] }
      };
    }
    return sohEngine.getErrorStats(sohResults, cells);
  }, [sohResults, cells, sohEngine]);

  const cycleData = useMemo(() => {
    if (sohHistory.length === 0) return [];
    const representative = sohHistory[0] || [];
    const lastN = representative.slice(-50);
    return lastN.map((pt, i) => ({
      cycle: representative.length - lastN.length + i + 1,
      estimated: pt.sohEstimated,
      actual: pt.sohActual,
      error: pt.error,
      lower: pt.confidenceLower,
      upper: pt.confidenceUpper
    }));
  }, [sohHistory]);

  const totalPages = Math.ceil(sohResults.length / PAGE_SIZE);
  const pagedResults = useMemo(() => {
    const start = (currentPage - 1) * PAGE_SIZE;
    return sohResults.slice(start, start + PAGE_SIZE);
  }, [sohResults, currentPage]);

  const histogramOption = useMemo(
    () => buildHistogramBoxplotOption(errorStats.sohDistribution, errorStats.boxplotStats),
    [errorStats.sohDistribution, errorStats.boxplotStats]
  );

  const cycleOption = useMemo(
    () => buildCycleChartOption(cycleData),
    [cycleData]
  );

  const getCellActual = (cellId: string): number => {
    const cell = cells.find(c => c.cellId === cellId);
    return cell ? cell.soh : 0;
  };

  const rowBgClass = (r: SOHResult) => {
    const s = getErrorStatus(Math.abs(r.error));
    if (s === 'ok') return 'bg-bms-ok/5 hover:bg-bms-ok/10';
    if (s === 'warn') return 'bg-bms-warn/5 hover:bg-bms-warn/10';
    return 'bg-bms-error/5 hover:bg-bms-error/10';
  };

  const errColorClass = (r: SOHResult) => {
    const s = getErrorStatus(Math.abs(r.error));
    if (s === 'ok') return 'text-bms-ok';
    if (s === 'warn') return 'text-bms-warn';
    return 'text-bms-error';
  };

  return (
    <div className="min-h-screen bg-bms-bg p-4 lg:p-6 text-bms-text">
      <div className="mb-5 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-lg bg-gradient-to-br from-bms-accent/20 to-bms-accent2/20 border border-bms-accent/30 shadow-glow-cyan">
            <Activity className="w-7 h-7 text-bms-accent" />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-wide bg-gradient-to-r from-bms-accent to-bms-accent2 bg-clip-text text-transparent">
              SOH 估算面板
            </h1>
            <p className="text-sm text-bms-textDim mt-0.5">电池健康状态智能估算 · 融合ICA+EKF算法</p>
          </div>
        </div>
        <div className="hidden md:flex items-center gap-2 px-3 py-1.5 rounded-md bg-bms-panel border border-bms-border text-xs text-bms-textDim">
          <span className="w-2 h-2 rounded-full bg-bms-ok animate-pulse-slow" />
          <span>实时在线</span>
          <span className="mx-2 opacity-30">|</span>
          <span>电芯总数: {cells.length}</span>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-5">
        <MetricCard
          icon={<Target className="w-5 h-5" />}
          iconBg="from-bms-accent/20 to-bms-accent2/20"
          iconBorder="border-bms-accent/30"
          iconColor="text-bms-accent"
          title="AVG SOH"
          titleZh="均值"
          mainValue={`${errorStats.avgSoh.mean.toFixed(2)}%`}
          mainValueClass="text-bms-accent"
          subLines={[
            { label: 'Mean', value: errorStats.avgSoh.mean.toFixed(3), color: 'text-bms-text' },
            { label: 'Lower 95', value: errorStats.avgSoh.lower95.toFixed(3), color: 'text-bms-warn' },
            { label: 'Upper 95', value: errorStats.avgSoh.upper95.toFixed(3), color: 'text-bms-warn' }
          ]}
        />

        <MetricCard
          icon={<CheckCircle2 className="w-5 h-5" />}
          iconBg="from-bms-ok/20 to-emerald-900/20"
          iconBorder="border-bms-ok/30"
          iconColor="text-bms-ok"
          title="Within 2% Rate"
          titleZh="误差达标率"
          mainValue={`${errorStats.within2PercentRate.toFixed(1)}%`}
          mainValueClass={errorStats.within2PercentRate >= 95 ? 'text-bms-ok' : 'text-bms-warn'}
          progress={{
            value: errorStats.within2PercentRate,
            barColor: errorStats.within2PercentRate >= 95
              ? 'from-bms-ok to-emerald-400'
              : 'from-bms-warn to-yellow-400'
          }}
          subLines={[
            { label: '达标电芯', value: `${Math.round(sohResults.length * errorStats.within2PercentRate / 100)} / ${sohResults.length}`, color: 'text-bms-text' }
          ]}
        />

        <MetricCard
          icon={<AlertTriangle className="w-5 h-5" />}
          iconBg="from-bms-error/20 to-red-900/20"
          iconBorder="border-bms-error/30"
          iconColor={errorStats.maxError > 2 ? 'text-bms-error' : 'text-bms-warn'}
          title="Max Error"
          titleZh="最大误差"
          mainValue={`${errorStats.maxError.toFixed(3)}%`}
          mainValueClass={errorStats.maxError > 2 ? 'text-bms-error' : 'text-bms-warn'}
          highlight={errorStats.maxError > 2}
          subLines={[
            { label: '阈值', value: '2.000%', color: errorStats.maxError > 2 ? 'text-bms-error' : 'text-bms-textDim' },
            { label: '状态', value: errorStats.maxError > 2 ? '超标' : '正常', color: errorStats.maxError > 2 ? 'text-bms-error' : 'text-bms-ok' }
          ]}
        />

        <MetricCard
          icon={<Gauge className="w-5 h-5" />}
          iconBg="from-bms-accent2/20 to-blue-900/20"
          iconBorder="border-bms-accent2/30"
          iconColor="text-bms-accent2"
          title="MAE / RMSE"
          titleZh="误差指标"
          mainValue={`${errorStats.mae.toFixed(3)}%`}
          mainValueClass="text-bms-accent2"
          subLines={[
            { label: 'MAE', value: errorStats.mae.toFixed(4), color: 'text-bms-accent2' },
            { label: 'RMSE', value: errorStats.rmse.toFixed(4), color: 'text-bms-text' },
            { label: 'StdDev', value: errorStats.avgSoh.standardDeviation.toFixed(4), color: 'text-bms-textDim' }
          ]}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-4 mb-5">
        <div className="lg:col-span-3 rounded-xl bg-bms-panel border border-bms-border shadow-inner-panel p-4">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <BarChart3 className="w-4 h-4 text-bms-accent" />
              <h2 className="text-sm font-semibold tracking-wide">SOH 分布直方图 & 箱线统计</h2>
            </div>
            <div className="flex items-center gap-3 text-xs">
              <span className="px-2 py-0.5 rounded bg-bms-accent/10 text-bms-accent border border-bms-accent/20">
                区间: {BIN_START}–{BIN_END}%
              </span>
              <span className="px-2 py-0.5 rounded bg-bms-border/40 text-bms-textDim border border-bms-border">
                IQR: {(errorStats.boxplotStats.q3 - errorStats.boxplotStats.q1).toFixed(3)}
              </span>
            </div>
          </div>
          <div className="h-[340px]">
            <ReactECharts
              option={histogramOption}
              style={{ height: '100%', width: '100%' }}
              opts={{ renderer: 'canvas' }}
            />
          </div>
        </div>

        <div className="lg:col-span-2 rounded-xl bg-bms-panel border border-bms-border shadow-inner-panel p-4">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <LineChart className="w-4 h-4 text-bms-ok" />
              <h2 className="text-sm font-semibold tracking-wide">充电循环 SOH 跟踪</h2>
            </div>
            <span className="px-2 py-0.5 rounded bg-bms-border/40 text-bms-textDim border border-bms-border text-xs">
              最近 {cycleData.length} 次循环
            </span>
          </div>
          <div className="h-[340px]">
            <ReactECharts
              option={cycleOption}
              style={{ height: '100%', width: '100%' }}
              opts={{ renderer: 'canvas' }}
            />
          </div>
        </div>
      </div>

      <div className="rounded-xl bg-bms-panel border border-bms-border shadow-inner-panel overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-bms-border">
          <div className="flex items-center gap-2">
            <Table2 className="w-4 h-4 text-bms-accent" />
            <h2 className="text-sm font-semibold tracking-wide">200串 SOH 明细表</h2>
            <span className="ml-2 px-2 py-0.5 rounded text-xs bg-bms-border/40 text-bms-textDim border border-bms-border">
              {sohResults.length} 条记录
            </span>
          </div>
          <div className="flex items-center gap-4 text-xs">
            <div className="flex items-center gap-1.5">
              <span className="w-3 h-3 rounded bg-bms-ok/30 border border-bms-ok/50" />
              <span className="text-bms-textDim">{'<1% 优'}</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="w-3 h-3 rounded bg-bms-warn/30 border border-bms-warn/50" />
              <span className="text-bms-textDim">1–2% 良</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="w-3 h-3 rounded bg-bms-error/30 border border-bms-error/50" />
              <span className="text-bms-textDim">{'≥2% 差'}</span>
            </div>
          </div>
        </div>

        <div className="overflow-x-auto max-h-[420px] overflow-y-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-bms-panel z-10">
              <tr className="text-bms-textDim text-xs uppercase tracking-wider">
                <th className="px-4 py-3 text-left font-medium border-b border-bms-border">cellId</th>
                <th className="px-4 py-3 text-right font-medium border-b border-bms-border">SOH 估计</th>
                <th className="px-4 py-3 text-right font-medium border-b border-bms-border">SOH 实际</th>
                <th className="px-4 py-3 text-right font-medium border-b border-bms-border">误差 %</th>
                <th className="px-4 py-3 text-right font-medium border-b border-bms-border">置信下界</th>
                <th className="px-4 py-3 text-right font-medium border-b border-bms-border">置信上界</th>
                <th className="px-4 py-3 text-center font-medium border-b border-bms-border">状态</th>
              </tr>
            </thead>
            <tbody className="font-mono text-xs">
              {pagedResults.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-12 text-center text-bms-textDim">
                    暂无数据...
                  </td>
                </tr>
              ) : (
                pagedResults.map(r => {
                  const actual = getCellActual(r.cellId);
                  const errAbs = Math.abs(r.error);
                  const status = getErrorStatus(errAbs);
                  return (
                    <tr
                      key={r.cellId}
                      className={cn(
                        'transition-colors border-b border-bms-border/50 last:border-0',
                        rowBgClass(r)
                      )}
                    >
                      <td className="px-4 py-2.5 font-semibold text-bms-accent">{r.cellId}</td>
                      <td className="px-4 py-2.5 text-right text-bms-text">
                        {r.soh.toFixed(3)}%
                      </td>
                      <td className="px-4 py-2.5 text-right text-bms-ok">
                        {actual.toFixed(3)}%
                      </td>
                      <td className={cn('px-4 py-2.5 text-right font-bold tabular-nums', errColorClass(r))}>
                        {r.error >= 0 ? '+' : ''}{r.error.toFixed(3)}
                      </td>
                      <td className="px-4 py-2.5 text-right text-bms-warn">
                        {r.confidence[0].toFixed(3)}
                      </td>
                      <td className="px-4 py-2.5 text-right text-bms-warn">
                        {r.confidence[1].toFixed(3)}
                      </td>
                      <td className="px-4 py-2.5 text-center">
                        {status === 'ok' && (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-bms-ok/10 text-bms-ok border border-bms-ok/30 text-[11px] font-medium">
                            <CheckCircle2 className="w-3 h-3" /> 优
                          </span>
                        )}
                        {status === 'warn' && (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-bms-warn/10 text-bms-warn border border-bms-warn/30 text-[11px] font-medium">
                            <AlertTriangle className="w-3 h-3" /> 良
                          </span>
                        )}
                        {status === 'error' && (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-bms-error/10 text-bms-error border border-bms-error/30 text-[11px] font-medium">
                            <XCircle className="w-3 h-3" /> 超标
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        <div className="flex items-center justify-between px-4 py-3 border-t border-bms-border bg-bms-panel/80">
          <div className="text-xs text-bms-textDim flex items-center gap-4">
            <span>
              第 <span className="text-bms-text font-semibold">{currentPage}</span> / {totalPages || 1} 页
            </span>
            <span className="hidden sm:inline">
              显示 {(currentPage - 1) * PAGE_SIZE + 1}–{Math.min(currentPage * PAGE_SIZE, sohResults.length)} 条
            </span>
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
              disabled={currentPage <= 1}
              className={cn(
                'p-1.5 rounded-md transition-all',
                currentPage <= 1
                  ? 'text-bms-textDim/40 cursor-not-allowed'
                  : 'text-bms-textDim hover:bg-bms-accent/10 hover:text-bms-accent border border-transparent hover:border-bms-accent/30'
              )}
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <div className="flex items-center gap-0.5 mx-1">
              {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                let page: number;
                if (totalPages <= 5) {
                  page = i + 1;
                } else if (currentPage <= 3) {
                  page = i + 1;
                } else if (currentPage >= totalPages - 2) {
                  page = totalPages - 4 + i;
                } else {
                  page = currentPage - 2 + i;
                }
                return (
                  <button
                    key={page}
                    onClick={() => setCurrentPage(page)}
                    className={cn(
                      'min-w-[30px] h-7 px-1.5 rounded-md text-xs font-medium transition-all',
                      currentPage === page
                        ? 'bg-gradient-to-br from-bms-accent to-bms-accent2 text-bms-bg shadow-glow-cyan'
                        : 'text-bms-textDim hover:bg-bms-border/40 hover:text-bms-text'
                    )}
                  >
                    {page}
                  </button>
                );
              })}
            </div>
            <button
              onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
              disabled={currentPage >= totalPages}
              className={cn(
                'p-1.5 rounded-md transition-all',
                currentPage >= totalPages
                  ? 'text-bms-textDim/40 cursor-not-allowed'
                  : 'text-bms-textDim hover:bg-bms-accent/10 hover:text-bms-accent border border-transparent hover:border-bms-accent/30'
              )}
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

interface SubLine {
  label: string;
  value: string;
  color?: string;
}

interface MetricCardProps {
  icon: React.ReactNode;
  iconBg: string;
  iconBorder: string;
  iconColor: string;
  title: string;
  titleZh: string;
  mainValue: string;
  mainValueClass: string;
  highlight?: boolean;
  progress?: { value: number; barColor: string };
  subLines?: SubLine[];
}

function MetricCard({
  icon,
  iconBg,
  iconBorder,
  iconColor,
  title,
  titleZh,
  mainValue,
  mainValueClass,
  highlight,
  progress,
  subLines
}: MetricCardProps) {
  return (
    <div
      className={cn(
        'relative rounded-xl bg-bms-panel border p-4 shadow-inner-panel overflow-hidden transition-all hover:scale-[1.01]',
        highlight
          ? 'border-bms-error/50 shadow-glow-red'
          : 'border-bms-border hover:border-bms-accent/40'
      )}
    >
      <div className="absolute -top-8 -right-8 w-24 h-24 rounded-full bg-gradient-to-br from-white/5 to-transparent blur-2xl pointer-events-none" />

      <div className="relative">
        <div className="flex items-start justify-between mb-3">
          <div
            className={cn(
              'p-2 rounded-lg border bg-gradient-to-br',
              iconBg,
              iconBorder
            )}
          >
            <div className={iconColor}>{icon}</div>
          </div>
          <div className="text-right">
            <div className="text-[10px] uppercase tracking-widest text-bms-textDim/70 font-semibold">
              {title}
            </div>
            <div className="text-xs text-bms-textDim mt-0.5">{titleZh}</div>
          </div>
        </div>

        <div className={cn('text-3xl font-bold font-mono tracking-tight mb-2', mainValueClass)}>
          {mainValue}
        </div>

        {progress && (
          <div className="mb-2">
            <div className="h-2 rounded-full bg-bms-border/50 overflow-hidden">
              <div
                className={cn(
                  'h-full rounded-full bg-gradient-to-r transition-all duration-700',
                  progress.barColor
                )}
                style={{ width: `${Math.min(100, progress.value)}%` }}
              />
            </div>
          </div>
        )}

        {subLines && subLines.length > 0 && (
          <div className="space-y-1 pt-1 border-t border-bms-border/50">
            {subLines.map((s, i) => (
              <div key={i} className="flex items-center justify-between text-[11px] font-mono">
                <span className="text-bms-textDim">{s.label}</span>
                <span className={cn('font-semibold tabular-nums', s.color || 'text-bms-text')}>
                  {s.value}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
