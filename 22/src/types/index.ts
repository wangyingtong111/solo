export interface Vector3 {
  x: number;
  y: number;
  z: number;
}

export interface Cluster {
  id: number;
  name: string;
  center: [number, number, number];
  color: [number, number, number];
  pointCount: number;
  avgRGB: [number, number, number];
  boundingBox: {
    min: [number, number, number];
    max: [number, number, number];
  };
}

export interface PointCloudChunk {
  id: number;
  level: number;
  positions: Float32Array;
  colors: Float32Array;
  clusterIds: Uint16Array;
  pointCount: number;
}

export interface LODLevel {
  level: number;
  distanceThreshold: number;
  pointRatio: number;
}

export interface PointCloudData {
  chunks: PointCloudChunk[];
  clusters: Cluster[];
  totalPoints: number;
}

export interface AppState {
  highlightedClusterId: number | null;
  selectedCluster: Cluster | null;
  searchQuery: string;
  searchResults: Cluster[];
  isCameraFlying: boolean;
  currentLODLevel: number;
  fps: number;
  memoryUsage: number;
  renderedPoints: number;
  isLoading: boolean;
  loadingProgress: number;
}

export interface AppActions {
  setHighlightedCluster: (clusterId: number | null) => void;
  setSelectedCluster: (cluster: Cluster | null) => void;
  setSearchQuery: (query: string) => void;
  setSearchResults: (results: Cluster[]) => void;
  setIsCameraFlying: (flying: boolean) => void;
  setCurrentLODLevel: (level: number) => void;
  setFps: (fps: number) => void;
  setMemoryUsage: (memory: number) => void;
  setRenderedPoints: (count: number) => void;
  setIsLoading: (loading: boolean) => void;
  setLoadingProgress: (progress: number) => void;
  clearSelection: () => void;
}

export type AppStore = AppState & AppActions;

export const LOD_CONFIGS: LODLevel[] = [
  { level: 0, distanceThreshold: 30, pointRatio: 1.0 },
  { level: 1, distanceThreshold: 60, pointRatio: 0.25 },
  { level: 2, distanceThreshold: 100, pointRatio: 0.0625 },
];

export const CLUSTER_NAMES = [
  "星系团Alpha", "星云区Beta", "暗物质晕Gamma", "恒星形成区Delta",
  "行星状星云Epsilon", "超新星遗迹Zeta", "球状星团Eta", "疏散星团Theta",
  "分子云Iota", "电离氢区Kappa", "脉冲星群Lambda", "黑洞候选区Mu",
  "伽马射线源Nu", "X射线源Xi", "射电瓣Omicron", "引力透镜Pi",
  "宇宙网节点Rho", "大尺度结构Sigma", "原星系团Tau", "类星体群Upsilon"
];

export const generateClusterColors = (): [number, number, number][] => {
  const colors: [number, number, number][] = [];
  for (let i = 0; i < 20; i++) {
    const hue = (i / 20) * 360;
    colors.push(hslToRgb(hue, 80, 60));
  }
  return colors;
};

const hslToRgb = (h: number, s: number, l: number): [number, number, number] => {
  s /= 100;
  l /= 100;
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) =>
    l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [f(0), f(8), f(4)];
};

export const CLUSTER_COLORS = generateClusterColors();
