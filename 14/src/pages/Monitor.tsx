import { useEffect, useMemo, useState } from 'react';
import { useBmsStore } from '../store/bmsStore';
import { GaugeChart } from '../components/GaugeChart';
import ReactECharts from 'echarts-for-react';
import type { AlertRecord, CellData } from '../types';
import {
  AlertTriangle,
  Battery,
  Bolt,
  Thermometer,
  Play,
  Pause,
  Zap,
  Activity,
  Gauge,
  Repeat,
  Info,
  CheckCircle2,
  Wifi,
  WifiOff,
  ShieldAlert,
  CircleDot
} from 'lucide-react';

const ROWS = 10;
const COLS = 20;

function getVoltageColor(v: number): string {
  if (v < 3.0) return 'rgba(255, 23, 68, 0.85)';
  if (v < 3.2) return 'rgba(255, 140, 0, 0.75)';
  if (v < 3.4) return 'rgba(0, 230, 118, 0.7)';
  if (v <= 3.65) return 'rgba(255, 213, 0, 0.75)';
  return 'rgba(255, 23, 68, 0.85)';
}

function getVoltageBorder(v: number): string {
  if (v < 3.0) return 'rgba(255, 23, 68, 1)';
  if (v < 3.2) return 'rgba(255, 140, 0, 1)';
  if (v < 3.4) return 'rgba(0, 230, 118, 1)';
  if (v <= 3.65) return 'rgba(255, 213, 0, 1)';
  return 'rgba(255, 23, 68, 1)';
}

function isTempAbnormal(t: number): boolean {
  return t > 60 || t < 0;
}

function formatTime(ts: number): string {
  const d = new Date(ts);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  return `${hh}:${mm}:${ss}`;
}

function AlertLevelIcon({ level }: { level: AlertRecord['level'] }) {
  if (level === 'critical') {
    return <ShieldAlert className="w-4 h-4 text-bms-error shrink-0" />;
  }
  if (level === 'warning') {
    return <AlertTriangle className="w-4 h-4 text-bms-warn shrink-0" />;
  }
  return <Info className="w-4 h-4 text-yellow-400 shrink-0" />;
}

function LevelBadge({ level }: { level: AlertRecord['level'] }) {
  const styles = {
    critical: 'bg-bms-error/15 text-bms-error border border-bms-error/40',
    warning: 'bg-bms-warn/15 text-bms-warn border border-bms-warn/40',
    info: 'bg-yellow-400/15 text-yellow-400 border border-yellow-400/40'
  };
  const labels = { critical: 'CRITICAL', warning: 'WARNING', info: 'INFO' };
  return (
    <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded ${styles[level]}`}>
      {labels[level]}
    </span>
  );
}

interface CellTooltip {
  cell: CellData;
  x: number;
  y: number;
}

export function Monitor() {
  const {
    cells,
    pack,
    alerts,
    sohResults,
    isCharging,
    isBalancing,
    isSimulationRunning,
    simulationSpeed,
    selectedCellId,
    init,
    startSimulation,
    stopSimulation,
    setSimulationSpeed,
    setCharging,
    setBalancing,
    toggleSimulation,
    selectCell
  } = useBmsStore();

  const [tooltip, setTooltip] = useState<CellTooltip | null>(null);
  const [voltageHistory, setVoltageHistory] = useState<{ t: string; v: number }[]>([]);
  const [currentHistory, setCurrentHistory] = useState<{ t: string; c: number }[]>([]);

  useEffect(() => {
    if (cells.length === 0) {
      init();
    }
  }, [cells.length, init]);

  useEffect(() => {
    if (pack.totalVoltage > 0) {
      const t = formatTime(Date.now());
      setVoltageHistory(prev => [...prev, { t, v: pack.totalVoltage }].slice(-60));
      setCurrentHistory(prev => [...prev, { t, c: pack.totalCurrent }].slice(-60));
    }
  }, [pack.totalVoltage, pack.totalCurrent]);

  const soc = useMemo(() => {
    if (cells.length === 0) return 0;
    const avg = cells.reduce((s, c) => s + c.soc, 0) / cells.length;
    return Math.max(0, Math.min(100, avg));
  }, [cells]);

  const soh = useMemo(() => {
    if (sohResults.length === 0) {
      if (cells.length === 0) return 100;
      const avg = cells.reduce((s, c) => s + c.soh, 0) / cells.length;
      return Math.max(80, Math.min(100, avg));
    }
    const avg = sohResults.reduce((s, r) => s + r.soh, 0) / sohResults.length;
    return Math.max(80, Math.min(100, avg));
  }, [sohResults, cells]);

  const cellGrid = useMemo(() => {
    const grid: (CellData | null)[][] = Array.from({ length: ROWS }, () =>
      Array.from({ length: COLS }, () => null)
    );
    cells.forEach(cell => {
      const idNum = parseInt(cell.cellId.replace(/\D/g, ''), 10) - 1;
      if (isNaN(idNum) || idNum < 0 || idNum >= ROWS * COLS) return;
      const r = Math.floor(idNum / COLS);
      const c = idNum % COLS;
      grid[r][c] = cell;
    });
    return grid;
  }, [cells]);

  const sortedAlerts = useMemo(() => {
    return [...alerts]
      .sort((a, b) => {
        const levelOrder = { critical: 0, warning: 1, info: 2 };
        const la = levelOrder[a.level];
        const lb = levelOrder[b.level];
        if (la !== lb) return la - lb;
        return b.timestamp - a.timestamp;
      })
      .slice(0, 15);
  }, [alerts]);

  const voltageChartOption = useMemo(() => ({
    grid: { top: 8, right: 8, bottom: 20, left: 36 },
    xAxis: {
      type: 'category',
      data: voltageHistory.map(d => d.t),
      axisLine: { lineStyle: { color: '#1e3a5f' } },
      axisLabel: { color: '#8ba3c7', fontSize: 9, interval: 9 },
      axisTick: { show: false }
    },
    yAxis: {
      type: 'value',
      min: 580,
      max: 680,
      axisLine: { lineStyle: { color: '#1e3a5f' } },
      axisLabel: { color: '#8ba3c7', fontSize: 9, formatter: '{value}V' },
      splitLine: { lineStyle: { color: 'rgba(30, 58, 95, 0.3)' } }
    },
    series: [{
      data: voltageHistory.map(d => d.v),
      type: 'line',
      smooth: true,
      symbol: 'none',
      lineStyle: { color: '#00f0ff', width: 1.5 },
      areaStyle: {
        color: {
          type: 'linear', x: 0, y: 0, x2: 0, y2: 1,
          colorStops: [
            { offset: 0, color: 'rgba(0, 240, 255, 0.4)' },
            { offset: 1, color: 'rgba(0, 240, 255, 0.02)' }
          ]
        }
      }
    }]
  }), [voltageHistory]);

  const currentChartOption = useMemo(() => ({
    grid: { top: 8, right: 8, bottom: 20, left: 40 },
    xAxis: {
      type: 'category',
      data: currentHistory.map(d => d.t),
      axisLine: { lineStyle: { color: '#1e3a5f' } },
      axisLabel: { color: '#8ba3c7', fontSize: 9, interval: 9 },
      axisTick: { show: false }
    },
    yAxis: {
      type: 'value',
      min: -120,
      max: 120,
      axisLine: { lineStyle: { color: '#1e3a5f' } },
      axisLabel: { color: '#8ba3c7', fontSize: 9, formatter: '{value}A' },
      splitLine: { lineStyle: { color: 'rgba(30, 58, 95, 0.3)' } }
    },
    series: [{
      data: currentHistory.map(d => d.c),
      type: 'line',
      smooth: true,
      symbol: 'none',
      lineStyle: { color: '#00e676', width: 1.5 },
      areaStyle: {
        color: {
          type: 'linear', x: 0, y: 0, x2: 0, y2: 1,
          colorStops: [
            { offset: 0, color: 'rgba(0, 230, 118, 0.35)' },
            { offset: 1, color: 'rgba(0, 230, 118, 0.02)' }
          ]
        }
      }
    }]
  }), [currentHistory]);

  return (
    <div className="min-h-screen w-full bg-bms-bg text-bms-text font-mono">
      <div className="absolute inset-0 pointer-events-none opacity-[0.03]"
           style={{
             backgroundImage: 'linear-gradient(#00f0ff 1px, transparent 1px), linear-gradient(90deg, #00f0ff 1px, transparent 1px)',
             backgroundSize: '40px 40px'
           }} />

      <div className="relative z-10 p-4 flex flex-col gap-4 h-screen overflow-hidden">
        <header className="shrink-0">
          <div className="border border-bms-border/60 rounded-lg bg-gradient-to-br from-bms-panel/80 to-bms-bg/80 p-4 shadow-inner-panel backdrop-blur-sm">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded bg-bms-accent/10 border border-bms-accent/40 shadow-glow-cyan">
                  <Battery className="w-6 h-6 text-bms-accent" />
                </div>
                <div>
                  <h1 className="text-xl font-bold tracking-wider text-bms-accent drop-shadow-[0_0_8px_rgba(0,240,255,0.5)]">
                    BMS 实时监控大屏
                  </h1>
                  <p className="text-xs text-bms-textDim">
                    PACK ID: {pack.packId} &nbsp;|&nbsp; {new Date(pack.timestamp).toLocaleString('zh-CN')}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                {isSimulationRunning ? (
                  <span className="flex items-center gap-1.5 px-3 py-1 rounded bg-bms-ok/10 border border-bms-ok/40 text-bms-ok text-xs shadow-glow-green">
                    <CircleDot className="w-3 h-3 animate-pulse" />
                    LIVE
                  </span>
                ) : (
                  <span className="flex items-center gap-1.5 px-3 py-1 rounded bg-bms-textDim/10 border border-bms-textDim/40 text-bms-textDim text-xs">
                    <WifiOff className="w-3 h-3" />
                    PAUSED
                  </span>
                )}
              </div>
            </div>

            <div className="grid grid-cols-6 gap-6 items-end justify-items-center">
              <GaugeChart
                value={pack.totalVoltage}
                min={0}
                max={640}
                label="总电压"
                unit="V"
                color="#00f0ff"
                size={140}
              />
              <GaugeChart
                value={pack.totalCurrent}
                min={-100}
                max={100}
                label="总电流"
                unit="A"
                color="#00e676"
                size={140}
              />
              <GaugeChart
                value={pack.power}
                min={-60}
                max={60}
                label="功率"
                unit="kW"
                color="#ff8c00"
                size={140}
              />
              <GaugeChart
                value={soc}
                min={0}
                max={100}
                label="SOC"
                unit="%"
                color="#7c4dff"
                size={140}
              />
              <GaugeChart
                value={soh}
                min={80}
                max={100}
                label="SOH"
                unit="%"
                color="#00bcd4"
                size={140}
              />
              <GaugeChart
                value={pack.cycleCount}
                min={0}
                max={2000}
                label="循环次数"
                unit="次"
                color="#e040fb"
                size={140}
              />
            </div>

            <div className="grid grid-cols-2 gap-4 mt-4">
              <div className="border border-bms-border/40 rounded bg-bms-bg/50 p-2">
                <div className="flex items-center gap-1.5 mb-1 text-[11px] text-bms-accent">
                  <Bolt className="w-3 h-3" />总电压趋势 (V)
                </div>
                <ReactECharts option={voltageChartOption} style={{ height: 80 }} notMerge />
              </div>
              <div className="border border-bms-border/40 rounded bg-bms-bg/50 p-2">
                <div className="flex items-center gap-1.5 mb-1 text-[11px] text-bms-ok">
                  <Activity className="w-3 h-3" />总电流趋势 (A)
                </div>
                <ReactECharts option={currentChartOption} style={{ height: 80 }} notMerge />
              </div>
            </div>
          </div>
        </header>

        <div className="flex-1 grid grid-cols-10 gap-4 min-h-0">
          <section className="col-span-7 flex flex-col gap-4 min-h-0">
            <div className="flex-1 border border-bms-border/60 rounded-lg bg-gradient-to-br from-bms-panel/60 to-bms-bg/60 p-4 shadow-inner-panel overflow-hidden flex flex-col">
              <div className="flex items-center justify-between mb-3 shrink-0">
                <div className="flex items-center gap-2">
                  <div className="p-1.5 rounded bg-bms-accent/10 border border-bms-accent/30">
                    <Gauge className="w-4 h-4 text-bms-accent" />
                  </div>
                  <h2 className="text-sm font-semibold tracking-wide text-bms-text">电芯矩阵热力图</h2>
                  <span className="text-[11px] text-bms-textDim font-mono">
                    {ROWS}×{COLS} = {ROWS * COLS} CELLS
                  </span>
                </div>
                <div className="flex items-center gap-3 text-[10px]">
                  <div className="flex items-center gap-1">
                    <span className="w-3 h-3 rounded-sm" style={{ background: 'rgba(255,23,68,0.85)', border: '1px solid rgba(255,23,68,1)' }} />
                    <span className="text-bms-textDim">{'<3.0V'}</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <span className="w-3 h-3 rounded-sm" style={{ background: 'rgba(255,140,0,0.75)', border: '1px solid rgba(255,140,0,1)' }} />
                    <span className="text-bms-textDim">3.0~3.2V</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <span className="w-3 h-3 rounded-sm" style={{ background: 'rgba(0,230,118,0.7)', border: '1px solid rgba(0,230,118,1)' }} />
                    <span className="text-bms-textDim">3.2~3.4V</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <span className="w-3 h-3 rounded-sm" style={{ background: 'rgba(255,213,0,0.75)', border: '1px solid rgba(255,213,0,1)' }} />
                    <span className="text-bms-textDim">3.4~3.65V</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <span className="w-3 h-3 rounded-sm" style={{ background: 'rgba(255,23,68,0.85)', border: '1px solid rgba(255,23,68,1)' }} />
                    <span className="text-bms-textDim">{'>3.65V'}</span>
                  </div>
                  <div className="flex items-center gap-1 ml-2">
                    <span className="w-3 h-3 rounded-sm animate-blink" style={{ background: 'rgba(255,23,68,0.9)' }} />
                    <span className="text-bms-textDim">温度异常</span>
                  </div>
                </div>
              </div>

              <div className="flex-1 overflow-auto relative">
                <div className="grid gap-1 p-1"
                     style={{ gridTemplateColumns: `repeat(${COLS}, minmax(0, 1fr))` }}
                     onMouseLeave={() => setTooltip(null)}>
                  {cellGrid.map((row, rIdx) =>
                    row.map((cell, cIdx) => {
                      if (!cell) {
                        return (
                          <div
                            key={`empty-${rIdx}-${cIdx}`}
                            className="aspect-[3/4] rounded-sm border border-dashed border-bms-border/20 bg-bms-bg/30"
                          />
                        );
                      }
                      const idNum = parseInt(cell.cellId.replace(/\D/g, ''), 10);
                      const isSelected = selectedCellId === idNum;
                      const tempBad = isTempAbnormal(cell.temperature);
                      return (
                        <div
                          key={cell.cellId}
                          onClick={() => selectCell(isSelected ? null : idNum)}
                          onMouseEnter={(e) => {
                            const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                            const containerRect = (e.currentTarget.parentElement?.parentElement as HTMLElement)?.getBoundingClientRect();
                            setTooltip({
                              cell,
                              x: rect.left - (containerRect?.left || 0) + rect.width / 2,
                              y: rect.top - (containerRect?.top || 0) - 4
                            });
                          }}
                          className={`
                            aspect-[3/4] rounded-sm cursor-pointer transition-all duration-150
                            flex flex-col items-center justify-center p-0.5 text-[8px]
                            hover:scale-105 hover:z-10 relative
                            ${tempBad ? 'animate-blink' : ''}
                            ${isSelected ? 'ring-2 ring-bms-accent shadow-glow-cyan z-20 scale-105' : ''}
                          `}
                          style={{
                            background: getVoltageColor(cell.voltage),
                            border: `1.5px solid ${getVoltageBorder(cell.voltage)}`,
                            boxShadow: isSelected
                              ? '0 0 12px rgba(0,240,255,0.7)'
                              : tempBad
                                ? '0 0 8px rgba(255,23,68,0.8)'
                                : 'inset 0 1px 0 rgba(255,255,255,0.15)'
                          }}
                        >
                          <span className="font-bold text-white/95 leading-none"
                                style={{ fontSize: '8px', textShadow: '0 1px 2px rgba(0,0,0,0.6)' }}>
                            #{idNum}
                          </span>
                          <span className="font-mono text-white leading-tight"
                                style={{ fontSize: '9.5px', textShadow: '0 1px 2px rgba(0,0,0,0.7)', fontWeight: 700 }}>
                            {cell.voltage.toFixed(3)}
                          </span>
                        </div>
                      );
                    })
                  )}
                </div>

                {tooltip && (
                  <div
                    className="absolute z-50 pointer-events-none bg-bms-panel border border-bms-accent/60 rounded-lg shadow-glow-cyan p-2.5 min-w-[170px]"
                    style={{
                      left: tooltip.x,
                      top: tooltip.y,
                      transform: 'translate(-50%, -100%)'
                    }}
                  >
                    <div className="flex items-center justify-between mb-1.5 border-b border-bms-border/50 pb-1">
                      <span className="text-xs font-bold text-bms-accent">
                        Cell #{parseInt(tooltip.cell.cellId.replace(/\D/g, ''), 10)}
                      </span>
                      {isTempAbnormal(tooltip.cell.temperature) && (
                        <AlertTriangle className="w-3.5 h-3.5 text-bms-error" />
                      )}
                    </div>
                    <div className="space-y-0.5 text-[10.5px] font-mono">
                      <div className="flex justify-between gap-3">
                        <span className="text-bms-textDim">电压:</span>
                        <span className="text-bms-text font-semibold">{tooltip.cell.voltage.toFixed(3)} V</span>
                      </div>
                      <div className="flex justify-between gap-3">
                        <span className="text-bms-textDim">温度:</span>
                        <span className={`font-semibold ${isTempAbnormal(tooltip.cell.temperature) ? 'text-bms-error' : 'text-bms-text'}`}>
                          {tooltip.cell.temperature.toFixed(1)} °C
                        </span>
                      </div>
                      <div className="flex justify-between gap-3">
                        <span className="text-bms-textDim">SOC:</span>
                        <span className="text-bms-text">{tooltip.cell.soc.toFixed(1)} %</span>
                      </div>
                      <div className="flex justify-between gap-3">
                        <span className="text-bms-textDim">SOH:</span>
                        <span className="text-bms-text">{tooltip.cell.soh.toFixed(1)} %</span>
                      </div>
                      <div className="flex justify-between gap-3">
                        <span className="text-bms-textDim">内阻:</span>
                        <span className="text-bms-text">{tooltip.cell.internalResistance.toFixed(2)} mΩ</span>
                      </div>
                      <div className="flex justify-between gap-3">
                        <span className="text-bms-textDim">均衡电流:</span>
                        <span className="text-bms-text">{tooltip.cell.balanceCurrent.toFixed(2)} A</span>
                      </div>
                    </div>
                  </div>
                )}
              </div>

              <div className="mt-3 pt-2 border-t border-bms-border/40 grid grid-cols-4 gap-4 shrink-0 text-[11px] font-mono">
                <div>
                  <span className="text-bms-textDim">最高电压:</span>
                  <span className="ml-1.5 text-bms-error font-semibold">
                    {cells.length ? Math.max(...cells.map(c => c.voltage)).toFixed(3) : '0.000'} V
                  </span>
                </div>
                <div>
                  <span className="text-bms-textDim">最低电压:</span>
                  <span className="ml-1.5 text-bms-warn font-semibold">
                    {cells.length ? Math.min(...cells.map(c => c.voltage)).toFixed(3) : '0.000'} V
                  </span>
                </div>
                <div>
                  <span className="text-bms-textDim">电压差:</span>
                  <span className="ml-1.5 text-bms-accent font-semibold">
                    {cells.length
                      ? (Math.max(...cells.map(c => c.voltage)) - Math.min(...cells.map(c => c.voltage))).toFixed(3)
                      : '0.000'} V
                  </span>
                </div>
                <div>
                  <span className="text-bms-textDim">平均温度:</span>
                  <span className="ml-1.5 text-bms-ok font-semibold">
                    {cells.length
                      ? (cells.reduce((s, c) => s + c.temperature, 0) / cells.length).toFixed(1)
                      : '0.0'} °C
                  </span>
                </div>
              </div>
            </div>
          </section>

          <section className="col-span-3 flex flex-col gap-4 min-h-0">
            <div className="flex-1 border border-bms-border/60 rounded-lg bg-gradient-to-br from-bms-panel/60 to-bms-bg/60 p-4 shadow-inner-panel overflow-hidden flex flex-col">
              <div className="flex items-center justify-between mb-3 shrink-0">
                <div className="flex items-center gap-2">
                  <div className="p-1.5 rounded bg-bms-error/10 border border-bms-error/30">
                    <AlertTriangle className="w-4 h-4 text-bms-error" />
                  </div>
                  <h2 className="text-sm font-semibold tracking-wide text-bms-text">告警列表</h2>
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-bms-error/15 border border-bms-error/40 text-bms-error font-mono">
                    {alerts.length}
                  </span>
                </div>
              </div>

              <div className="flex-1 overflow-y-auto space-y-1.5 pr-1">
                {sortedAlerts.length === 0 ? (
                  <div className="h-full flex flex-col items-center justify-center text-bms-textDim text-xs gap-2">
                    <CheckCircle2 className="w-8 h-8 text-bms-ok/50" />
                    <span>暂无告警</span>
                  </div>
                ) : (
                  sortedAlerts.map((alert, idx) => (
                    <div
                      key={`${alert.timestamp}-${alert.cellId}-${idx}`}
                      className={`
                        rounded border p-2 transition-all duration-200
                        ${alert.level === 'critical'
                          ? 'bg-bms-error/8 border-bms-error/50 hover:bg-bms-error/15'
                          : alert.level === 'warning'
                            ? 'bg-bms-warn/8 border-bms-warn/40 hover:bg-bms-warn/15'
                            : 'bg-yellow-400/5 border-yellow-400/30 hover:bg-yellow-400/10'}
                        ${!alert.acknowledged ? 'animate-pulse-slow' : 'opacity-70'}
                      `}
                    >
                      <div className="flex items-start gap-2">
                        <div className="mt-0.5">
                          <AlertLevelIcon level={alert.level} />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between gap-1 mb-0.5">
                            <span className="text-[10px] text-bms-textDim font-mono shrink-0">
                              {formatTime(alert.timestamp)}
                            </span>
                            <LevelBadge level={alert.level} />
                          </div>
                          <div className="flex items-center gap-1 mb-0.5">
                            <Battery className="w-3 h-3 text-bms-accent shrink-0" />
                            <span className="text-xs font-semibold text-bms-accent font-mono">
                              {alert.cellId}
                            </span>
                          </div>
                          <p className="text-[11px] text-bms-text leading-snug break-words">
                            {alert.message}
                          </p>
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </section>
        </div>

        <footer className="shrink-0">
          <div className="border border-bms-border/60 rounded-lg bg-gradient-to-br from-bms-panel/80 to-bms-bg/80 p-3 shadow-inner-panel">
            <div className="flex items-center justify-between gap-6">
              <div className="flex items-center gap-3">
                <button
                  onClick={toggleSimulation}
                  className={`
                    flex items-center gap-2 px-5 py-2 rounded-lg font-semibold text-sm
                    transition-all duration-200 border
                    ${isSimulationRunning
                      ? 'bg-bms-warn/15 border-bms-warn/60 text-bms-warn hover:bg-bms-warn/25 shadow-glow-orange'
                      : 'bg-bms-ok/15 border-bms-ok/60 text-bms-ok hover:bg-bms-ok/25 shadow-glow-green'}
                  `}
                >
                  {isSimulationRunning ? (
                    <><Pause className="w-4 h-4" /> 暂停模拟</>
                  ) : (
                    <><Play className="w-4 h-4" /> 开始模拟</>
                  )}
                </button>

                <button
                  onClick={() => setCharging(!isCharging)}
                  className={`
                    flex items-center gap-2 px-4 py-2 rounded-lg font-semibold text-sm
                    transition-all duration-200 border
                    ${isCharging
                      ? 'bg-bms-accent/15 border-bms-accent/60 text-bms-accent hover:bg-bms-accent/25 shadow-glow-cyan'
                      : 'bg-bms-panel border-bms-border/60 text-bms-textDim hover:text-bms-text hover:border-bms-accent/40'}
                  `}
                >
                  <Zap className="w-4 h-4" /> 充电 {isCharging ? 'ON' : 'OFF'}
                </button>

                <button
                  onClick={() => setBalancing(!isBalancing)}
                  className={`
                    flex items-center gap-2 px-4 py-2 rounded-lg font-semibold text-sm
                    transition-all duration-200 border
                    ${isBalancing
                      ? 'bg-[#7c4dff]/15 border-[#7c4dff]/60 text-[#b388ff] hover:bg-[#7c4dff]/25'
                      : 'bg-bms-panel border-bms-border/60 text-bms-textDim hover:text-bms-text hover:border-[#7c4dff]/40'}
                  `}
                  style={isBalancing ? { boxShadow: '0 0 12px rgba(124,77,255,0.4)' } : undefined}
                >
                  <Repeat className="w-4 h-4" /> 均衡 {isBalancing ? 'ON' : 'OFF'}
                </button>
              </div>

              <div className="flex items-center gap-4">
                <div className="flex items-center gap-2">
                  <span className="text-xs text-bms-textDim">倍速:</span>
                  <div className="flex rounded-lg overflow-hidden border border-bms-border/60">
                    {[1, 2, 5, 10].map(speed => (
                      <button
                        key={speed}
                        onClick={() => setSimulationSpeed(speed)}
                        className={`
                          px-3 py-1.5 text-xs font-mono transition-all duration-150
                          ${simulationSpeed === speed
                            ? 'bg-bms-accent/20 text-bms-accent border-l border-bms-accent/40 shadow-glow-cyan'
                            : 'bg-bms-bg/50 text-bms-textDim hover:text-bms-text hover:bg-bms-panel'}
                          ${speed !== 1 ? 'border-l border-bms-border/40' : ''}
                        `}
                      >
                        {speed}x
                      </button>
                    ))}
                  </div>
                </div>

                <div className="flex items-center gap-6 text-[11px] font-mono">
                  <div className="flex items-center gap-1.5">
                    <Thermometer className="w-3.5 h-3.5 text-bms-warn" />
                    <span className="text-bms-textDim">温度:</span>
                    <span className="text-bms-text font-semibold">{pack.avgTemperature.toFixed(1)}°C</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    {isSimulationRunning ? (
                      <Wifi className="w-3.5 h-3.5 text-bms-ok animate-pulse" />
                    ) : (
                      <WifiOff className="w-3.5 h-3.5 text-bms-textDim" />
                    )}
                    <span className="text-bms-textDim">连接:</span>
                    <span className={`font-semibold ${isSimulationRunning ? 'text-bms-ok' : 'text-bms-textDim'}`}>
                      {isSimulationRunning ? '已连接' : '已断开'}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </footer>
      </div>
    </div>
  );
}
