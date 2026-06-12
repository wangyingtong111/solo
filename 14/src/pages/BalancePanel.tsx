import { useState, useMemo } from 'react';
import ReactECharts from 'echarts-for-react';
import type { EChartsOption } from 'echarts';
import {
  Zap,
  Activity,
  Target,
  Settings,
  PlayCircle,
  StopCircle,
  Clock,
  Hash,
  ArrowRight,
  ArrowLeft,
  Gauge,
  Timer,
  TrendingDown,
  CheckCircle2,
  XCircle
} from 'lucide-react';
import { useBmsStore } from '@/store/bmsStore';

const TARGET_DELTA_MV = 5;

export default function BalancePanel() {
  const {
    cells,
    balanceCommands,
    convergenceSeries,
    isBalancing,
    setBalancing,
    balanceEngine
  } = useBmsStore();

  const currentConfig = balanceEngine.getConfig();

  const [threshold, setThreshold] = useState(currentConfig.balanceThreshold * 1000);
  const [maxCurrent, setMaxCurrent] = useState(currentConfig.maxCurrent);
  const [kp, setKp] = useState(currentConfig.kp);
  const [ki, setKi] = useState(currentConfig.ki);
  const [kd, setKd] = useState(currentConfig.kd);

  const currentDeltaMV = useMemo(() => {
    if (cells.length === 0) return 0;
    const voltages = cells.map(c => c.voltage);
    return (Math.max(...voltages) - Math.min(...voltages)) * 1000;
  }, [cells]);

  const estimatedTime = useMemo(() => {
    const delta = currentDeltaMV / 1000;
    return balanceEngine.estimateConvergenceTime(delta, maxCurrent);
  }, [currentDeltaMV, maxCurrent, balanceEngine]);

  const activeCommandsCount = useMemo(() => {
    return balanceCommands.filter(c => c.current > 0.001).length;
  }, [balanceCommands]);

  const handleApplyParams = () => {
    balanceEngine.setConfig({
      balanceThreshold: threshold / 1000,
      maxCurrent,
      kp,
      ki,
      kd
    });
    useBmsStore.getState().runConvergenceSimulation();
  };

  const toggleBalancing = () => {
    setBalancing(!isBalancing);
    if (!isBalancing) {
      useBmsStore.getState().runConvergenceSimulation();
    }
  };

  const convergenceChartOption = useMemo<EChartsOption>(() => {
    const timeLabels = convergenceSeries.timestamps.map((_, i) => i * 10);
    const deltaMv = convergenceSeries.deltas.map(d => d * 1000);
    const targetLine = new Array(timeLabels.length).fill(TARGET_DELTA_MV);

    const convergeIdx = convergenceSeries.converged
      ? Math.round(convergenceSeries.convergeTime / 10)
      : -1;

    const markPointData = convergeIdx >= 0 && convergeIdx < deltaMv.length
      ? [{
          name: '收敛点',
          coord: [convergeIdx * 10, deltaMv[convergeIdx]],
          value: `${convergenceSeries.convergeTime}min`,
          itemStyle: { color: '#00e676' },
          symbolSize: 14,
          label: {
            show: true,
            formatter: 'Converge\n{c}min',
            position: 'top' as const,
            color: '#00e676',
            fontSize: 11
          }
        }]
      : [];

    return {
      backgroundColor: 'transparent',
      grid: {
        left: 60,
        right: 30,
        top: 50,
        bottom: 40
      },
      legend: {
        data: ['Max Delta', 'Target Line'],
        textStyle: { color: '#8ba3c7', fontSize: 12 },
        top: 8,
        right: 20,
        itemWidth: 18,
        itemHeight: 2
      },
      title: {
        text: '压差收敛曲线',
        textStyle: { color: '#e0f7ff', fontSize: 14, fontWeight: 500 },
        left: 16,
        top: 8
      },
      tooltip: {
        trigger: 'axis',
        backgroundColor: 'rgba(17,24,39,0.95)',
        borderColor: '#1e3a5f',
        borderWidth: 1,
        textStyle: { color: '#e0f7ff', fontSize: 12 },
        formatter: (params: any) => {
          const time = params[0]?.axisValue ?? 0;
          let html = `<div style="font-weight:600;margin-bottom:6px">时间: ${time} min</div>`;
          params.forEach((p: any) => {
            html += `<div style="display:flex;align-items:center;gap:6px">
              <span style="display:inline-block;width:10px;height:2px;background:${p.color}"></span>
              ${p.seriesName}: <b>${p.value?.toFixed?.(2) ?? p.value}</b> mV
            </div>`;
          });
          return html;
        }
      },
      xAxis: {
        type: 'category',
        data: timeLabels,
        name: '时间 (min)',
        nameTextStyle: { color: '#8ba3c7', fontSize: 11, padding: [10, 0, 0, 0] },
        axisLine: { lineStyle: { color: '#1e3a5f' } },
        axisLabel: { color: '#8ba3c7', fontSize: 10 },
        splitLine: { show: false }
      },
      yAxis: {
        type: 'value',
        name: '压差 (mV)',
        nameTextStyle: { color: '#8ba3c7', fontSize: 11 },
        axisLine: { lineStyle: { color: '#1e3a5f' } },
        axisLabel: { color: '#8ba3c7', fontSize: 10 },
        splitLine: { lineStyle: { color: 'rgba(30,58,95,0.3)', type: 'dashed' } }
      },
      series: [
        {
          name: 'Max Delta',
          type: 'line',
          data: deltaMv,
          smooth: true,
          symbol: 'none',
          lineStyle: {
            color: '#00f0ff',
            width: 2.5,
            shadowColor: 'rgba(0,240,255,0.6)',
            shadowBlur: 10
          },
          areaStyle: {
            color: {
              type: 'linear',
              x: 0, y: 0, x2: 0, y2: 1,
              colorStops: [
                { offset: 0, color: 'rgba(0,240,255,0.35)' },
                { offset: 0.5, color: 'rgba(0,136,255,0.15)' },
                { offset: 1, color: 'rgba(0,136,255,0)' }
              ]
            }
          },
          markPoint: {
            symbol: 'circle',
            data: markPointData,
            z: 10
          }
        },
        {
          name: 'Target Line',
          type: 'line',
          data: targetLine,
          symbol: 'none',
          lineStyle: {
            color: '#00e676',
            width: 1.5,
            type: 'dashed',
            shadowColor: 'rgba(0,230,118,0.4)',
            shadowBlur: 6
          }
        }
      ]
    };
  }, [convergenceSeries]);

  const currentChartOption = useMemo<EChartsOption>(() => {
    const cellIds = balanceCommands.map(c => c.cellId.replace('C', ''));
    const currents = balanceCommands.map(c =>
      c.direction === 'charge' ? c.current : -c.current
    );

    return {
      backgroundColor: 'transparent',
      grid: {
        left: 50,
        right: 30,
        top: 50,
        bottom: 30
      },
      title: {
        text: '均衡电流指令',
        textStyle: { color: '#e0f7ff', fontSize: 14, fontWeight: 500 },
        left: 16,
        top: 8
      },
      tooltip: {
        trigger: 'axis',
        backgroundColor: 'rgba(17,24,39,0.95)',
        borderColor: '#1e3a5f',
        borderWidth: 1,
        textStyle: { color: '#e0f7ff', fontSize: 12 },
        axisPointer: { type: 'shadow' },
        formatter: (params: any) => {
          const p = params[0];
          if (!p) return '';
          const cmd = balanceCommands[p.dataIndex];
          const dir = cmd.direction === 'charge' ? '充电 (+)' : '放电 (-)';
          const color = cmd.direction === 'charge' ? '#0088ff' : '#ff8c00';
          return `<div style="font-weight:600;margin-bottom:6px">Cell ${cmd.cellId}</div>
            <div style="display:flex;align-items:center;gap:6px">
              <span style="display:inline-block;width:10px;height:2px;background:${color}"></span>
              ${dir}: <b>${cmd.current.toFixed(3)}</b> A
            </div>
            <div style="margin-top:4px;color:#8ba3c7">PWM: ${cmd.pwmDuty.toFixed(1)}%</div>`;
        }
      },
      xAxis: {
        type: 'value',
        name: '电流 (A)',
        nameTextStyle: { color: '#8ba3c7', fontSize: 11 },
        axisLine: { lineStyle: { color: '#1e3a5f' } },
        axisLabel: { color: '#8ba3c7', fontSize: 10 },
        splitLine: { lineStyle: { color: 'rgba(30,58,95,0.3)', type: 'dashed' } },
        min: -5,
        max: 5
      },
      yAxis: {
        type: 'category',
        data: cellIds,
        inverse: true,
        axisLine: { lineStyle: { color: '#1e3a5f' } },
        axisLabel: {
          color: '#8ba3c7',
          fontSize: 9,
          interval: 19,
          align: 'right'
        },
        splitLine: { show: false }
      },
      series: [
        {
          type: 'bar',
          data: currents.map(v => ({
            value: v,
            itemStyle: {
              color: v >= 0
                ? {
                    type: 'linear', x: 0, y: 0, x2: 1, y2: 0,
                    colorStops: [
                      { offset: 0, color: 'rgba(0,136,255,0.15)' },
                      { offset: 1, color: '#0088ff' }
                    ]
                  }
                : {
                    type: 'linear', x: 1, y: 0, x2: 0, y2: 0,
                    colorStops: [
                      { offset: 0, color: 'rgba(255,140,0,0.15)' },
                      { offset: 1, color: '#ff8c00' }
                    ]
                  },
              borderRadius: v >= 0 ? [0, 3, 3, 0] : [3, 0, 0, 3]
            }
          })),
          barWidth: '70%'
        }
      ]
    };
  }, [balanceCommands]);

  const rowBgColor = (current: number, direction: 'charge' | 'discharge') => {
    const intensity = Math.min(1, current / maxCurrent);
    if (current < 0.001) return undefined;
    if (direction === 'charge') {
      const alpha = 0.08 + intensity * 0.22;
      return `rgba(0,136,255,${alpha})`;
    }
    const alpha = 0.08 + intensity * 0.22;
    return `rgba(255,140,0,${alpha})`;
  };

  return (
    <div className="h-screen w-full flex flex-col bg-bms-bg text-bms-text font-sans overflow-hidden">
      {/* ===== 顶部控制区 30% ===== */}
      <div className="h-[30vh] min-h-[260px] w-full flex gap-3 p-3">
        {/* 左侧控制卡片 */}
        <div className="flex-1 rounded-xl bg-bms-panel border border-bms-border shadow-inner-panel p-4 flex flex-col">
          <div className="flex items-center gap-2 mb-3 pb-2 border-b border-bms-border/60">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-cyan-500/20 to-blue-500/20 flex items-center justify-center">
              <Zap className="w-4 h-4 text-bms-accent" />
            </div>
            <h2 className="text-base font-semibold text-bms-text">均衡控制系统</h2>
            <span className={`ml-auto flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${
              isBalancing
                ? 'bg-green-500/15 text-bms-ok border border-bms-ok/30'
                : 'bg-red-500/15 text-bms-error border border-bms-error/30'
            }`}>
              <span className={`w-1.5 h-1.5 rounded-full ${
                isBalancing ? 'bg-bms-ok animate-blink' : 'bg-bms-error'
              }`} />
              {isBalancing ? 'Balancing' : 'Stop'}
            </span>
          </div>

          <div className="flex items-center gap-5 flex-1">
            {/* 大按钮 */}
            <button
              onClick={toggleBalancing}
              className={`relative w-32 h-32 rounded-2xl flex flex-col items-center justify-center gap-2 transition-all duration-300 group ${
                isBalancing
                  ? 'bg-gradient-to-br from-red-500/20 to-red-700/10 border-2 border-bms-error/60 hover:border-bms-error'
                  : 'bg-gradient-to-br from-green-500/20 to-green-700/10 border-2 border-bms-ok/60 hover:border-bms-ok'
              }`}
              style={{
                boxShadow: isBalancing
                  ? '0 0 25px rgba(255,23,68,0.35), inset 0 0 30px rgba(255,23,68,0.1)'
                  : '0 0 25px rgba(0,230,118,0.35), inset 0 0 30px rgba(0,230,118,0.1)'
              }}
            >
              {isBalancing ? (
                <StopCircle className="w-10 h-10 text-bms-error group-hover:scale-110 transition-transform" strokeWidth={1.8} />
              ) : (
                <PlayCircle className="w-10 h-10 text-bms-ok group-hover:scale-110 transition-transform" strokeWidth={1.8} />
              )}
              <span className={`text-sm font-semibold ${isBalancing ? 'text-bms-error' : 'text-bms-ok'}`}>
                {isBalancing ? '停止均衡' : '启动均衡'}
              </span>
              {isBalancing && (
                <span className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-bms-error/80 animate-pulse-slow" />
              )}
            </button>

            {/* 4个指标 */}
            <div className="grid grid-cols-2 gap-3 flex-1">
              <div className="rounded-lg bg-bms-bg/60 border border-bms-border/50 p-3 flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-cyan-500/10 flex items-center justify-center">
                  <Activity className="w-5 h-5 text-bms-accent" />
                </div>
                <div className="flex flex-col">
                  <span className="text-[11px] text-bms-textDim mb-0.5">当前压差</span>
                  <span className="text-xl font-bold font-mono text-bms-accent">
                    {currentDeltaMV.toFixed(1)}<span className="text-xs ml-1 text-bms-textDim font-normal">mV</span>
                  </span>
                </div>
              </div>

              <div className="rounded-lg bg-bms-bg/60 border border-bms-border/50 p-3 flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-green-500/10 flex items-center justify-center">
                  <Target className="w-5 h-5 text-bms-ok" />
                </div>
                <div className="flex flex-col">
                  <span className="text-[11px] text-bms-textDim mb-0.5">目标压差</span>
                  <span className="text-xl font-bold font-mono text-bms-ok">
                    {TARGET_DELTA_MV}<span className="text-xs ml-1 text-bms-textDim font-normal">mV</span>
                  </span>
                </div>
              </div>

              <div className="rounded-lg bg-bms-bg/60 border border-bms-border/50 p-3 flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-orange-500/10 flex items-center justify-center">
                  <Timer className="w-5 h-5 text-bms-warn" />
                </div>
                <div className="flex flex-col">
                  <span className="text-[11px] text-bms-textDim mb-0.5">预计收敛</span>
                  <span className="text-xl font-bold font-mono text-bms-warn">
                    {estimatedTime === Infinity ? '∞' : estimatedTime.toFixed(0)}
                    <span className="text-xs ml-1 text-bms-textDim font-normal">min</span>
                  </span>
                </div>
              </div>

              <div className="rounded-lg bg-bms-bg/60 border border-bms-border/50 p-3 flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-blue-500/10 flex items-center justify-center">
                  <Hash className="w-5 h-5 text-bms-accent2" />
                </div>
                <div className="flex flex-col">
                  <span className="text-[11px] text-bms-textDim mb-0.5">执行指令数</span>
                  <span className="text-xl font-bold font-mono text-bms-accent2">
                    {activeCommandsCount}<span className="text-xs ml-1 text-bms-textDim font-normal">/{balanceCommands.length}</span>
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* 右侧参数调节 */}
        <div className="w-[420px] rounded-xl bg-bms-panel border border-bms-border shadow-inner-panel p-4 flex flex-col">
          <div className="flex items-center gap-2 mb-3 pb-2 border-b border-bms-border/60">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-blue-500/20 to-purple-500/20 flex items-center justify-center">
              <Settings className="w-4 h-4 text-bms-accent2" />
            </div>
            <h2 className="text-base font-semibold text-bms-text">参数调节</h2>
          </div>

          <div className="flex-1 space-y-2.5 overflow-y-auto pr-1">
            <div>
              <div className="flex justify-between items-center mb-1.5">
                <label className="text-xs text-bms-textDim flex items-center gap-1.5">
                  <Gauge className="w-3.5 h-3.5 text-bms-accent" />
                  均衡阈值
                </label>
                <span className="text-xs font-mono text-bms-accent bg-cyan-500/10 px-2 py-0.5 rounded">
                  {threshold.toFixed(0)} mV
                </span>
              </div>
              <input
                type="range"
                min={5}
                max={50}
                step={1}
                value={threshold}
                onChange={e => setThreshold(Number(e.target.value))}
                className="w-full h-1.5 rounded-full appearance-none cursor-pointer bg-bms-border accent-cyan-400"
              />
              <div className="flex justify-between text-[10px] text-bms-textDim/70 mt-1">
                <span>5mV</span><span>27.5mV</span><span>50mV</span>
              </div>
            </div>

            <div>
              <div className="flex justify-between items-center mb-1.5">
                <label className="text-xs text-bms-textDim flex items-center gap-1.5">
                  <Zap className="w-3.5 h-3.5 text-bms-warn" />
                  最大均衡电流
                </label>
                <span className="text-xs font-mono text-bms-warn bg-orange-500/10 px-2 py-0.5 rounded">
                  {maxCurrent.toFixed(1)} A
                </span>
              </div>
              <input
                type="range"
                min={0.5}
                max={5}
                step={0.1}
                value={maxCurrent}
                onChange={e => setMaxCurrent(Number(e.target.value))}
                className="w-full h-1.5 rounded-full appearance-none cursor-pointer bg-bms-border accent-orange-400"
              />
              <div className="flex justify-between text-[10px] text-bms-textDim/70 mt-1">
                <span>0.5A</span><span>2.75A</span><span>5A</span>
              </div>
            </div>

            <div className="pt-1">
              <label className="text-xs text-bms-textDim flex items-center gap-1.5 mb-2">
                <TrendingDown className="w-3.5 h-3.5 text-bms-accent2" />
                PID 控制器参数
              </label>
              <div className="grid grid-cols-3 gap-2">
                <div className="rounded-lg bg-bms-bg/60 border border-bms-border/50 p-2">
                  <div className="text-[10px] text-bms-textDim mb-1">Kp (比例)</div>
                  <input
                    type="number"
                    step={0.01}
                    value={kp}
                    onChange={e => setKp(Number(e.target.value))}
                    className="w-full bg-transparent text-sm font-mono text-bms-accent2 focus:outline-none border-b border-bms-border/50 focus:border-bms-accent2 transition-colors"
                  />
                </div>
                <div className="rounded-lg bg-bms-bg/60 border border-bms-border/50 p-2">
                  <div className="text-[10px] text-bms-textDim mb-1">Ki (积分)</div>
                  <input
                    type="number"
                    step={0.01}
                    value={ki}
                    onChange={e => setKi(Number(e.target.value))}
                    className="w-full bg-transparent text-sm font-mono text-bms-accent2 focus:outline-none border-b border-bms-border/50 focus:border-bms-accent2 transition-colors"
                  />
                </div>
                <div className="rounded-lg bg-bms-bg/60 border border-bms-border/50 p-2">
                  <div className="text-[10px] text-bms-textDim mb-1">Kd (微分)</div>
                  <input
                    type="number"
                    step={0.01}
                    value={kd}
                    onChange={e => setKd(Number(e.target.value))}
                    className="w-full bg-transparent text-sm font-mono text-bms-accent2 focus:outline-none border-b border-bms-border/50 focus:border-bms-accent2 transition-colors"
                  />
                </div>
              </div>
            </div>
          </div>

          <button
            onClick={handleApplyParams}
            className="mt-3 w-full py-2.5 rounded-lg bg-gradient-to-r from-cyan-500/20 via-blue-500/20 to-cyan-500/20 border border-bms-accent/40 text-bms-accent text-sm font-semibold hover:border-bms-accent hover:shadow-glow-cyan transition-all duration-300 flex items-center justify-center gap-2"
          >
            <CheckCircle2 className="w-4 h-4" />
            应用参数
          </button>
        </div>
      </div>

      {/* ===== 中部图表区 ===== */}
      <div className="flex-1 min-h-0 w-full flex gap-3 px-3">
        {/* 左下 55% - 压差收敛曲线 */}
        <div className="w-[55%] rounded-xl bg-bms-panel border border-bms-border shadow-inner-panel p-2 flex flex-col">
          <ReactECharts
            option={convergenceChartOption}
            style={{ height: '100%', width: '100%' }}
            opts={{ renderer: 'canvas' }}
          />
        </div>

        {/* 右下 45% - 均衡电流条形图 */}
        <div className="flex-1 rounded-xl bg-bms-panel border border-bms-border shadow-inner-panel p-2 flex flex-col">
          <ReactECharts
            option={currentChartOption}
            style={{ height: '100%', width: '100%' }}
            opts={{ renderer: 'canvas' }}
          />
        </div>
      </div>

      {/* ===== 底部表格 ===== */}
      <div className="h-[28vh] min-h-[200px] w-full p-3 pt-0">
        <div className="h-full rounded-xl bg-bms-panel border border-bms-border shadow-inner-panel flex flex-col overflow-hidden">
          <div className="flex items-center justify-between px-4 py-2.5 border-b border-bms-border/60 bg-bms-bg/40">
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-md bg-gradient-to-br from-blue-500/20 to-cyan-500/20 flex items-center justify-center">
                <Clock className="w-3.5 h-3.5 text-bms-accent2" />
              </div>
              <h3 className="text-sm font-semibold text-bms-text">均衡指令详情</h3>
              <span className="text-xs text-bms-textDim ml-1">
                (共 {balanceCommands.length} 串)
              </span>
            </div>
            <div className="flex items-center gap-4 text-[11px] text-bms-textDim">
              <div className="flex items-center gap-1.5">
                <span className="w-3 h-3 rounded-sm" style={{ background: 'rgba(0,136,255,0.3)' }} />
                <span>Charge 充电</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="w-3 h-3 rounded-sm" style={{ background: 'rgba(255,140,0,0.3)' }} />
                <span>Discharge 放电</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="w-3 h-3 rounded-sm bg-bms-bg/60 border border-bms-border/50" />
                <span>Idle 空闲</span>
              </div>
            </div>
          </div>

          <div className="overflow-y-auto flex-1 text-xs">
            <table className="w-full">
              <thead className="sticky top-0 bg-bms-bg/90 backdrop-blur-sm z-10">
                <tr className="text-[11px] text-bms-textDim border-b border-bms-border/60">
                  <th className="text-left py-2 px-4 font-medium">Cell ID</th>
                  <th className="text-right py-2 px-4 font-medium">电压 (V)</th>
                  <th className="text-right py-2 px-4 font-medium">均衡电流 (A)</th>
                  <th className="text-center py-2 px-4 font-medium">方向</th>
                  <th className="text-right py-2 px-4 font-medium">PWM 占空比 (%)</th>
                  <th className="text-center py-2 px-4 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {balanceCommands.map((cmd, idx) => {
                  const cell = cells[idx];
                  const active = cmd.current > 0.001;
                  const bg = rowBgColor(cmd.current, cmd.direction);
                  return (
                    <tr
                      key={cmd.cellId}
                      className="border-b border-bms-border/20 hover:bg-bms-accent/5 transition-colors"
                      style={{ backgroundColor: bg }}
                    >
                      <td className="py-1.5 px-4 font-mono text-bms-text font-medium">
                        {cmd.cellId}
                      </td>
                      <td className="py-1.5 px-4 text-right font-mono text-bms-textDim">
                        {cell?.voltage.toFixed(4) ?? '--'}
                      </td>
                      <td className={`py-1.5 px-4 text-right font-mono font-semibold ${
                        !active ? 'text-bms-textDim/60'
                          : cmd.direction === 'charge' ? 'text-bms-accent2'
                          : 'text-bms-warn'
                      }`}>
                        {cmd.current.toFixed(4)}
                      </td>
                      <td className="py-1.5 px-4 text-center">
                        {!active ? (
                          <span className="text-bms-textDim/50 text-[11px]">--</span>
                        ) : cmd.direction === 'charge' ? (
                          <span className="inline-flex items-center gap-1 text-bms-accent2 text-[11px] font-medium">
                            <ArrowRight className="w-3 h-3" /> CHARGE
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-bms-warn text-[11px] font-medium">
                            <ArrowLeft className="w-3 h-3" /> DISCHG
                          </span>
                        )}
                      </td>
                      <td className="py-1.5 px-4 text-right font-mono text-bms-textDim">
                        {cmd.pwmDuty.toFixed(1)}
                      </td>
                      <td className="py-1.5 px-4 text-center">
                        {active ? (
                          <span className="inline-flex items-center gap-1 text-bms-ok text-[11px]">
                            <span className="w-1.5 h-1.5 rounded-full bg-bms-ok animate-blink" />
                            ACTIVE
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-bms-textDim/50 text-[11px]">
                            <XCircle className="w-3 h-3" />
                            IDLE
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
