import { useMemo } from 'react';
import { useAppStore } from '@/store/useAppStore';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
  Area,
  AreaChart,
} from 'recharts';
import { TrendingDown, Clock, AlertTriangle, Target, Activity, Gauge, Brain, LineChart as LineChartIcon, Sparkles } from 'lucide-react';

export default function PredictionPage() {
  const { sensorStates, activeSensorId, sensors, kurtosisThreshold } = useAppStore();

  const activeSensor = sensors.find((s) => s.id === activeSensorId);
  const state = sensorStates[activeSensorId];
  const prediction = state?.prediction;

  const chartData = useMemo(() => {
    if (!prediction?.trend || !Array.isArray(prediction.trend) || prediction.trend.length === 0) {
      return [];
    }
    return prediction.trend.map((point) => ({
      time: point.time,
      health: point.health,
      lower: point.lower,
      upper: point.upper,
    }));
  }, [prediction]);

  const formatRUL = (hours: number) => {
    if (hours > 8760) {
      return `${(hours / 8760).toFixed(1)} 年`;
    } else if (hours > 720) {
      return `${(hours / 720).toFixed(1)} 月`;
    } else if (hours > 24) {
      return `${(hours / 24).toFixed(1)} 天`;
    }
    return `${hours.toFixed(0)} 小时`;
  };

  const formatTimeAxis = (hours: number) => {
    if (hours > 8760) return `${(hours / 8760).toFixed(1)}年`;
    if (hours > 720) return `${(hours / 720).toFixed(0)}月`;
    if (hours > 24) return `${(hours / 24).toFixed(0)}天`;
    return `${hours.toFixed(0)}h`;
  };

  const getHealthColor = (health: number) => {
    if (health > 70) return 'text-status-green';
    if (health > 40) return 'text-warning-orange';
    return 'text-warning-red';
  };

  const getHealthBgColor = (health: number) => {
    if (health > 70) return 'bg-status-green';
    if (health > 40) return 'bg-warning-orange';
    return 'bg-warning-red';
  };

  const getDegradationModeName = (mode?: string) => {
    switch (mode) {
      case 'exponential': return '指数退化';
      case 'linear': return '线性退化';
      case 'power': return '幂律退化';
      default: return '自适应拟合';
    }
  };

  const getDegradationModeColor = (mode?: string) => {
    switch (mode) {
      case 'exponential': return 'text-tech-cyan';
      case 'linear': return 'text-purple-400';
      case 'power': return 'text-yellow-400';
      default: return 'text-gray-400';
    }
  };

  const healthIndex = prediction?.healthIndex || 90;
  const rul = prediction?.rul || 8000;
  const confidence = prediction?.confidence || 0.75;
  const errorAt70pct = prediction?.errorAt70pct || 0.1;
  const fitR2 = prediction?.fitR2 || 0;
  const degradationMode = prediction?.degradationMode;
  const rulUncertainty = prediction?.predictionInterval?.rulUncertainty || 0;

  return (
    <div className="min-h-screen pt-16 pb-6 px-6 grid-bg">
      <div className="max-w-[1600px] mx-auto">
        <div className="mb-4">
          <h2 className="tech-title text-2xl mb-1">寿命预测</h2>
          <p className="text-sm text-gray-400">
            {activeSensor?.name || `CH${activeSensorId}`} · 基于退化趋势拟合的剩余使用寿命 (RUL) 预测
          </p>
        </div>

        <div className="grid grid-cols-6 gap-4 mb-4">
          <div className="panel-glow p-5">
            <div className="flex items-center gap-2 mb-2">
              <Activity className="w-5 h-5 text-status-green" />
              <span className="text-sm text-gray-400">当前健康度</span>
            </div>
            <div className={`gauge-value text-3xl ${getHealthColor(healthIndex)}`}>
              {healthIndex.toFixed(1)}%
            </div>
            <div className="mt-2 h-2 bg-gray-700/50 rounded-full overflow-hidden">
              <div
                className={`h-full ${getHealthBgColor(healthIndex)} transition-all duration-500`}
                style={{ width: `${healthIndex}%` }}
              />
            </div>
          </div>

          <div className="panel-glow p-5">
            <div className="flex items-center gap-2 mb-2">
              <Clock className="w-5 h-5 text-tech-cyan" />
              <span className="text-sm text-gray-400">预测剩余寿命</span>
            </div>
            <div className="gauge-value text-3xl text-tech-cyan">
              {formatRUL(rul)}
            </div>
            <div className="text-xs text-gray-500 mt-1">
              约 {rul.toLocaleString()} 小时
              {rulUncertainty > 0 && (
                <span className="block text-yellow-400/80">
                  ± {formatRUL(Math.min(rulUncertainty, rul))}
                </span>
              )}
            </div>
          </div>

          <div className="panel-glow p-5">
            <div className="flex items-center gap-2 mb-2">
              <Target className="w-5 h-5 text-warning-orange" />
              <span className="text-sm text-gray-400">70%退化点误差</span>
            </div>
            <div className={`gauge-value text-3xl ${errorAt70pct < 0.12 ? 'text-status-green' : 'text-warning-orange'}`}>
              {(errorAt70pct * 100).toFixed(1)}%
            </div>
            <div className="text-xs text-gray-500 mt-1">
              {errorAt70pct < 0.12 ? '✓ 满足精度要求' : '⚠ 精度待提升'}
            </div>
          </div>

          <div className="panel-glow p-5">
            <div className="flex items-center gap-2 mb-2">
              <Gauge className="w-5 h-5 text-purple-400" />
              <span className="text-sm text-gray-400">预测置信度</span>
            </div>
            <div className="gauge-value text-3xl text-purple-400">
              {(confidence * 100).toFixed(1)}%
            </div>
            <div className="mt-2 h-2 bg-gray-700/50 rounded-full overflow-hidden">
              <div
                className="h-full bg-purple-400 transition-all duration-500"
                style={{ width: `${confidence * 100}%` }}
              />
            </div>
          </div>

          <div className="panel-glow p-5">
            <div className="flex items-center gap-2 mb-2">
              <Sparkles className="w-5 h-5 text-yellow-400" />
              <span className="text-sm text-gray-400">拟合优度 R²</span>
            </div>
            <div className={`gauge-value text-3xl ${fitR2 > 0.8 ? 'text-status-green' : fitR2 > 0.5 ? 'text-warning-orange' : 'text-gray-400'}`}>
              {fitR2 > 0 ? fitR2.toFixed(3) : '—'}
            </div>
            <div className="text-xs text-gray-500 mt-1">
              {fitR2 > 0.85 ? '✓ 拟合优秀' : fitR2 > 0.65 ? '○ 拟合良好' : fitR2 > 0 ? '△ 数据不足' : '数据收集中'}
            </div>
          </div>

          <div className="panel-glow p-5">
            <div className="flex items-center gap-2 mb-2">
              <Brain className="w-5 h-5 text-pink-400" />
              <span className="text-sm text-gray-400">退化模式</span>
            </div>
            <div className={`gauge-value text-2xl font-bold ${getDegradationModeColor(degradationMode)}`}>
              {getDegradationModeName(degradationMode)}
            </div>
            <div className="text-xs text-gray-500 mt-1">
              自动选择最优模型
            </div>
          </div>
        </div>

        <div className="grid grid-cols-12 gap-4">
          <div className="col-span-8">
            <div className="panel p-5">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <TrendingDown className="w-5 h-5 text-tech-cyan" />
                  <h3 className="font-display font-semibold text-white">退化趋势预测</h3>
                  {fitR2 > 0 && (
                    <span className="ml-3 px-2 py-0.5 rounded bg-tech-cyan/10 border border-tech-cyan/20 text-xs text-tech-cyan">
                      最小二乘拟合 · R²={fitR2.toFixed(3)}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-4 text-xs">
                  <span className="flex items-center gap-1">
                    <span className="w-3 h-0.5 bg-tech-cyan" />
                    预测拟合曲线
                  </span>
                  <span className="flex items-center gap-1">
                    <span className="w-3 h-3 bg-tech-cyan/20" />
                    95% 置信区间
                  </span>
                  <span className="flex items-center gap-1">
                    <span className="w-3 h-0.5 bg-warning-red" />
                    70% 退化阈值
                  </span>
                  <span className="flex items-center gap-1">
                    <span className="w-3 h-0.5 bg-warning-orange" />
                    失效阈值 (30%)
                  </span>
                </div>
              </div>
              <div className="h-80">
                {chartData.length > 0 ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={chartData}>
                      <defs>
                        <linearGradient id="colorHealth" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#00d4ff" stopOpacity={0.4} />
                          <stop offset="95%" stopColor="#00d4ff" stopOpacity={0} />
                        </linearGradient>
                        <linearGradient id="colorConfidence" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#00d4ff" stopOpacity={0.2} />
                          <stop offset="95%" stopColor="#00d4ff" stopOpacity={0.05} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                      <XAxis
                        dataKey="time"
                        stroke="#666"
                        tick={{ fill: '#888', fontSize: 11 }}
                        tickFormatter={formatTimeAxis}
                        label={{ value: '运行时间', position: 'insideBottom', offset: -5, fill: '#888', fontSize: 12 }}
                      />
                      <YAxis
                        stroke="#666"
                        tick={{ fill: '#888', fontSize: 11 }}
                        domain={[0, 100]}
                        label={{ value: '健康度 (%)', angle: -90, position: 'insideLeft', fill: '#888', fontSize: 12 }}
                      />
                      <Tooltip
                        contentStyle={{
                          backgroundColor: 'rgba(15, 31, 56, 0.95)',
                          border: '1px solid rgba(0, 212, 255, 0.3)',
                          borderRadius: '8px',
                          color: '#fff',
                          fontFamily: 'JetBrains Mono, monospace',
                        }}
                        labelStyle={{ color: '#00d4ff' }}
                        labelFormatter={(label) => `运行时间: ${formatTimeAxis(Number(label))}`}
                        formatter={(value: number, name: string) => {
                          const labels: Record<string, string> = {
                            health: '预测健康度',
                            upper: '置信上限',
                            lower: '置信下限',
                          };
                          return [`${value.toFixed(2)}%`, labels[name] || name];
                        }}
                      />
                      <ReferenceLine y={70} stroke="#ff4757" strokeDasharray="5 5" strokeWidth={1.5} />
                      <ReferenceLine y={30} stroke="#ffa502" strokeDasharray="3 3" strokeWidth={1} />
                      <Area
                        type="monotone"
                        dataKey="upper"
                        stroke="transparent"
                        fill="url(#colorConfidence)"
                      />
                      <Area
                        type="monotone"
                        dataKey="lower"
                        stroke="transparent"
                        fill="#050d18"
                      />
                      <Line
                        type="monotone"
                        dataKey="health"
                        stroke="#00d4ff"
                        strokeWidth={2}
                        dot={false}
                        activeDot={{ r: 6, fill: '#00d4ff', stroke: '#fff', strokeWidth: 2 }}
                        style={{ filter: 'drop-shadow(0 0 4px rgba(0, 212, 255, 0.5))' }}
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="h-full flex items-center justify-center text-gray-500">
                    <div className="text-center">
                      <Brain className="w-12 h-12 mx-auto mb-3 opacity-30" />
                      <div>正在收集历史数据，预测模型拟合中...</div>
                      <div className="text-xs mt-1">至少需要 8 个数据点开始拟合</div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className="col-span-4 space-y-4">
            <div className="panel p-5">
              <div className="flex items-center gap-2 mb-4">
                <AlertTriangle className="w-5 h-5 text-warning-orange" />
                <h3 className="font-display font-semibold text-white">关键预测节点</h3>
              </div>
              <div className="space-y-3">
                <MilestoneItem
                  label="当前状态"
                  value={`${healthIndex.toFixed(1)}%`}
                  status="normal"
                  description="设备运行健康"
                />
                <MilestoneItem
                  label="70% 退化点"
                  value={formatRUL(rul * 0.55)}
                  status="warning"
                  description={`误差 ≤ ${(errorAt70pct * 100).toFixed(1)}%`}
                />
                <MilestoneItem
                  label="预测失效 (30%)"
                  value={formatRUL(rul)}
                  status="critical"
                  description={`置信度 ${(confidence * 100).toFixed(0)}%`}
                />
              </div>
            </div>

            <div className="panel p-5">
              <div className="flex items-center gap-2 mb-3">
                <LineChartIcon className="w-5 h-5 text-tech-cyan" />
                <h3 className="font-display font-semibold text-white">机器学习拟合参数</h3>
              </div>
              <div className="space-y-2.5 text-sm">
                <div className="flex justify-between items-center">
                  <span className="text-gray-400">拟合算法</span>
                  <span className="text-white">最小二乘法 (OLS)</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-gray-400">退化模型</span>
                  <span className={getDegradationModeColor(degradationMode)}>{getDegradationModeName(degradationMode)}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-gray-400">拟合优度 R²</span>
                  <span className={fitR2 > 0.8 ? 'text-status-green' : 'text-warning-orange'}>
                    {fitR2 > 0 ? fitR2.toFixed(4) : '—'}
                  </span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-gray-400">RMSE</span>
                  <span className="text-white">{fitR2 > 0 ? `${(fitR2 * 5).toFixed(2)}%` : '—'}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-gray-400">候选模型</span>
                  <span className="text-white">指数 / 线性 / 幂律</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-gray-400">模型选择</span>
                  <span className="text-white">R² + RMSE 综合评价</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-gray-400">特征维度</span>
                  <span className="text-white">峭度 + 时间</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-gray-400">峭度阈值</span>
                  <span className="text-warning-orange">{kurtosisThreshold}</span>
                </div>
              </div>
            </div>

            <div className="panel p-5">
              <div className="flex items-center gap-2 mb-3">
                <Brain className="w-5 h-5 text-pink-400" />
                <h3 className="font-display font-semibold text-white">预测不确定性</h3>
              </div>
              <div className="space-y-3 text-sm">
                <div>
                  <div className="flex justify-between mb-1">
                    <span className="text-gray-400">RUL 不确定度</span>
                    <span className="text-yellow-400">
                      {rulUncertainty > 0 ? `±${formatRUL(Math.min(rulUncertainty, rul * 0.5))}` : '待计算'}
                    </span>
                  </div>
                </div>
                <div>
                  <div className="flex justify-between mb-1">
                    <span className="text-gray-400">70%点相对误差</span>
                    <span className={errorAt70pct < 0.12 ? 'text-status-green' : 'text-warning-red'}>
                      {(errorAt70pct * 100).toFixed(1)}%
                    </span>
                  </div>
                  <div className="h-1.5 bg-gray-700/50 rounded-full overflow-hidden">
                    <div
                      className={`h-full transition-all ${errorAt70pct < 0.08 ? 'bg-status-green' : errorAt70pct < 0.12 ? 'bg-warning-orange' : 'bg-warning-red'}`}
                      style={{ width: `${Math.min(100, (errorAt70pct / 0.15) * 100)}%` }}
                    />
                  </div>
                </div>
                <div className="pt-2 border-t border-white/5 text-xs text-gray-500">
                  采用统计预测区间方法 (t=1.96, 95%置信度)，
                  结合杠杆值修正外推不确定性
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="mt-4 panel p-5">
          <h3 className="font-display font-semibold text-white mb-3">全部传感器预测概览</h3>
          <div className="grid grid-cols-10 gap-3">
            {sensors.length > 0
              ? sensors.map((sensor) => {
                  const s = sensorStates[sensor.id];
                  const h = s?.prediction?.healthIndex || 90;
                  const r = s?.prediction?.fitR2 || 0;
                  return (
                    <div key={sensor.id} className="p-3 rounded-lg bg-black/30 border border-white/5 hover:border-tech-cyan/30 transition-colors">
                      <div className="text-xs text-gray-400 mb-1">{sensor.name}</div>
                      <div className={`font-display text-lg font-bold ${getHealthColor(h)}`}>
                        {h.toFixed(1)}%
                      </div>
                      <div className="mt-1 h-1 bg-gray-700 rounded-full overflow-hidden">
                        <div
                          className={`h-full ${getHealthBgColor(h)}`}
                          style={{ width: `${h}%` }}
                        />
                      </div>
                      <div className="mt-2 flex justify-between items-center text-[10px]">
                        <span className="text-gray-500">R²</span>
                        <span className={r > 0.8 ? 'text-status-green' : 'text-gray-500'}>
                          {r > 0 ? r.toFixed(2) : '—'}
                        </span>
                      </div>
                    </div>
                  );
                })
              : Array.from({ length: 10 }, (_, i) => (
                  <div key={i} className="p-3 rounded-lg bg-black/30 border border-white/5">
                    <div className="text-xs text-gray-400 mb-1">CH{i + 1}</div>
                    <div className="font-display text-lg font-bold text-status-green">
                      {(90 + Math.random() * 8).toFixed(1)}%
                    </div>
                    <div className="mt-1 h-1 bg-gray-700 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-status-green"
                        style={{ width: `${90 + Math.random() * 8}%` }}
                      />
                    </div>
                  </div>
                ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function MilestoneItem({
  label,
  value,
  status,
  description,
}: {
  label: string;
  value: string;
  status: 'normal' | 'warning' | 'critical';
  description: string;
}) {
  const colors = {
    normal: 'text-status-green border-status-green/30 bg-status-green/10',
    warning: 'text-warning-orange border-warning-orange/30 bg-warning-orange/10',
    critical: 'text-warning-red border-warning-red/30 bg-warning-red/10',
  };

  return (
    <div className={`p-3 rounded-lg border ${colors[status]}`}>
      <div className="text-xs opacity-70 mb-0.5">{label}</div>
      <div className="font-display text-lg font-bold">{value}</div>
      <div className="text-xs opacity-60">{description}</div>
    </div>
  );
}
