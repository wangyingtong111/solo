import { X, Hash, Palette, Layers, Maximize2 } from 'lucide-react';
import { Cluster } from '../types';
import { useAppStore } from '../store/useAppStore';
import { formatNumber } from '../utils/cameraFly';

interface ClusterInfoPanelProps {
  cluster: Cluster;
  onClose: () => void;
  onFlyTo: () => void;
}

export const ClusterInfoPanel = ({ cluster, onClose, onFlyTo }: ClusterInfoPanelProps) => {
  const isCameraFlying = useAppStore(state => state.isCameraFlying);

  const avgRgbColor = `rgb(${Math.round(cluster.avgRGB[0])}, ${Math.round(cluster.avgRGB[1])}, ${Math.round(cluster.avgRGB[2])})`;
  const clusterColor = `rgb(${cluster.color[0] * 255}, ${cluster.color[1] * 255}, ${cluster.color[2] * 255})`;

  const bboxSize = [
    cluster.boundingBox.max[0] - cluster.boundingBox.min[0],
    cluster.boundingBox.max[1] - cluster.boundingBox.min[1],
    cluster.boundingBox.max[2] - cluster.boundingBox.min[2],
  ];

  return (
    <div className="fixed bottom-4 right-4 z-10 w-80 glass-panel rounded-xl overflow-hidden animate-slide-up">
      <div
        className="h-2"
        style={{ background: `linear-gradient(90deg, ${clusterColor}, ${avgRgbColor})` }}
      />

      <div className="p-4">
        <div className="flex items-start justify-between mb-4">
          <div className="flex items-center gap-3">
            <div
              className="w-10 h-10 rounded-lg flex items-center justify-center cluster-highlight"
              style={{ backgroundColor: clusterColor }}
            >
              <Hash className="w-5 h-5 text-white" />
            </div>
            <div>
              <h3 className="text-lg font-semibold text-white">{cluster.name}</h3>
              <div className="text-xs text-gray-400 font-mono">
                聚类 #{cluster.id.toString().padStart(2, '0')}
              </div>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-white/10 transition-colors"
          >
            <X className="w-4 h-4 text-gray-400 hover:text-white" />
          </button>
        </div>

        <div className="space-y-3">
          <div className="flex items-center justify-between p-2.5 bg-white/5 rounded-lg">
            <div className="flex items-center gap-2">
              <Layers className="w-4 h-4 text-gray-400" />
              <span className="text-sm text-gray-400">点数</span>
            </div>
            <span className="text-sm font-mono font-semibold text-white">
              {formatNumber(cluster.pointCount)}
            </span>
          </div>

          <div className="flex items-center justify-between p-2.5 bg-white/5 rounded-lg">
            <div className="flex items-center gap-2">
              <Palette className="w-4 h-4 text-gray-400" />
              <span className="text-sm text-gray-400">平均RGB</span>
            </div>
            <div className="flex items-center gap-2">
              <div
                className="w-5 h-5 rounded-md border border-white/20"
                style={{ backgroundColor: avgRgbColor }}
              />
              <span className="text-sm font-mono text-white">
                {Math.round(cluster.avgRGB[0])}, {Math.round(cluster.avgRGB[1])}, {Math.round(cluster.avgRGB[2])}
              </span>
            </div>
          </div>

          <div className="p-2.5 bg-white/5 rounded-lg">
            <div className="flex items-center gap-2 mb-2">
              <Maximize2 className="w-4 h-4 text-gray-400" />
              <span className="text-sm text-gray-400">包围盒尺寸</span>
            </div>
            <div className="grid grid-cols-3 gap-2">
              <div className="text-center">
                <div className="text-xs text-gray-500">X</div>
                <div className="text-sm font-mono text-white">
                  {bboxSize[0].toFixed(2)}
                </div>
              </div>
              <div className="text-center">
                <div className="text-xs text-gray-500">Y</div>
                <div className="text-sm font-mono text-white">
                  {bboxSize[1].toFixed(2)}
                </div>
              </div>
              <div className="text-center">
                <div className="text-xs text-gray-500">Z</div>
                <div className="text-sm font-mono text-white">
                  {bboxSize[2].toFixed(2)}
                </div>
              </div>
            </div>
          </div>

          <div className="p-2.5 bg-white/5 rounded-lg">
            <div className="text-xs text-gray-400 mb-2">中心坐标</div>
            <div className="font-mono text-xs text-gray-300">
              ({cluster.center[0].toFixed(2)}, {cluster.center[1].toFixed(2)}, {cluster.center[2].toFixed(2)})
            </div>
          </div>
        </div>

        <div className="mt-4 flex gap-2">
          <button
            onClick={onFlyTo}
            disabled={isCameraFlying}
            className="flex-1 py-2 px-4 bg-accent hover:bg-accent/80 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-medium rounded-lg transition-colors flex items-center justify-center gap-2"
          >
            {isCameraFlying ? (
              <>
                <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                飞行中...
              </>
            ) : (
              <>
                <Maximize2 className="w-4 h-4" />
                飞行到此处
              </>
            )}
          </button>
          <button
            onClick={onClose}
            className="py-2 px-4 bg-white/10 hover:bg-white/20 text-white text-sm font-medium rounded-lg transition-colors"
          >
            关闭
          </button>
        </div>
      </div>
    </div>
  );
};
