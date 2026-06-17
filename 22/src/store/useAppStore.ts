import { create } from 'zustand';
import { AppStore, Cluster } from '../types';

export const useAppStore = create<AppStore>((set) => ({
  highlightedClusterId: null,
  selectedCluster: null,
  searchQuery: '',
  searchResults: [],
  isCameraFlying: false,
  currentLODLevel: 2,
  fps: 0,
  memoryUsage: 0,
  renderedPoints: 0,
  isLoading: true,
  loadingProgress: 0,

  setHighlightedCluster: (clusterId: number | null) =>
    set({ highlightedClusterId: clusterId }),

  setSelectedCluster: (cluster: Cluster | null) =>
    set({ selectedCluster: cluster, highlightedClusterId: cluster?.id ?? null }),

  setSearchQuery: (query: string) =>
    set({ searchQuery: query }),

  setSearchResults: (results: Cluster[]) =>
    set({ searchResults: results }),

  setIsCameraFlying: (flying: boolean) =>
    set({ isCameraFlying: flying }),

  setCurrentLODLevel: (level: number) =>
    set({ currentLODLevel: level }),

  setFps: (fps: number) =>
    set({ fps }),

  setMemoryUsage: (memoryUsage: number) =>
    set({ memoryUsage }),

  setRenderedPoints: (renderedPoints: number) =>
    set({ renderedPoints }),

  setIsLoading: (isLoading: boolean) =>
    set({ isLoading }),

  setLoadingProgress: (loadingProgress: number) =>
    set({ loadingProgress }),

  clearSelection: () =>
    set({ selectedCluster: null, highlightedClusterId: null }),
}));
