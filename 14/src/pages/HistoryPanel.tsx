import { useState, useEffect, useMemo, useRef } from 'react';
import ReactECharts from 'echarts-for-react';
import type { EChartsOption } from 'echarts';
import {
  CalendarDays,
  Play,
  Pause,
  FastForward,
  Search,
  ChevronDown,
  Battery,
  Thermometer,
  Zap,
  Activity
} from 'lucide-react';
import { useBmsStore } from '@/store/bmsStore';
import type { HistoryDataPoint } from '@/types';
import { cn } from '@/lib/utils';

type Granularity = '1m' | '5m' | '1h' | '1d';
type PresetDays = 7 | 30 | 90 | 180;
type PlaySpeed = 0.5 | 1 | 2 | 5;

const PRESET_BUTTONS: { label: string; value: PresetDays }[] = [
  { label: '7天', value: 7 },
  { label: '30天', value: 30 },
  { label: '90天', value: 90 },
  { label: '180天', value: 180 },
];

const GRANULARITY_OPTIONS: { label: string; value: Granularity }[] = [
  { label: '1分钟', value: '1m' },
  { label: '5分钟', value: '5m' },
  { label: '1小时', value: '1h' },
  { label: '1天', value: '1d' },
];

const SPEED_OPTIONS: PlaySpeed[] = [0.5, 1, 2, 5];

function formatDate(ts: number): string {
  const d = new Date(ts);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function formatDateTime(ts: number): string {
  const d = new Date(ts);
  return `${formatDate(ts)} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function downsampleData(data: HistoryDataPoint[], granularity: Granularity): HistoryDataPoint[] {
  if (data.length === 0) return data;

  let step = 1;
  switch (granularity) {
    case '1m': step = 1; break;
    case '5m': step = 5; break;
    case '1h': step = 60; break;
    case '1d': step = 1440; break;
  }

  if (step === 1) return data;

  const result: HistoryDataPoint[] = [];
  for (let i = 0; i < data.length; i += step) {
    const chunk = data.slice(i, i + step);
    const avg = (key: keyof HistoryDataPoint): number => {
      const vals = chunk.map(p => p[key] as number);
      return vals.reduce((a, b) => a + b, 0) / vals.length;
    };
    result.push({
      timestamp: chunk[0].timestamp,
      cellId: chunk[0].cellId,
      voltage: avg('voltage'),
      temperature: avg('temperature'),
      soh: avg('soh'),
      capacity: avg('capacity'),
      resistance: avg('resistance'),
    });
  }
  return result;
}

export default function HistoryPanel() {
  const { capacityHistory, loadHistoryData } = useBmsStore();
  const [startDate, setStartDate] = useState<string>(() => {
    const d = new Date();
    d.setDate(d.getDate() - 7);
    return formatDate(d.getTime());
  });
  const [endDate, setEndDate] = useState<string>(() => formatDate(Date.now()));
  const [granularity, setGranularity] = useState<Granularity>('1m');
  const [isLoading, setIsLoading] = useState(false);
  const [selectedCellIdx, setSelectedCellIdx] = useState<number | null>(null);
  const [showCapacity, setShowCapacity] = useState(true);
  const [showSoh, setShowSoh] = useState(false);
  const [showVoltage, setShowVoltage] = useState(false);
  const [showTemp, setShowTemp] = useState(true);

  const [isPlaying, setIsPlaying] = useState(false);
  const [playSpeed, setPlaySpeed] = useState<PlaySpeed>(1);
  const [currentTimeIdx, setCurrentTimeIdx] = useState(0);
  const playIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const cellOptions = useMemo(() => {
    if (capacityHistory.length === 0) return [];
    return capacityHistory.map((_, idx) => `电芯 #${idx + 1}`);
  }, [capacityHistory]);

  const aggregatedData = useMemo(() => {
    if (capacityHistory.length === 0) return [];
    const first = capacityHistory[0];
    const len = first.length;

    return first.map((_, tIdx) => {
      let capSum = 0, sohSum = 0, voltSum = 0, tempSum = 0;
      let capLower = Infinity, capUpper = -Infinity;

      for (let c = 0; c < capacityHistory.length; c++) {
        const pt = capacityHistory[c][tIdx];
        if (!pt) continue;
        capSum += pt.capacity;
        sohSum += pt.soh;
        voltSum += pt.voltage;
        tempSum += pt.temperature;
        if (pt.capacity < capLower) capLower = pt.capacity;
        if (pt.capacity > capUpper) capUpper = pt.capacity;
      }

      const mean = capSum / capacityHistory.length;
      const ci95 = (capUpper - capLower) * 0.35;

      return {
        timestamp: first[tIdx].timestamp,
        capacity: mean,
        capacityLower: mean - ci95,
        capacityUpper: mean + ci95,
        soh: sohSum / capacityHistory.length,
        voltage: voltSum / capacityHistory.length,
        temperature: tempSum / capacityHistory.length,
      };
    });
  }, [capacityHistory]);

  const displayData = useMemo<(HistoryDataPoint & { capacityLower: number; capacityUpper: number })[]>(() => {
    const filtered = aggregatedData.filter(d => {
      const s = new Date(startDate).getTime();
      const e = new Date(endDate).getTime() + 86400000;
      return d.timestamp >= s && d.timestamp <= e;
    });

    const capacityLowers: number[] = [];
    const capacityUppers: number[] = [];

    const tempFirst = filtered.length > 0 ? filtered.map((d, i) => {
      capacityLowers[i] = d.capacityLower;
      capacityUppers[i] = d.capacityUpper;
      return {
        timestamp: d.timestamp,
        cellId: 'avg',
        voltage: d.voltage,
        temperature: d.temperature,
        soh: d.soh,
        capacity: d.capacity,
        resistance: 0,
        capacityLower: d.capacityLower,
        capacityUpper: d.capacityUpper,
      };
    }) : [];

    const downsampled = downsampleData(tempFirst as HistoryDataPoint[], granularity);

    if (granularity === '1m') {
      return tempFirst;
    }

    const step = granularity === '5m' ? 5 : granularity === '1h' ? 60 : 1440;
    return downsampled.map((d, i) => {
      const startIdx = i * step;
      const endIdx = Math.min(startIdx + step, capacityLowers.length);
      const lowerChunk = capacityLowers.slice(startIdx, endIdx);
      const upperChunk = capacityUppers.slice(startIdx, endIdx);
      const avgLower = lowerChunk.length > 0 ? lowerChunk.reduce((a, b) => a + b, 0) / lowerChunk.length : d.capacity - 1;
      const avgUpper = upperChunk.length > 0 ? upperChunk.reduce((a, b) => a + b, 0) / upperChunk.length : d.capacity + 1;
      return {
        ...d,
        capacityLower: avgLower,
        capacityUpper: avgUpper,
      };
    });
  }, [aggregatedData, startDate, endDate, granularity]);

  const selectedCellData = useMemo(() => {
    if (selectedCellIdx === null || !capacityHistory[selectedCellIdx]) return [];
    const raw = capacityHistory[selectedCellIdx];
    const filtered = raw.filter(d => {
      const s = new Date(startDate).getTime();
      const e = new Date(endDate).getTime() + 86400000;
      return d.timestamp >= s && d.timestamp <= e;
    });
    return downsampleData(filtered, granularity);
  }, [capacityHistory, selectedCellIdx, startDate, endDate, granularity]);

  const handleLoad = () => {
    setIsLoading(true);
    const days = Math.ceil((new Date(endDate).getTime() - new Date(startDate).getTime()) / 86400000) + 1;
    loadHistoryData(days);
    setTimeout(() => setIsLoading(false), 600);
  };

  const handlePreset = (days: PresetDays) => {
    const end = new Date();
    const start = new Date();
    start.setDate(start.getDate() - days);
    setStartDate(formatDate(start.getTime()));
    setEndDate(formatDate(end.getTime()));
  };

  useEffect(() => {
    if (isPlaying && displayData.length > 0) {
      const baseInterval = 500;
      const interval = baseInterval / playSpeed;
      playIntervalRef.current = setInterval(() => {
        setCurrentTimeIdx(prev => {
          const next = prev + 1;
          if (next >= displayData.length) {
            setIsPlaying(false);
            return 0;
          }
          return next;
        });
      }, interval);
    } else if (playIntervalRef.current) {
      clearInterval(playIntervalRef.current);
      playIntervalRef.current = null;
    }
    return () => {
      if (playIntervalRef.current) {
        clearInterval(playIntervalRef.current);
      }
    };
  }, [isPlaying, playSpeed, displayData.length]);

  useEffect(() => {
    setCurrentTimeIdx(displayData.length - 1);
  }, [displayData.length]);

  const chartOption = useMemo<EChartsOption>(() => {
    const timestamps = displayData.map(d => formatDateTime(d.timestamp));
    const series: EChartsOption['series'] = [];

    if (showCapacity) {
      series.push({
        name: '95%置信区间',
        type: 'line',
        data: displayData.map(d => [d.capacityLower, d.capacityUpper]),
        stack: 'confidence',
        lineStyle: { opacity: 0 },
        areaStyle: {
          color: 'rgba(0, 240, 255, 0.15)',
        },
        symbol: 'none',
        silent: true,
        z: 1,
      });
      series.push({
        name: '容量(Ah)',
        type: 'line',
        data: displayData.map(d => d.capacity),
        smooth: true,
        symbol: 'none',
        lineStyle: { color: '#00f0ff', width: 2, shadowColor: '#00f0ff', shadowBlur: 8 },
        itemStyle: { color: '#00f0ff' },
        z: 3,
      });
    }

    if (showSoh) {
      series.push({
        name: 'SOH(%)',
        type: 'line',
        data: displayData.map(d => d.soh),
        smooth: true,
        symbol: 'none',
        lineStyle: { color: '#00e676', width: 2, shadowColor: '#00e676', shadowBlur: 6 },
        itemStyle: { color: '#00e676' },
        yAxisIndex: 0,
        z: 2,
      });
    }

    if (showVoltage) {
      series.push({
        name: '平均电压(V)',
        type: 'line',
        data: displayData.map(d => d.voltage),
        smooth: true,
        symbol: 'none',
        lineStyle: { color: '#ff8c00', width: 2, shadowColor: '#ff8c00', shadowBlur: 6 },
        itemStyle: { color: '#ff8c00' },
        yAxisIndex: 0,
        z: 2,
      });
    }

    if (showTemp) {
      series.push({
        name: '最高温度(°C)',
        type: 'line',
        data: displayData.map(d => d.temperature),
        smooth: true,
        symbol: 'none',
        lineStyle: { color: '#ff1744', width: 2, type: 'dashed', shadowColor: '#ff1744', shadowBlur: 6 },
        itemStyle: { color: '#ff1744' },
        yAxisIndex: 1,
        z: 2,
      });
    }

    if (selectedCellData.length > 0) {
      series.push({
        name: `选中电芯容量`,
        type: 'line',
        data: selectedCellData.map(d => d.capacity),
        smooth: true,
        symbol: 'circle',
        symbolSize: 4,
        lineStyle: { color: '#ffd700', width: 2.5, shadowColor: '#ffd700', shadowBlur: 10 },
        itemStyle: { color: '#ffd700', borderColor: '#fff', borderWidth: 1 },
        z: 5,
      });
    }

    const markLineData = displayData.length > 0 && currentTimeIdx < displayData.length
      ? [{ xAxis: formatDateTime(displayData[currentTimeIdx].timestamp), lineStyle: { color: '#00f0ff', type: 'dashed', width: 2 }, label: { show: false } }]
      : [];

    if (markLineData.length > 0 && series.length > 0) {
      const firstSeries = series[0] as Record<string, unknown>;
      firstSeries.markLine = {
        symbol: 'none',
        data: markLineData,
        silent: true,
      };
    }

    return {
      backgroundColor: 'transparent',
      color: ['#00f0ff', '#00e676', '#ff8c00', '#ff1744'],
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'cross', crossStyle: { color: '#00f0ff', opacity: 0.5 }, lineStyle: { color: '#00f0ff', opacity: 0.5 } },
        backgroundColor: 'rgba(17, 24, 39, 0.95)',
        borderColor: '#1e3a5f',
        borderWidth: 1,
        textStyle: { color: '#e0f7ff', fontSize: 12 },
        extraCssText: 'box-shadow: 0 0 12px rgba(0,240,255,0.3);',
        formatter: (params: unknown) => {
          const ps = params as Array<{ axisValue: string; seriesName: string; value: number | [number, number] }>;
          if (!ps || ps.length === 0) return '';
          let html = `<div style="font-weight:bold;color:#00f0ff;margin-bottom:6px;">${ps[0].axisValue}</div>`;
          ps.forEach(p => {
            if (p.seriesName === '95%置信区间') return;
            const val = Array.isArray(p.value) ? `${p.value[0].toFixed(2)} ~ ${p.value[1].toFixed(2)}` : (typeof p.value === 'number' ? p.value.toFixed(3) : p.value);
            html += `<div style="margin:2px 0;"><span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${p.seriesName.includes('温度') ? '#ff1744' : p.seriesName.includes('SOH') ? '#00e676' : p.seriesName.includes('电压') ? '#ff8c00' : p.seriesName.includes('选中') ? '#ffd700' : '#00f0ff'};margin-right:6px;"></span>${p.seriesName}: <b>${val}</b></div>`;
          });
          return html;
        },
      },
      legend: { show: false },
      grid: { left: 60, right: 70, top: 20, bottom: 40 },
      xAxis: {
        type: 'category',
        data: timestamps,
        boundaryGap: false,
        axisLine: { lineStyle: { color: '#1e3a5f' } },
        axisLabel: { color: '#8ba3c7', fontSize: 10, maxTicksLimit: 8 },
        splitLine: { show: false },
      },
      yAxis: [
        {
          type: 'value',
          name: '容量 / SOH / 电压',
          nameTextStyle: { color: '#8ba3c7', fontSize: 11 },
          axisLine: { show: true, lineStyle: { color: '#1e3a5f' } },
          axisLabel: { color: '#8ba3c7', fontSize: 10 },
          splitLine: { lineStyle: { color: 'rgba(30,58,95,0.5)', type: 'dashed' } },
          scale: true,
        },
        {
          type: 'value',
          name: '温度(°C)',
          nameTextStyle: { color: '#ff1744', fontSize: 11 },
          axisLine: { show: true, lineStyle: { color: '#ff1744' } },
          axisLabel: { color: '#ff1744', fontSize: 10 },
          splitLine: { show: false },
          scale: true,
        },
      ],
      dataZoom: [
        { type: 'inside', start: 0, end: 100, filterMode: 'none' },
        { type: 'slider', bottom: 0, start: 0, end: 100, height: 20, borderColor: '#1e3a5f', backgroundColor: '#0a0e1a', fillerColor: 'rgba(0,240,255,0.15)', handleStyle: { color: '#00f0ff' }, textStyle: { color: '#8ba3c7', fontSize: 10 }, filterMode: 'none' },
      ],
      series,
    } as EChartsOption;
  }, [displayData, selectedCellData, showCapacity, showSoh, showVoltage, showTemp, currentTimeIdx]);

  const miniChartOption = useMemo<EChartsOption>(() => {
    const timestamps = displayData.map(d => formatDate(d.timestamp));
    const caps = displayData.map(d => d.capacity);
    const step = Math.max(1, Math.floor(timestamps.length / 120));
    const miniTS = timestamps.filter((_, i) => i % step === 0);
    const miniCaps = caps.filter((_, i) => i % step === 0);
    return {
      backgroundColor: 'transparent',
      grid: { left: 0, right: 0, top: 5, bottom: 5 },
      xAxis: { type: 'category', show: false, data: miniTS },
      yAxis: { type: 'value', show: false },
      series: [{
        type: 'line',
        data: miniCaps,
        smooth: true,
        symbol: 'none',
        lineStyle: { color: '#0088ff', width: 1.5 },
        areaStyle: { color: 'rgba(0,136,255,0.25)' },
      }],
    };
  }, [displayData]);

  const progressPct = displayData.length > 0 ? (currentTimeIdx / (displayData.length - 1)) * 100 : 0;

  return (
    <div className="h-full w-full bg-bms-bg text-bms-text p-4 flex flex-col gap-4 overflow-hidden">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-2 flex-wrap">
          {PRESET_BUTTONS.map(btn => (
            <button
              key={btn.value}
              onClick={() => handlePreset(btn.value)}
              className={cn(
                'px-3 py-1.5 rounded text-sm font-mono border transition-all duration-200',
                'border-bms-border bg-bms-panel/60 hover:bg-bms-accent/10 hover:border-bms-accent hover:shadow-glow-cyan',
                'text-bms-text hover:text-bms-accent'
              )}
            >
              {btn.label}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-2">
            <CalendarDays size={16} className="text-bms-accent" />
            <input
              type="date"
              value={startDate}
              onChange={e => setStartDate(e.target.value)}
              className="bg-bms-panel border border-bms-border rounded px-2 py-1.5 text-sm font-mono text-bms-text focus:border-bms-accent focus:outline-none focus:ring-1 focus:ring-bms-accent/50"
            />
            <span className="text-bms-textDim">→</span>
            <input
              type="date"
              value={endDate}
              onChange={e => setEndDate(e.target.value)}
              className="bg-bms-panel border border-bms-border rounded px-2 py-1.5 text-sm font-mono text-bms-text focus:border-bms-accent focus:outline-none focus:ring-1 focus:ring-bms-accent/50"
            />
          </div>

          <div className="relative">
            <select
              value={granularity}
              onChange={e => setGranularity(e.target.value as Granularity)}
              className="appearance-none bg-bms-panel border border-bms-border rounded px-3 py-1.5 pr-8 text-sm font-mono text-bms-text focus:border-bms-accent focus:outline-none cursor-pointer"
            >
              {GRANULARITY_OPTIONS.map(opt => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
            <ChevronDown size={14} className="absolute right-2 top-1/2 -translate-y-1/2 text-bms-textDim pointer-events-none" />
          </div>

          <button
            onClick={handleLoad}
            disabled={isLoading}
            className={cn(
              'flex items-center gap-2 px-4 py-1.5 rounded font-mono text-sm transition-all duration-200',
              'bg-gradient-to-r from-bms-accent2 to-bms-accent text-bms-bg font-semibold',
              'hover:shadow-glow-cyan disabled:opacity-50 disabled:cursor-not-allowed'
            )}
          >
            <Search size={14} className={isLoading ? 'animate-spin' : ''} />
            {isLoading ? '加载中...' : '加载'}
          </button>
        </div>

        <div className="flex items-center gap-2">
          <span className="text-sm text-bms-textDim font-mono">单串:</span>
          <select
            value={selectedCellIdx ?? ''}
            onChange={e => setSelectedCellIdx(e.target.value === '' ? null : Number(e.target.value))}
            className="appearance-none bg-bms-panel border border-bms-border rounded px-3 py-1.5 pr-8 text-sm font-mono text-bms-text focus:border-yellow-500 focus:outline-none cursor-pointer max-w-[140px]"
          >
            <option value="">全部平均</option>
            {cellOptions.map((name, idx) => (
              <option key={idx} value={idx}>{name}</option>
            ))}
          </select>
          <ChevronDown size={14} className="text-bms-textDim -ml-6 pointer-events-none" />
        </div>
      </div>

      <div className="flex items-center gap-4 flex-wrap px-2">
        <label className="flex items-center gap-2 cursor-pointer select-none">
          <input type="checkbox" checked={showCapacity} onChange={e => setShowCapacity(e.target.checked)} className="accent-cyan-400 w-4 h-4" />
          <Battery size={14} className="text-bms-accent" />
          <span className="text-sm font-mono">容量</span>
        </label>
        <label className="flex items-center gap-2 cursor-pointer select-none">
          <input type="checkbox" checked={showSoh} onChange={e => setShowSoh(e.target.checked)} className="accent-green-400 w-4 h-4" />
          <Activity size={14} className="text-bms-ok" />
          <span className="text-sm font-mono">SOH</span>
        </label>
        <label className="flex items-center gap-2 cursor-pointer select-none">
          <input type="checkbox" checked={showVoltage} onChange={e => setShowVoltage(e.target.checked)} className="accent-orange-400 w-4 h-4" />
          <Zap size={14} className="text-bms-warn" />
          <span className="text-sm font-mono">平均电压</span>
        </label>
        <label className="flex items-center gap-2 cursor-pointer select-none">
          <input type="checkbox" checked={showTemp} onChange={e => setShowTemp(e.target.checked)} className="accent-red-400 w-4 h-4" />
          <Thermometer size={14} className="text-bms-error" />
          <span className="text-sm font-mono">最高温度</span>
        </label>
      </div>

      <div className="flex-1 min-h-0 rounded-lg border border-bms-border bg-bms-panel/40 shadow-inner-panel p-3">
        {displayData.length > 0 ? (
          <ReactECharts option={chartOption} style={{ height: '100%', width: '100%' }} notMerge={true} lazyUpdate={false} />
        ) : (
          <div className="h-full w-full flex items-center justify-center text-bms-textDim">
            <div className="text-center">
              <Battery size={48} className="mx-auto mb-3 opacity-40" />
              <p className="font-mono text-sm">暂无数据，请点击"加载"按钮</p>
            </div>
          </div>
        )}
      </div>

      <div className="rounded-lg border border-bms-border bg-bms-panel/40 shadow-inner-panel p-3">
        <div className="flex items-center gap-4">
          <button
            onClick={() => setIsPlaying(p => !p)}
            className={cn(
              'w-10 h-10 rounded-full flex items-center justify-center transition-all duration-200 border',
              isPlaying
                ? 'bg-bms-accent/20 border-bms-accent shadow-glow-cyan text-bms-accent'
                : 'bg-bms-panel border-bms-border hover:border-bms-accent hover:text-bms-accent text-bms-text'
            )}
          >
            {isPlaying ? <Pause size={18} fill="currentColor" /> : <Play size={18} fill="currentColor" />}
          </button>

          <div className="flex items-center gap-1 bg-bms-bg/60 rounded-full p-1 border border-bms-border">
            {SPEED_OPTIONS.map(speed => (
              <button
                key={speed}
                onClick={() => setPlaySpeed(speed)}
                className={cn(
                  'px-2.5 py-1 rounded-full text-xs font-mono transition-all',
                  playSpeed === speed
                    ? 'bg-bms-accent2 text-bms-bg font-bold shadow-glow-cyan'
                    : 'text-bms-textDim hover:text-bms-text'
                )}
              >
                {speed}x
              </button>
            ))}
            <FastForward size={12} className="mx-1 text-bms-textDim" />
          </div>

          <div className="flex-1 relative">
            <div className="relative h-3 bg-bms-bg rounded-full border border-bms-border overflow-hidden">
              <div
                className="absolute left-0 top-0 h-full bg-gradient-to-r from-bms-accent2 to-bms-accent transition-all"
                style={{ width: `${progressPct}%` }}
              />
              <input
                type="range"
                min={0}
                max={Math.max(0, displayData.length - 1)}
                value={currentTimeIdx}
                onChange={e => {
                  setIsPlaying(false);
                  setCurrentTimeIdx(Number(e.target.value));
                }}
                className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
              />
            </div>
            <div className="flex justify-between mt-1 text-[10px] font-mono text-bms-textDim">
              <span>{displayData.length > 0 ? formatDateTime(displayData[0].timestamp) : '--'}</span>
              <span className="text-bms-accent">{displayData.length > 0 ? formatDateTime(displayData[currentTimeIdx]?.timestamp ?? displayData[0].timestamp) : '--'}</span>
              <span>{displayData.length > 0 ? formatDateTime(displayData[displayData.length - 1].timestamp) : '--'}</span>
            </div>
          </div>

          <div className="w-48 h-12 rounded border border-bms-border bg-bms-bg/60 p-1">
            {displayData.length > 0 ? (
              <ReactECharts option={miniChartOption} style={{ height: '100%', width: '100%' }} notMerge={true} />
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
