import { useMemo, useState, useEffect } from 'react';
import { useAppStore } from '@/store/useAppStore';
import SensorCard from '@/components/monitor/SensorCard';
import WaveformChart from '@/components/monitor/WaveformChart';
import Gauge from '@/components/monitor/Gauge';
import { useWebSocket } from '@/hooks/useWebSocket';
import { Activity, Zap, TrendingUp, Clock, BarChart2 } from 'lucide-react';

export default function Home() {
  const { sensors, sensorStates, activeSensorId, setActiveSensor, kurtosisThreshold } = useAppStore();

  useWebSocket();

  const activeSensor = useMemo(() => sensors.find(s => s.id === activeSensorId), [sensors, activeSensorId]);
  const activeState = sensorStates[activeSensorId];

  const waveform = activeState?.waveform || [];
  const features = activeState?.features;

  const displaySensors = useMemo(() => {
    if (sensors.length > 0) return sensors;
    return Array.from({ length: 10 }, (_, i) => ({
      id: i + 1,
      name: `CH${i + 1}-传感器${i + 1}`,
      location: `位置 ${i + 1}`,
      status: 'normal' as const,
      sampleRate: 5000,
    }));
  }, [sensors]);

  return (
    <div className="min-h-screen pt-16 pb-6 px-6 grid-bg">
      <div className="max-w-[1800px] mx-auto">
        <div className="mb-4">
          <h2 className="tech-title text-2xl mb-1">实时监控面板</h2>
          <p className="text-sm text-gray-400">10 路加速度传感器 · 5000 点/秒采样率</p>
        </div>

        <div className="grid grid-cols-10 gap-3 mb-4">
          {displaySensors.map((sensor) => (
            <SensorCard
              key={sensor.id}
              sensor={sensor}
              isActive={sensor.id === activeSensorId}
              onClick={() => setActiveSensor(sensor.id)}
            />
          ))}
        </div>

        <div className="grid grid-cols-12 gap-4">
          <div className="col-span-8">
            <div className="panel p-4">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <Activity className="w-5 h-5 text-tech-cyan" />
                  <h3 className="font-display font-semibold text-white">
                    {activeSensor?.name || `CH${activeSensorId}`} - 实时波形
                  </h3>
                </div>
                <div className="flex items-center gap-4 text-xs text-gray-400">
                  <span>采样率: 5000 Hz</span>
                  <span>采样点: {waveform.length}</span>
                </div>
              </div>
              <div className="rounded-lg overflow-hidden bg-black/40 border border-white/5">
                <WaveformChart
                  data={waveform.length > 0 ? waveform : new Array(200).fill(0)}
                  color="#00d4ff"
                  height={280}
                />
              </div>
              <div className="mt-3 flex items-center justify-between text-xs text-gray-500">
                <span>时间轴 (s)</span>
                <span>幅值 (g)</span>
              </div>
            </div>
          </div>

          <div className="col-span-4">
            <div className="panel p-4 mb-4">
              <div className="flex items-center gap-2 mb-4">
                <Gauge
                  value={features?.kurtosis || 3}
                  max={8}
                  threshold={kurtosisThreshold}
                  label="峭度"
                />
                <Gauge
                  value={features?.crestFactor || 3}
                  max={10}
                  label="峰值因子"
                  color="#2ed573"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="p-3 rounded-lg bg-black/30 border border-white/5">
                  <div className="flex items-center gap-2 mb-1">
                    <Zap className="w-4 h-4 text-warning-orange" />
                    <span className="text-xs text-gray-400">峰值</span>
                  </div>
                  <div className="gauge-value text-lg text-white">
                    {features?.peak ? features.peak.toFixed(3) : '--'}
                    <span className="text-xs text-gray-500 ml-1">g</span>
                  </div>
                </div>
                <div className="p-3 rounded-lg bg-black/30 border border-white/5">
                  <div className="flex items-center gap-2 mb-1">
                    <TrendingUp className="w-4 h-4 text-tech-cyan" />
                    <span className="text-xs text-gray-400">有效值</span>
                  </div>
                  <div className="gauge-value text-lg text-white">
                    {features?.rms ? features.rms.toFixed(3) : '--'}
                    <span className="text-xs text-gray-500 ml-1">g</span>
                  </div>
                </div>
              </div>
            </div>

            <div className="panel p-4">
              <div className="flex items-center gap-2 mb-3">
                <BarChart2 className="w-5 h-5 text-tech-cyan" />
                <h3 className="font-display font-semibold text-white">频谱包络</h3>
              </div>
              <div className="h-36 rounded-lg overflow-hidden bg-black/30 border border-white/5">
                {features?.spectrum ? (
                  <SpectrumBar data={features.spectrum.slice(0, 100)} />
                ) : (
                  <div className="h-full flex items-center justify-center text-gray-500 text-sm">
                    等待数据...
                  </div>
                )}
              </div>
              <div className="mt-2 text-xs text-gray-500 text-center">
                频率 (Hz) · 0 - 2500
              </div>
            </div>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-12 gap-4">
          <div className="col-span-8">
            <div className="panel p-4">
              <div className="flex items-center gap-2 mb-3">
                <Clock className="w-5 h-5 text-tech-cyan" />
                <h3 className="font-display font-semibold text-white">峭度趋势</h3>
              </div>
              <KurtosisTrend sensorId={activeSensorId} />
            </div>
          </div>

          <div className="col-span-4">
            <div className="panel p-4">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <Clock className="w-5 h-5 text-warning-red" />
                  <h3 className="font-display font-semibold text-white">预警记录</h3>
                </div>
                <span className="text-xs text-gray-500">最近 5 条</span>
              </div>
              <AlertList />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function SpectrumBar({ data }: { data: number[] }) {
  const maxVal = Math.max(...data, 0.001);

  return (
    <div className="h-full flex items-end gap-px p-2">
      {data.map((val, i) => {
        const height = (val / maxVal) * 100;
        const hue = 200 - (i / data.length) * 120;
        return (
          <div
            key={i}
            className="flex-1 rounded-t"
            style={{
              height: `${Math.max(2, height)}%`,
              backgroundColor: `hsl(${hue}, 80%, 60%)`,
              boxShadow: `0 0 4px hsl(${hue}, 80%, 60%)`,
              transition: 'height 0.1s ease',
            }}
          />
        );
      })}
    </div>
  );
}

function KurtosisTrend({ sensorId }: { sensorId: number }) {
  const { sensorStates, kurtosisThreshold } = useAppStore();
  const state = sensorStates[sensorId];

  const [history, setHistory] = useState<{ time: number; value: number }[]>([]);

  useEffect(() => {
    const interval = setInterval(() => {
      if (state?.features) {
        setHistory((prev) => {
          const newHistory = [
            ...prev,
            { time: Date.now(), value: state.features!.kurtosis },
          ];
          return newHistory.slice(-60);
        });
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [state?.features]);

  if (history.length < 2) {
    return (
      <div className="h-40 flex items-center justify-center text-gray-500 text-sm">
        正在收集数据...
      </div>
    );
  }

  const maxVal = Math.max(...history.map((d) => d.value), kurtosisThreshold * 1.2);
  const minVal = Math.min(...history.map((d) => d.value), 2);
  const range = maxVal - minVal || 1;

  const width = 600;
  const height = 160;
  const padding = { top: 10, right: 10, bottom: 20, left: 40 };
  const chartWidth = width - padding.left - padding.right;
  const chartHeight = height - padding.top - padding.bottom;

  const points = history.map((d, i) => {
    const x = padding.left + (i / (history.length - 1)) * chartWidth;
    const y = padding.top + chartHeight - ((d.value - minVal) / range) * chartHeight;
    return `${x},${y}`;
  });

  const thresholdY =
    padding.top + chartHeight - ((kurtosisThreshold - minVal) / range) * chartHeight;

  return (
    <div className="relative">
      <svg width="100%" height={height} viewBox={`0 0 ${width} ${height}`}>
        <line
          x1={padding.left}
          y1={thresholdY}
          x2={width - padding.right}
          y2={thresholdY}
          stroke="#ff4757"
          strokeWidth={1}
          strokeDasharray="4 4"
          opacity={0.7}
        />
        <text
          x={width - padding.right - 5}
          y={thresholdY - 4}
          fill="#ff4757"
          fontSize="10"
          textAnchor="end"
        >
          阈值 {kurtosisThreshold}
        </text>

        <polyline
          points={points.join(' ')}
          fill="none"
          stroke="#00d4ff"
          strokeWidth={2}
          style={{ filter: 'drop-shadow(0 0 4px rgba(0, 212, 255, 0.5))' }}
        />

        {history.map((d, i) => {
          const x = padding.left + (i / (history.length - 1)) * chartWidth;
          const y =
            padding.top + chartHeight - ((d.value - minVal) / range) * chartHeight;
          const isWarning = d.value > kurtosisThreshold;
          return (
            <circle
              key={i}
              cx={x}
              cy={y}
              r={isWarning ? 4 : 2}
              fill={isWarning ? '#ff4757' : '#00d4ff'}
            />
          );
        })}

        <line
          x1={padding.left}
          y1={height - padding.bottom}
          x2={width - padding.right}
          y2={height - padding.bottom}
          stroke="rgba(255,255,255,0.1)"
          strokeWidth={1}
        />

        <text x={5} y={padding.top + 5} fill="#888" fontSize="10">
          {maxVal.toFixed(1)}
        </text>
        <text x={5} y={height - padding.bottom} fill="#888" fontSize="10">
          {minVal.toFixed(1)}
        </text>
      </svg>
    </div>
  );
}

function AlertList() {
  const { alerts } = useAppStore();
  const recentAlerts = alerts.slice(0, 5);

  if (recentAlerts.length === 0) {
    return (
      <div className="h-48 flex items-center justify-center text-gray-500 text-sm">
        暂无预警记录
      </div>
    );
  }

  return (
    <div className="space-y-2 max-h-48 overflow-y-auto">
      {recentAlerts.map((alert) => (
        <div
          key={alert.id}
          className={`p-2 rounded border text-xs ${
            alert.level === 'critical'
              ? 'bg-warning-red/10 border-warning-red/30'
              : 'bg-warning-orange/10 border-warning-orange/30'
          }`}
        >
          <div className="flex items-center justify-between mb-1">
            <span
              className={`font-display font-semibold ${
                alert.level === 'critical' ? 'text-warning-red' : 'text-warning-orange'
              }`}
            >
              CH{alert.sensorId}
            </span>
            <span className="text-gray-500">
              {new Date(alert.timestamp).toLocaleTimeString('zh-CN')}
            </span>
          </div>
          <div className="text-gray-300">{alert.message}</div>
        </div>
      ))}
    </div>
  );
}


