import { Cluster, PointCloudChunk, PointCloudData, CLUSTER_NAMES, CLUSTER_COLORS, LOD_CONFIGS } from '../types';

const TOTAL_POINTS = 1000000;
const NUM_CLUSTERS = 20;
const CHUNK_COUNT = 10;
const POINTS_PER_CHUNK = TOTAL_POINTS / CHUNK_COUNT;

const seededRandom = (seed: number) => {
  const x = Math.sin(seed) * 10000;
  return x - Math.floor(x);
};

const generateGaussian = (seed: number, mean: number, std: number): number => {
  let u = 0, v = 0;
  while (u === 0) u = seededRandom(seed++);
  while (v === 0) v = seededRandom(seed++);
  const n = Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
  return mean + std * n;
};

const generateClusterCenters = (): Cluster[] => {
  const clusters: Cluster[] = [];
  const bounds = 20;

  for (let i = 0; i < NUM_CLUSTERS; i++) {
    const seed = i * 1000;
    const theta = seededRandom(seed) * Math.PI * 2;
    const phi = Math.acos(2 * seededRandom(seed + 1) - 1);
    const r = 5 + seededRandom(seed + 2) * bounds * 0.4;

    const center: [number, number, number] = [
      r * Math.sin(phi) * Math.cos(theta),
      r * Math.sin(phi) * Math.sin(theta),
      r * Math.cos(phi),
    ];

    const color = CLUSTER_COLORS[i];
    const pointCount = Math.floor(TOTAL_POINTS / NUM_CLUSTERS + (seededRandom(seed + 3) - 0.5) * 10000);

    clusters.push({
      id: i,
      name: CLUSTER_NAMES[i],
      center,
      color,
      pointCount,
      avgRGB: [color[0] * 255, color[1] * 255, color[2] * 255],
      boundingBox: {
        min: [center[0] - 5, center[1] - 5, center[2] - 5],
        max: [center[0] + 5, center[1] + 5, center[2] + 5],
      },
    });
  }

  const adjusted = adjustPointCounts(clusters, TOTAL_POINTS);
  return calculateBoundingBoxes(adjusted);
};

const adjustPointCounts = (clusters: Cluster[], total: number): Cluster[] => {
  let currentTotal = clusters.reduce((sum, c) => sum + c.pointCount, 0);
  const diff = total - currentTotal;

  if (diff !== 0) {
    clusters[0].pointCount += diff;
  }

  return clusters;
};

const calculateBoundingBoxes = (clusters: Cluster[]): Cluster[] => {
  const pointCounts = clusters.map(c => c.pointCount);
  let pointIndex = 0;

  for (let c = 0; c < clusters.length; c++) {
    const cluster = clusters[c];
    const seed = c * 10000;
    let minX = Infinity, minY = Infinity, minZ = Infinity;
    let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;

    for (let i = 0; i < pointCounts[c]; i++) {
      const s = seed + i * 3;
      const x = generateGaussian(s, cluster.center[0], 1.5);
      const y = generateGaussian(s + 1, cluster.center[1], 1.5);
      const z = generateGaussian(s + 2, cluster.center[2], 1.5);

      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      minZ = Math.min(minZ, z);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
      maxZ = Math.max(maxZ, z);
    }

    cluster.boundingBox = {
      min: [minX, minY, minZ],
      max: [maxX, maxY, maxZ],
    };
  }

  return clusters;
};

const generateChunkData = (
  chunkId: number,
  clusters: Cluster[],
  lodLevel: number
): PointCloudChunk => {
  const pointRatio = LOD_CONFIGS[lodLevel].pointRatio;
  const chunkPointCount = Math.floor(POINTS_PER_CHUNK * pointRatio);
  const step = Math.floor(1 / pointRatio);

  const positions = new Float32Array(chunkPointCount * 3);
  const colors = new Float32Array(chunkPointCount * 3);
  const clusterIds = new Uint16Array(chunkPointCount);

  const startPoint = chunkId * POINTS_PER_CHUNK;
  const endPoint = startPoint + POINTS_PER_CHUNK;

  let clusterStart = 0;
  let clusterEnd = 0;
  let currentCluster = 0;

  for (let i = 0; i < clusters.length; i++) {
    clusterEnd += clusters[i].pointCount;
    if (startPoint < clusterEnd) {
      currentCluster = i;
      break;
    }
    clusterStart = clusterEnd;
  }

  let outIndex = 0;

  for (let globalIdx = startPoint; globalIdx < endPoint; globalIdx += step) {
    if (outIndex >= chunkPointCount) break;

    while (globalIdx >= clusterEnd && currentCluster < clusters.length - 1) {
      clusterStart = clusterEnd;
      currentCluster++;
      clusterEnd += clusters[currentCluster].pointCount;
    }

    const cluster = clusters[currentCluster];
    const pointInCluster = globalIdx - clusterStart;
    const seed = cluster.id * 100000 + pointInCluster * 3;

    const x = generateGaussian(seed, cluster.center[0], 1.5);
    const y = generateGaussian(seed + 1, cluster.center[1], 1.5);
    const z = generateGaussian(seed + 2, cluster.center[2], 1.5);

    const colorJitter = 0.1;
    const r = Math.max(0, Math.min(1, cluster.color[0] + (seededRandom(seed + 3) - 0.5) * colorJitter));
    const g = Math.max(0, Math.min(1, cluster.color[1] + (seededRandom(seed + 4) - 0.5) * colorJitter));
    const b = Math.max(0, Math.min(1, cluster.color[2] + (seededRandom(seed + 5) - 0.5) * colorJitter));

    positions[outIndex * 3] = x;
    positions[outIndex * 3 + 1] = y;
    positions[outIndex * 3 + 2] = z;

    colors[outIndex * 3] = r;
    colors[outIndex * 3 + 1] = g;
    colors[outIndex * 3 + 2] = b;

    clusterIds[outIndex] = cluster.id;

    outIndex++;
  }

  return {
    id: chunkId,
    level: lodLevel,
    positions: positions.slice(0, outIndex * 3),
    colors: colors.slice(0, outIndex * 3),
    clusterIds: clusterIds.slice(0, outIndex),
    pointCount: outIndex,
  };
};

export const generatePointCloudData = async (
  onProgress?: (progress: number, message: string) => void
): Promise<PointCloudData> => {
  const clusters = generateClusterCenters();

  const totalWork = CHUNK_COUNT * 3;
  let completed = 0;

  const chunks: PointCloudChunk[] = [];

  for (let lod = 2; lod >= 0; lod--) {
    for (let c = 0; c < CHUNK_COUNT; c++) {
      await new Promise(resolve => setTimeout(resolve, 0));

      const chunk = generateChunkData(c, clusters, lod);
      chunks.push(chunk);

      completed++;
      if (onProgress) {
        const progress = completed / totalWork;
        const lodNames = ['最高精度', '中等精度', '低精度'];
        onProgress(progress, `正在加载${lodNames[lod]}数据块 ${c + 1}/${CHUNK_COUNT}`);
      }
    }
  }

  const totalPoints = chunks
    .filter(c => c.level === 0)
    .reduce((sum, c) => sum + c.pointCount, 0);

  return {
    chunks,
    clusters,
    totalPoints,
  };
};

export const getChunksForLOD = (
  chunks: PointCloudChunk[],
  lodLevel: number
): PointCloudChunk[] => {
  return chunks.filter(c => c.level === lodLevel);
};

export const mergeChunks = (chunks: PointCloudChunk[]): {
  positions: Float32Array;
  colors: Float32Array;
  clusterIds: Uint16Array;
  totalPoints: number;
} => {
  const totalPoints = chunks.reduce((sum, c) => sum + c.pointCount, 0);

  const positions = new Float32Array(totalPoints * 3);
  const colors = new Float32Array(totalPoints * 3);
  const clusterIds = new Uint16Array(totalPoints);

  let offset = 0;
  for (const chunk of chunks) {
    positions.set(chunk.positions, offset * 3);
    colors.set(chunk.colors, offset * 3);
    clusterIds.set(chunk.clusterIds, offset);
    offset += chunk.pointCount;
  }

  return { positions, colors, clusterIds, totalPoints };
};
