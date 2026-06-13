import { useState, useCallback } from 'react';
import { useEditorStore, startTransaction, commitTransaction } from '@/store/useEditorStore';
import { filterService } from '@/services/FilterService';
import type { FilterConfig, FilterType, ImageLayer } from '@/types';
import { Sliders, Sun, Contrast, Droplet, RefreshCw, Sparkles, Camera } from 'lucide-react';
import clsx from 'clsx';

const FILTER_PRESETS: { name: string; type: FilterType; defaultValue: number; icon: React.ReactNode; color: string }[] = [
  { name: '亮度', type: 'brightness', defaultValue: 0, icon: <Sun size={16} />, color: 'from-yellow-500 to-orange-500' },
  { name: '对比度', type: 'contrast', defaultValue: 0, icon: <Contrast size={16} />, color: 'from-gray-500 to-gray-700' },
  { name: '饱和度', type: 'saturation', defaultValue: 0, icon: <Droplet size={16} />, color: 'from-pink-500 to-rose-500' },
  { name: '色相', type: 'hue-rotate', defaultValue: 0, icon: <RefreshCw size={16} />, color: 'from-indigo-500 to-purple-500' },
];

const STYLE_PRESETS: { name: string; type: FilterType; color: string }[] = [
  { name: '灰度', type: 'grayscale', color: 'bg-gray-500' },
  { name: '复古', type: 'sepia', color: 'bg-amber-700' },
  { name: '反相', type: 'invert', color: 'bg-purple-600' },
  { name: '锐化', type: 'sharpen', color: 'bg-blue-600' },
  { name: '模糊', type: 'blur', color: 'bg-teal-600' },
  { name: '浮雕', type: 'emboss', color: 'bg-orange-600' },
  { name: '高斯模糊', type: 'gaussian-blur', color: 'bg-cyan-600' },
  { name: '复古风', type: 'vintage', color: 'bg-red-700' },
];

const PREVIEW_PRESETS = [
  { name: '原图', filters: [] },
  { name: '日系', filters: [
    { type: 'brightness' as FilterType, value: 15, enabled: true },
    { type: 'saturation' as FilterType, value: -10, enabled: true },
    { type: 'contrast' as FilterType, value: -8, enabled: true },
  ]},
  { name: '胶片', filters: [
    { type: 'contrast' as FilterType, value: 12, enabled: true },
    { type: 'saturation' as FilterType, value: -5, enabled: true },
    { type: 'sepia' as FilterType, value: 0, enabled: true },
  ]},
  { name: '赛博朋克', filters: [
    { type: 'contrast' as FilterType, value: 20, enabled: true },
    { type: 'saturation' as FilterType, value: 25, enabled: true },
    { type: 'hue-rotate' as FilterType, value: 30, enabled: true },
  ]},
  { name: '黑白电影', filters: [
    { type: 'grayscale' as FilterType, value: 0, enabled: true },
    { type: 'contrast' as FilterType, value: 15, enabled: true },
    { type: 'brightness' as FilterType, value: -5, enabled: true },
  ]},
  { name: '暖色调', filters: [
    { type: 'brightness' as FilterType, value: 8, enabled: true },
    { type: 'saturation' as FilterType, value: 15, enabled: true },
    { type: 'sepia' as FilterType, value: 0, enabled: true },
  ]},
];

export const FiltersPanel = () => {
  const { layers, selection, updateLayer, saveHistory, updateLayerStyle } = useEditorStore();
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [activeTab, setActiveTab] = useState<'adjust' | 'presets'>('adjust');

  const activeLayer = layers.find(l => l.id === selection.activeLayerId) as ImageLayer | undefined;

  const applyFilterToImage = useCallback(async (filterType: FilterType, value: number) => {
    if (!activeLayer || !activeLayer.imageData) return;

    setIsProcessing(true);
    setProgress(0);

    try {
      startTransaction();
      
      const result = await filterService.applyFilterWithPreview(
        filterType,
        value,
        activeLayer.imageData,
        (preview) => {
          setProgress(50);
        }
      );

      setProgress(100);

      updateLayer(activeLayer.id, {
        imageData: result,
      });

      commitTransaction();
    } catch (error) {
      console.error('Filter error:', error);
    } finally {
      setIsProcessing(false);
      setProgress(0);
    }
  }, [activeLayer, updateLayer]);

  const toggleStyleFilter = useCallback(async (filterType: FilterType) => {
    if (!activeLayer) return;
    
    const currentFilters = activeLayer.style.filters;
    const existingFilter = currentFilters.find(f => f.type === filterType);

    startTransaction();
    
    let newFilters: FilterConfig[];
    
    if (existingFilter) {
      newFilters = currentFilters.filter(f => f.type !== filterType);
    } else {
      if (['grayscale', 'sepia', 'invert', 'emboss', 'vintage'].includes(filterType)) {
        newFilters = [...currentFilters, { type: filterType, value: 0, enabled: true }];
        if (filterType === 'sharpen') {
          newFilters = [...currentFilters, { type: filterType, value: 50, enabled: true }];
        } else if (filterType === 'blur' || filterType === 'gaussian-blur') {
          newFilters = [...currentFilters, { type: filterType, value: 3, enabled: true }];
        }
      } else {
        newFilters = [...currentFilters, { type: filterType, value: 50, enabled: true }];
      }
    }

    updateLayerStyle(activeLayer.id, { filters: newFilters });
    commitTransaction();
    saveHistory();
  }, [activeLayer, updateLayerStyle, saveHistory]);

  const applyFilterValue = useCallback((filterType: FilterType, value: number) => {
    if (!activeLayer) return;
    
    const currentFilters = activeLayer.style.filters;
    const existingFilter = currentFilters.find(f => f.type === filterType);
    
    let newFilters: FilterConfig[];
    
    if (existingFilter) {
      newFilters = currentFilters.map(f =>
        f.type === filterType ? { ...f, value } : f
      );
    } else {
      newFilters = [...currentFilters, { type: filterType, value, enabled: value !== 0 }];
    }

    updateLayerStyle(activeLayer.id, { filters: newFilters });
  }, [activeLayer, updateLayerStyle]);

  const getFilterValue = (filterType: FilterType): number => {
    if (!activeLayer) return 0;
    return activeLayer.style.filters.find(f => f.type === filterType)?.value ?? 0;
  };

  const isFilterActive = (filterType: FilterType): boolean => {
    if (!activeLayer) return false;
    const filter = activeLayer.style.filters.find(f => f.type === filterType);
    return filter?.enabled ?? false;
  };

  const applyPreset = useCallback((preset: typeof PREVIEW_PRESETS[0]) => {
    if (!activeLayer) return;
    startTransaction();
    updateLayerStyle(activeLayer.id, { filters: preset.filters.map(f => ({ ...f, enabled: true })) });
    commitTransaction();
    saveHistory();
  }, [activeLayer, updateLayerStyle, saveHistory]);

  return (
    <div className="border-b border-dark-100">
      <div className="panel-header">
        <span className="panel-title flex items-center gap-2">
          <Sliders size={14} />
          滤镜
        </span>
      </div>

      <div className="flex border-b border-dark-100">
        <button
          onClick={() => setActiveTab('adjust')}
          className={clsx(
            'flex-1 py-2 text-xs font-medium transition-colors border-b-2',
            activeTab === 'adjust'
              ? 'text-accent-primary border-accent-primary bg-accent-primary/5'
              : 'text-gray-400 border-transparent hover:text-gray-300'
          )}
        >
          调整
        </button>
        <button
          onClick={() => setActiveTab('presets')}
          className={clsx(
            'flex-1 py-2 text-xs font-medium transition-colors border-b-2',
            activeTab === 'presets'
              ? 'text-accent-primary border-accent-primary bg-accent-primary/5'
              : 'text-gray-400 border-transparent hover:text-gray-300'
          )}
        >
          预设
        </button>
      </div>

      {isProcessing && (
        <div className="h-1 bg-dark-300 overflow-hidden">
          <div
            className="h-full bg-gradient-to-r from-accent-primary to-accent-secondary transition-all duration-300"
            style={{ width: `${progress}%` }}
          />
        </div>
      )}

      {activeTab === 'adjust' ? (
        <div className="p-3 space-y-3">
          {!activeLayer ? (
            <div className="py-6 text-center text-gray-500 text-xs">
              <Sliders size={24} className="mx-auto mb-2 opacity-30" />
              选择图层调整滤镜
            </div>
          ) : (
            <>
              <div className="space-y-3">
                {FILTER_PRESETS.map((filter) => {
                  const value = getFilterValue(filter.type);
                  const ranges: Record<FilterType, { min: number; max: number; step: number }> = {
                    brightness: { min: -100, max: 100, step: 1 },
                    contrast: { min: -100, max: 100, step: 1 },
                    saturation: { min: -100, max: 100, step: 1 },
                    'hue-rotate': { min: -180, max: 180, step: 1 },
                    blur: { min: 0, max: 50, step: 1 },
                    sharpen: { min: 0, max: 200, step: 1 },
                    vintage: { min: 0, max: 100, step: 1 },
                    grayscale: { min: 0, max: 1, step: 1 },
                    sepia: { min: 0, max: 1, step: 1 },
                    invert: { min: 0, max: 1, step: 1 },
                    emboss: { min: 0, max: 1, step: 1 },
                    'gaussian-blur': { min: 0, max: 50, step: 1 },
                    'box-blur': { min: 0, max: 50, step: 1 },
                  };
                  const range = ranges[filter.type];

                  return (
                    <div key={filter.type}>
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2">
                          <div className={`w-7 h-7 rounded-lg bg-gradient-to-br ${filter.color} flex items-center justify-center text-white`}>
                            {filter.icon}
                          </div>
                          <span className="text-xs font-medium text-gray-200">{filter.name}</span>
                        </div>
                        <span className="text-xs text-gray-400 font-mono w-10 text-right">
                          {filter.type === 'hue-rotate' ? `${value}°` : value}
                        </span>
                      </div>
                      <input
                        type="range"
                        min={range.min}
                        max={range.max}
                        step={range.step}
                        value={value}
                        onChange={(e) => applyFilterValue(filter.type, parseFloat(e.target.value))}
                        onMouseUp={() => saveHistory()}
                        disabled={isProcessing}
                        className="w-full h-1.5 bg-dark-100 rounded-full appearance-none cursor-pointer accent-accent-primary disabled:opacity-50"
                      />
                    </div>
                  );
                })}
              </div>

              <div className="pt-3 border-t border-dark-100">
                <p className="text-xs text-gray-400 mb-2 flex items-center gap-1.5">
                  <Sparkles size={12} />
                  特效
                </p>
                <div className="grid grid-cols-4 gap-1.5">
                  {STYLE_PRESETS.map((preset) => {
                    const active = isFilterActive(preset.type);
                    return (
                      <button
                        key={preset.type}
                        onClick={() => toggleStyleFilter(preset.type)}
                        className={clsx(
                          'py-2 px-1 rounded-lg text-[10px] font-medium transition-all border',
                          active
                            ? `${preset.color} text-white border-white/20 shadow-lg`
                            : 'bg-dark-300 text-gray-400 border-dark-100 hover:border-dark-100 hover:text-gray-300'
                        )}
                      >
                        {preset.name}
                      </button>
                    );
                  })}
                </div>
              </div>

              <button
                onClick={() => updateLayerStyle(activeLayer.id, { filters: [] })}
                className="w-full mt-3 py-2 text-xs text-gray-400 hover:text-white bg-dark-300 hover:bg-dark-200 rounded-lg transition-colors"
              >
                <Camera size={14} className="inline mr-1 -mt-0.5" />
                重置所有
              </button>
            </>
          )}
        </div>
      ) : (
        <div className="p-3">
          <div className="grid grid-cols-2 gap-2">
            {PREVIEW_PRESETS.map((preset) => (
              <button
                key={preset.name}
                onClick={() => applyPreset(preset)}
                className="group relative aspect-[4/3] rounded-lg overflow-hidden bg-dark-300 border border-dark-100 hover:border-accent-primary transition-all"
              >
                <div className="absolute inset-0 bg-gradient-to-br from-dark-200 to-dark-400 group-hover:from-accent-primary/20 group-hover:to-accent-secondary/20 transition-all" />
                <div className="absolute inset-0 flex flex-col items-center justify-center">
                  <div className="w-10 h-10 rounded-full bg-dark-200/80 flex items-center justify-center mb-1.5">
                    <Sparkles size={18} className="text-gray-400 group-hover:text-accent-primary" />
                  </div>
                  <span className="text-xs font-medium text-gray-300 group-hover:text-white">{preset.name}</span>
                </div>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
