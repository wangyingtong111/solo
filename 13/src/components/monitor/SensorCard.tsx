import { Activity, AlertTriangle, CheckCircle } from 'lucide-react';
import WaveformChart from './WaveformChart';
import { useAppStore } from '@/store/useAppStore';
import type { Sensor } from '../../../../shared/types';

interface SensorCardProps {
  sensor: Sensor;
  isActive?: boolean;
  onClick?: () => void;
}

export default function SensorCard({ sensor, isActive, onClick }: SensorCardProps) {
  const { sensorStates, kurtosisThreshold } = useAppStore();
  const state = sensorStates[sensor.id];

  const waveform = state?.waveform || [];
  const features = state?.features;
  const status = state?.status || 'normal';

  const statusConfig = {
    normal: {
      color: 'text-status-green',
      bg: 'bg-status-green/20',
      border: 'border-status-green/30',
      icon: CheckCircle,
      label: '正常',
    },
    warning: {
      color: 'text-warning-orange',
      bg: 'bg-warning-orange/20',
      border: 'border-warning-orange/50',
      icon: AlertTriangle,
      label: '预警',
    },
    critical: {
      color: 'text-warning-red',
      bg: 'bg-warning-red/20',
      border: 'border-warning-red/50',
      icon: AlertTriangle,
      label: '严重',
    },
  }[status];

  const StatusIcon = statusConfig.icon;

  const getWaveformColor = () => {
    if (status === 'critical') return '#ff4757';
    if (status === 'warning') return '#ffa502';
    return '#00d4ff';
  };

  return (
    <div
      onClick={onClick}
      className={`panel p-3 cursor-pointer transition-all duration-200 hover:scale-[1.02] ${
        isActive ? 'ring-2 ring-tech-cyan/60 shadow-glow-cyan' : ''
      } ${status === 'critical' ? 'animate-pulse' : ''}`}
      style={{
        borderColor: isActive ? 'rgba(0, 212, 255, 0.5)' : undefined,
      }}
    >
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <Activity className={`w-4 h-4 ${statusConfig.color}`} />
          <span className="font-display font-semibold text-sm text-white">
            {sensor.name}
          </span>
        </div>
        <div className={`flex items-center gap-1 px-2 py-0.5 rounded-full text-xs ${statusConfig.bg} ${statusConfig.color}`}>
          <StatusIcon className="w-3 h-3" />
          <span className="font-medium">{statusConfig.label}</span>
        </div>
      </div>

      <div className="rounded-md overflow-hidden bg-black/30 border border-white/5 mb-2">
        <WaveformChart
          data={waveform.length > 0 ? waveform : new Array(100).fill(0)}
          color={getWaveformColor()}
          height={60}
          showGrid={false}
        />
      </div>

      <div className="grid grid-cols-2 gap-2 text-xs">
        <div>
          <div className="text-gray-500 mb-0.5">峭度</div>
          <div
            className={`font-display font-semibold ${
              features && features.kurtosis > kurtosisThreshold
                ? status === 'critical'
                  ? 'text-warning-red'
                  : 'text-warning-orange'
                : 'text-tech-cyan'
            }`}
          >
            {features ? features.kurtosis.toFixed(2) : '--'}
          </div>
        </div>
        <div>
          <div className="text-gray-500 mb-0.5">有效值</div>
          <div className="font-display font-semibold text-gray-300">
            {features ? features.rms.toFixed(3) : '--'}
          </div>
        </div>
      </div>
    </div>
  );
}
