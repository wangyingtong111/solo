import { useState, useEffect, useRef, useCallback } from 'react';
import { Scene } from '../components/Scene';
import { PerformancePanel } from '../components/PerformancePanel';
import { SearchBar } from '../components/SearchBar';
import { ClusterInfoPanel } from '../components/ClusterInfoPanel';
import { usePerformanceMonitor } from '../hooks/usePerformanceMonitor';
import { generatePointCloudData } from '../utils/pointCloudGenerator';
import { PointCloudData, Cluster } from '../types';
import { useAppStore } from '../store/useAppStore';

const Home = () => {
  const [pointCloudData, setPointCloudData] = useState<PointCloudData | null>(null);
  const flyToClusterRef = useRef<((cluster: Cluster) => void) | null>(null);
  
  const selectedCluster = useAppStore(state => state.selectedCluster);
  const setSelectedCluster = useAppStore(state => state.setSelectedCluster);
  const setIsLoading = useAppStore(state => state.setIsLoading);
  const setLoadingProgress = useAppStore(state => state.setLoadingProgress);
  const clearSelection = useAppStore(state => state.clearSelection);

  usePerformanceMonitor();

  useEffect(() => {
    const loadData = async () => {
      setIsLoading(true);
      setLoadingProgress(0);

      const startTime = performance.now();
      
      const data = await generatePointCloudData((progress, message) => {
        setLoadingProgress(progress);
        console.log(`[加载] ${Math.round(progress * 100)}% - ${message}`);
      });

      const loadTime = performance.now() - startTime;
      console.log(`[性能] 数据加载完成，耗时 ${loadTime.toFixed(2)}ms`);
      console.log(`[性能] 总点数: ${data.totalPoints.toLocaleString()}`);
      console.log(`[性能] 聚类数: ${data.clusters.length}`);
      
      setPointCloudData(data);
      setIsLoading(false);
    };

    loadData();
  }, [setIsLoading, setLoadingProgress]);

  const handlePointClick = useCallback((cluster: Cluster) => {
    console.log(`[交互] 点击聚类: ${cluster.name} (ID: ${cluster.id})`);
    setSelectedCluster(cluster);
  }, [setSelectedCluster]);

  const handleSearchSelect = useCallback((cluster: Cluster) => {
    console.log(`[搜索] 选中聚类: ${cluster.name}`);
    setSelectedCluster(cluster);
    if (flyToClusterRef.current) {
      flyToClusterRef.current(cluster);
    }
  }, [setSelectedCluster]);

  const handleFlyToSelected = useCallback(() => {
    if (selectedCluster && flyToClusterRef.current) {
      flyToClusterRef.current(selectedCluster);
    }
  }, [selectedCluster]);

  const handleClosePanel = useCallback(() => {
    clearSelection();
  }, [clearSelection]);

  if (!pointCloudData) {
    return (
      <div className="w-full h-full bg-space-900 flex items-center justify-center">
        <PerformancePanel />
      </div>
    );
  }

  return (
    <div className="w-full h-full relative">
      <div className="canvas-container">
        <Scene
          data={pointCloudData}
          onPointClick={handlePointClick}
          flyToClusterRef={flyToClusterRef}
        />
      </div>

      <PerformancePanel />
      <SearchBar clusters={pointCloudData.clusters} onSelect={handleSearchSelect} />
      
      {selectedCluster && (
        <ClusterInfoPanel
          cluster={selectedCluster}
          onClose={handleClosePanel}
          onFlyTo={handleFlyToSelected}
        />
      )}

      <div className="fixed bottom-4 left-4 z-10 text-xs text-gray-500 font-mono">
        <div>拖拽旋转 · 滚轮缩放 · 点击点查看信息 · 按 / 搜索</div>
      </div>
    </div>
  );
};

export default Home;
