import { useAppStore } from '../store/useAppStore';
import { formatNumber, formatMemory } from '../utils/cameraFly';
import { Activity, Cpu, Layers, Database } from 'lucide-react';

export const PerformancePanel = () => {
  const fps = useAppStore(state => state.fps);
  const memoryUsage = useAppStore(state => state.memoryUsage);
  const renderedPoints = useAppStore(state => state.renderedPoints);
  const currentLODLevel = useAppStore(state => state.currentLODLevel);
  const isLoading = useAppStore(state => state.isLoading);
  const loadingProgress = useAppStore(state => state.loadingProgress);

  const lodNames = ['最高', '中等', '低'];
  const lodColors = ['text-green-400', 'text-yellow-400', 'text-orange-400'];
  const fpsColor = fps >= 45 ? 'text-green-400' : fps >= 30 ? 'text-yellow-400' : 'text-red-400';

  if (isLoading) {
    return (
      <div className="fixed top-4 left-4 z-10 glass-panel rounded-xl p-4 w-72 animate-fade-in">
        <div className="flex items-center gap-2 mb-3">
          <div className="w-2 h-2 bg-accent rounded-full animate-pulse" />
          <span className="text-sm text-gray-300 font-medium">正在加载点云数据</span>
        </div>
        <div className="w-full bg-space-700 rounded-full h-2 mb-2">
          <div
            className="bg-accent h-2 rounded-full transition-all duration-300"
            style={{ width: `${loadingProgress * 100}%` }}
          />
        </div>
        <div className="text-xs text-gray-400 font-mono">
          {Math.round(loadingProgress * 100)}% 完成
        </div>
      </div>
    );
  }

  return (
    <div className="fixed top-4 left-4 z-10 glass-panel rounded-xl p-4 w-72 animate-fade-in">
      <div className="flex items-center gap-2 mb-3 pb-2 border-b border-white/10">
        <Activity className="w-4 h-4 text-accent" />
        <span className="text-sm font-semibold text-white">性能监控</span>
      </div>

      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Activity className="w-4 h-4 text-gray-400" />
            <span className="text-xs text-gray-400">帧率</span>
          </div>
          <span className={`text-sm font-mono font-semibold ${fpsColor}`}>
            {fps} FPS
          </span>
        </div>

        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Cpu className="w-4 h-4 text-gray-400" />
            <span className="text-xs text-gray-400">内存</span>
          </div>
          <span className="text-sm font-mono text-gray-200">
            {formatMemory(memoryUsage)}
          </span>
        </div>

        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Database className="w-4 h-4 text-gray-400" />
            <span className="text-xs text-gray-400">渲染点数</span>
          </div>
          <span className="text-sm font-mono text-gray-200">
            {formatNumber(renderedPoints)}
          </span>
        </div>

        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Layers className="w-4 h-4 text-gray-400" />
            <span className="text-xs text-gray-400">LOD层级</span>
          </div>
          <span className={`text-sm font-mono font-semibold ${lodColors[currentLODLevel]}`}>
            LOD {currentLODLevel} ({lodNames[currentLODLevel]})
          </span>
        </div>
      </div>

      <div className="mt-3 pt-2 border-t border-white/10">
        <div className="flex items-center justify-between text-xs text-gray-500">
          <span>总点数: 1,000,000</span>
          <span>聚类数: 20</span>
        </div>
      </div>
    </div>
  );
};
