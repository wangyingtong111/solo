import { useEffect, useState } from 'react';
import { AlertTriangle, X, Clock, MapPin } from 'lucide-react';
import { useAppStore } from '@/store/useAppStore';
import type { AlertData } from '../../../shared/types';

export default function AlertModal() {
  const { alertModalVisible, latestAlert, setAlertModalVisible } = useAppStore();
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (alertModalVisible && latestAlert) {
      setVisible(true);
    }
  }, [alertModalVisible, latestAlert]);

  useEffect(() => {
    if (!alertModalVisible) {
      const timer = setTimeout(() => setVisible(false), 300);
      return () => clearTimeout(timer);
    }
  }, [alertModalVisible]);

  if (!visible && !alertModalVisible) return null;
  if (!latestAlert) return null;

  const isCritical = latestAlert.level === 'critical';

  const handleClose = () => {
    setAlertModalVisible(false);
  };

  const formatTime = (timestamp: number) => {
    return new Date(timestamp).toLocaleString('zh-CN');
  };

  return (
    <div
      className={`fixed inset-0 z-50 flex items-center justify-center transition-all duration-300 ${
        alertModalVisible ? 'opacity-100' : 'opacity-0 pointer-events-none'
      }`}
      onClick={handleClose}
    >
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />

      <div
        className={`relative w-[500px] transform transition-all duration-300 ${
          alertModalVisible ? 'scale-100 translate-y-0' : 'scale-95 -translate-y-4'
        }`}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          className={`panel p-6 ${
            isCritical
              ? 'border-warning-red/60 shadow-glow-red'
              : 'border-warning-orange/60'
          }`}
          style={{
            boxShadow: isCritical
              ? '0 0 40px rgba(255, 71, 87, 0.4), inset 0 0 30px rgba(255, 71, 87, 0.05)'
              : '0 0 30px rgba(255, 165, 2, 0.3), inset 0 0 30px rgba(255, 165, 2, 0.05)',
          }}
        >
          <div className="absolute top-0 left-0 right-0 h-1 overflow-hidden">
            <div
              className={`h-full animate-pulse ${
                isCritical ? 'bg-warning-red' : 'bg-warning-orange'
              }`}
            />
          </div>

          <button
            onClick={handleClose}
            className="absolute top-4 right-4 p-1 text-gray-400 hover:text-white transition-colors"
          >
            <X className="w-5 h-5" />
          </button>

          <div className="flex items-start gap-4">
            <div
              className={`flex-shrink-0 w-14 h-14 rounded-full flex items-center justify-center ${
                isCritical
                  ? 'bg-warning-red/20 text-warning-red animate-pulse'
                  : 'bg-warning-orange/20 text-warning-orange'
              }`}
              style={{
                boxShadow: isCritical
                  ? '0 0 20px rgba(255, 71, 87, 0.5)'
                  : '0 0 15px rgba(255, 165, 2, 0.4)',
              }}
            >
              <AlertTriangle className="w-7 h-7" />
            </div>

            <div className="flex-1">
              <h3
                className={`text-xl font-display font-bold mb-1 ${
                  isCritical ? 'text-warning-red' : 'text-warning-orange'
                }`}
                style={{
                  textShadow: isCritical
                    ? '0 0 10px rgba(255, 71, 87, 0.5)'
                    : '0 0 10px rgba(255, 165, 2, 0.5)',
                }}
              >
                {isCritical ? '严重故障预警' : '异常预警'}
              </h3>
              <p className="text-gray-300 text-sm mb-4">{latestAlert.message}</p>

              <div className="grid grid-cols-2 gap-4 text-sm">
                <div className="flex items-center gap-2 text-gray-400">
                  <MapPin className="w-4 h-4 text-tech-cyan" />
                  <span>传感器 CH{latestAlert.sensorId}</span>
                </div>
                <div className="flex items-center gap-2 text-gray-400">
                  <Clock className="w-4 h-4 text-tech-cyan" />
                  <span>{formatTime(latestAlert.timestamp)}</span>
                </div>
              </div>

              <div className="mt-4 p-3 bg-black/30 rounded-lg border border-white/5">
                <div className="flex justify-between items-center mb-2">
                  <span className="text-xs text-gray-400">当前峭度值</span>
                  <span
                    className={`font-display text-lg font-bold ${
                      isCritical ? 'text-warning-red' : 'text-warning-orange'
                    }`}
                  >
                    {latestAlert.kurtosis.toFixed(3)}
                  </span>
                </div>
                <div className="h-2 bg-gray-700 rounded-full overflow-hidden">
                  <div
                    className={`h-full transition-all duration-500 ${
                      isCritical ? 'bg-warning-red' : 'bg-warning-orange'
                    }`}
                    style={{
                      width: `${Math.min(
                        100,
                        (latestAlert.kurtosis / latestAlert.threshold / 2) * 100
                      )}%`,
                    }}
                  />
                </div>
                <div className="flex justify-between mt-1 text-xs text-gray-500">
                  <span>0</span>
                  <span className="text-tech-cyan">阈值: {latestAlert.threshold}</span>
                </div>
              </div>

              <div className="mt-5 flex gap-3">
                <button onClick={handleClose} className="btn-tech flex-1">
                  确认
                </button>
                <button onClick={handleClose} className="btn-danger flex-1">
                  查看详情
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
