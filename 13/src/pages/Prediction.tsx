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
import { TrendingDown, Clock, AlertTriangle, Target, Activity, Gauge } from 'lucide-react';

export default function PredictionPage() {
  const { sensorStates, activeSensorId, sensors, kurtosisThreshold } = useAppStore();

  const activeSensor = sensors.find((s) => s.id === activeSensorId);
  const state = sensorStates[activeSensorId];
  const prediction = state?.prediction;

  const chartData = useMemo(() => {
    if (!prediction?.trend) return [];
    return prediction.trend.map((val, i) => ({
      time: i,
      health: val,
      lower: val * (1 - prediction.errorAt70pct),
      upper: val * (1 + prediction.errorAt70pct),
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

  const healthIndex = prediction?.healthIndex || 90;
  const rul = prediction?.rul || 8000;
  const confidence = prediction?.confidence || 0.75;
  const errorAt70pct = prediction?.errorAt70pct || 0.1;

  return (
    <div className="min-h-screen pt-16 pb-6 px-6 grid-bg">
      <div className="max-w-[1600px] mx-auto">
        <div className="mb-4">
          <h2 className="tech-title text-2xl mb-1">寿命预测</h2>
          <p className="text-sm text-gray-400">
            {activeSensor?.name || `CH${activeSensorId}`} · 剩余使用寿命 (RUL) 预测
          </p>
        </div>

        <div className="grid grid-cols-4 gap-4 mb-4">
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
            <div className="text-xs text-gray-500 mt-1">
              基于历史数据评估
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
                </div>
                <div className="flex items-center gap-4 text-xs">
                  <span className="flex items-center gap-1">
                    <span className="w-3 h-0.5 bg-tech-cyan" />
                    预测曲线
                  </span>
                  <span className="flex items-center gap-1">
                    <span className="w-3 h-0.5 bg-tech-cyan/30" />
                    置信区间
                  </span>
                  <span className="flex items-center gap-1">
                    <span className="w-3 h-0.5 bg-warning-red" />
                    70%退化线
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
                          <stop offset="5%" stopColor="#00d4ff" stopOpacity={0.15} />
                          <stop offset="95%" stopColor="#00d4ff" stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                      <XAxis
                        dataKey="time"
                        stroke="#666"
                        tick={{ fill: '#888', fontSize: 11 }}
                        label={{ value: '时间 (步)', position: 'insideBottom', offset: -5, fill: '#888', fontSize: 12 }}
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
                        formatter={(value: number) => [`${value.toFixed(2)}%`, '健康度']}
                      />
                      <ReferenceLine y={70} stroke="#ff4757" strokeDasharray="5 5" strokeWidth={1.5} />
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
                    正在收集数据，预测模型加载中...
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className="col-span-4 space-y-4">
            <div className="panel p-5">
              <div className="flex items-center gap-2 mb-4">
                <AlertTriangle className="w-5 h-5 text-warning-orange" />
                <h3 className="font-display font-semibold text-white">关键节点</h3>
              </div>
              <div className="space-y-3">
                <MilestoneItem
                  label="当前状态"
                  value={`${healthIndex.toFixed(1)}%`}
                  status="normal"
                  description="设备运行良好"
                />
                <MilestoneItem
                  label="70% 退化点"
                  value={formatRUL(rul * 0.5)}
                  status="warning"
                  description="预计到达时间"
                />
                <MilestoneItem
                  label="预测失效"
                  value={formatRUL(rul)}
                  status="critical"
                  description="建议提前维护"
                />
              </div>
            </div>

            <div className="panel p-5">
              <h3 className="font-display font-semibold text-white mb-3">模型参数</h3>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-gray-400">预测模型</span>
                  <span className="text-tech-cyan">指数退化模型</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-400">训练数据量</span>
                  <span className="text-white">200+ 历史样本</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-400">更新频率</span>
                  <span className="text-white">每秒</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-400">特征维度</span>
                  <span className="text-white">峭度 / RMS / 峰值</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-400">峭度阈值</span>
                  <span className="text-warning-orange">{kurtosisThreshold}</span>
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
                  return (
                    <div key={sensor.id} className="p-3 rounded-lg bg-black/30 border border-white/5">
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
