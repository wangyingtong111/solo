import { useState } from 'react';
import { useAppStore } from '@/store/useAppStore';
import { useWebSocket } from '@/hooks/useWebSocket';
import { Settings, AlertTriangle, Gauge, Wifi, Database, Save, RotateCcw } from 'lucide-react';

export default function SettingsPage() {
  const { kurtosisThreshold: currentThreshold, setKurtosisThreshold: setStoreThreshold, alerts } = useAppStore();
  const { updateThreshold } = useWebSocket();

  const [threshold, setThreshold] = useState(currentThreshold);
  const [sampleRate, setSampleRate] = useState(5000);
  const [alertEnabled, setAlertEnabled] = useState(true);
  const [saved, setSaved] = useState(false);

  const handleSave = () => {
    setStoreThreshold(threshold);
    updateThreshold(threshold);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const handleReset = () => {
    setThreshold(3.5);
    setSampleRate(5000);
    setAlertEnabled(true);
  };

  return (
    <div className="min-h-screen pt-16 pb-6 px-6 grid-bg">
      <div className="max-w-[1200px] mx-auto">
        <div className="mb-6">
          <h2 className="tech-title text-2xl mb-1">系统设置</h2>
          <p className="text-sm text-gray-400">配置预警参数、采样率和系统选项</p>
        </div>

        <div className="grid grid-cols-3 gap-6">
          <div className="col-span-2 space-y-6">
            <div className="panel p-6">
              <div className="flex items-center gap-3 mb-6">
                <div className="w-10 h-10 rounded-lg bg-warning-orange/20 flex items-center justify-center">
                  <AlertTriangle className="w-5 h-5 text-warning-orange" />
                </div>
                <div>
                  <h3 className="font-display font-semibold text-white text-lg">预警参数</h3>
                  <p className="text-xs text-gray-400">配置故障预警的触发条件</p>
                </div>
              </div>

              <div className="space-y-6">
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <label className="text-sm text-gray-300">峭度预警阈值</label>
                    <span className="font-display text-lg text-warning-orange">{threshold.toFixed(1)}</span>
                  </div>
                  <input
                    type="range"
                    min="2.5"
                    max="6"
                    step="0.1"
                    value={threshold}
                    onChange={(e) => setThreshold(parseFloat(e.target.value))}
                    className="w-full h-2 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-warning-orange"
                  />
                  <div className="flex justify-between mt-1 text-xs text-gray-500">
                    <span>2.5 (灵敏)</span>
                    <span>3.5 (标准)</span>
                    <span>6.0 (保守)</span>
                  </div>
                  <p className="mt-3 text-xs text-gray-500">
                    当峭度值超过此阈值时触发预警。建议标准值为 3.5，根据实际工况调整。
                  </p>
                </div>

                <div className="flex items-center justify-between p-4 rounded-lg bg-black/30 border border-white/5">
                  <div>
                    <div className="text-sm text-white font-medium">启用实时预警</div>
                    <div className="text-xs text-gray-500">关闭后将不再弹出预警通知</div>
                  </div>
                  <button
                    onClick={() => setAlertEnabled(!alertEnabled)}
                    className={`relative w-12 h-6 rounded-full transition-colors duration-200 ${
                      alertEnabled ? 'bg-status-green' : 'bg-gray-600'
                    }`}
                  >
                    <div
                      className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-all duration-200 ${
                        alertEnabled ? 'left-7' : 'left-1'
                      }`}
                    />
                  </button>
                </div>
              </div>
            </div>

            <div className="panel p-6">
              <div className="flex items-center gap-3 mb-6">
                <div className="w-10 h-10 rounded-lg bg-tech-cyan/20 flex items-center justify-center">
                  <Gauge className="w-5 h-5 text-tech-cyan" />
                </div>
                <div>
                  <h3 className="font-display font-semibold text-white text-lg">采样设置</h3>
                  <p className="text-xs text-gray-400">配置数据采集参数</p>
                </div>
              </div>

              <div className="space-y-4">
                <div>
                  <label className="text-sm text-gray-300 block mb-2">采样率 (Hz)</label>
                  <div className="grid grid-cols-4 gap-2">
                    {[1000, 2500, 5000, 10000].map((rate) => (
                      <button
                        key={rate}
                        onClick={() => setSampleRate(rate)}
                        className={`py-2 px-3 rounded-lg text-sm font-display transition-all ${
                          sampleRate === rate
                            ? 'bg-tech-cyan/20 text-tech-cyan border border-tech-cyan/50'
                            : 'bg-black/30 text-gray-400 border border-white/10 hover:border-white/20'
                        }`}
                      >
                        {rate.toLocaleString()} Hz
                      </button>
                    ))}
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="p-4 rounded-lg bg-black/30 border border-white/5">
                    <div className="text-xs text-gray-400 mb-1">FFT 点数</div>
                    <div className="font-display text-lg text-white">1024</div>
                  </div>
                  <div className="p-4 rounded-lg bg-black/30 border border-white/5">
                    <div className="text-xs text-gray-400 mb-1">频率分辨率</div>
                    <div className="font-display text-lg text-white">
                      {(sampleRate / 1024).toFixed(2)} Hz
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div className="flex gap-3">
              <button
                onClick={handleSave}
                className="btn-tech flex-1 flex items-center justify-center gap-2 py-3"
              >
                <Save className="w-4 h-4" />
                {saved ? '已保存 ✓' : '保存设置'}
              </button>
              <button
                onClick={handleReset}
                className="px-6 py-3 border border-gray-600 text-gray-400 rounded-lg hover:bg-white/5 transition-colors flex items-center gap-2"
              >
                <RotateCcw className="w-4 h-4" />
                重置
              </button>
            </div>
          </div>

          <div className="space-y-6">
            <div className="panel p-6">
              <div className="flex items-center gap-3 mb-4">
                <Wifi className="w-5 h-5 text-status-green" />
                <h3 className="font-display font-semibold text-white">系统状态</h3>
              </div>
              <div className="space-y-3">
                <StatusItem label="WebSocket 连接" status="online" />
                <StatusItem label="传感器接入" value="10 / 10" />
                <StatusItem label="数据处理延迟" value="&lt; 100ms" />
                <StatusItem label="今日预警数" value={alerts.length.toString()} />
              </div>
            </div>

            <div className="panel p-6">
              <div className="flex items-center gap-3 mb-4">
                <Database className="w-5 h-5 text-purple-400" />
                <h3 className="font-display font-semibold text-white">数据存储</h3>
              </div>
              <div className="space-y-3">
                <div className="flex justify-between text-sm">
                  <span className="text-gray-400">历史数据</span>
                  <span className="text-white">7 天</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-gray-400">存储方式</span>
                  <span className="text-white">内存 + 文件</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-gray-400">采样点数</span>
                  <span className="text-white">5000/s</span>
                </div>
              </div>
            </div>

            <div className="panel p-6 border-warning-orange/30" style={{ boxShadow: '0 0 20px rgba(255, 165, 2, 0.1)' }}>
              <div className="flex items-center gap-3 mb-3">
                <Settings className="w-5 h-5 text-warning-orange" />
                <h3 className="font-display font-semibold text-white">关于系统</h3>
              </div>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-gray-400">系统名称</span>
                  <span className="text-tech-cyan">VibePredict</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-400">版本</span>
                  <span className="text-white">v1.0.0</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-400">算法模型</span>
                  <span className="text-white">指数退化 + FFT</span>
                </div>
              </div>
              <p className="mt-4 text-xs text-gray-500 leading-relaxed">
                旋转机械振动预测系统，基于实时振动信号分析，提供故障早期预警和剩余寿命预测功能。
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function StatusItem({ label, status, value }: { label: string; status?: 'online' | 'offline'; value?: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-sm text-gray-400">{label}</span>
      {status ? (
        <span className={`flex items-center gap-1.5 text-sm ${
          status === 'online' ? 'text-status-green' : 'text-warning-red'
        }`}>
          <span className={`w-2 h-2 rounded-full ${
            status === 'online' ? 'bg-status-green animate-pulse' : 'bg-warning-red'
          }`}
            style={{ boxShadow: status === 'online' ? '0 0 6px #2ed573' : 'none' }}
          />
          {status === 'online' ? '在线' : '离线'}
        </span>
      ) : (
        <span className="text-sm font-display text-white">{value}</span>
      )}
    </div>
  );
}
