import { useState } from 'react';
import { useEditorStore, startTransaction, commitTransaction } from '@/store/useEditorStore';
import type { BlendMode, ShadowConfig } from '@/types';
import { ChevronDown, ChevronRight, Sun, Layers, Droplets, Move, RotateCw, Scaling } from 'lucide-react';

const BLEND_MODES: { value: BlendMode; label: string; category: string }[] = [
  { value: 'normal', label: '正常', category: '常用' },
  { value: 'multiply', label: '正片叠底', category: '变暗' },
  { value: 'darken', label: '变暗', category: '变暗' },
  { value: 'color-burn', label: '颜色加深', category: '变暗' },
  { value: 'screen', label: '滤色', category: '变亮' },
  { value: 'lighten', label: '变亮', category: '变亮' },
  { value: 'color-dodge', label: '颜色减淡', category: '变亮' },
  { value: 'overlay', label: '叠加', category: '对比' },
  { value: 'soft-light', label: '柔光', category: '对比' },
  { value: 'hard-light', label: '强光', category: '对比' },
  { value: 'difference', label: '差值', category: '反相' },
  { value: 'exclusion', label: '排除', category: '反相' },
  { value: 'hue', label: '色相', category: '色彩' },
  { value: 'saturation', label: '饱和度', category: '色彩' },
  { value: 'color', label: '颜色', category: '色彩' },
  { value: 'luminosity', label: '明度', category: '色彩' },
];

export const PropertiesPanel = () => {
  const { layers, selection, updateLayerStyle, updateLayerTransform, updateLayerBlendMode, updateLayerOpacity, saveHistory } = useEditorStore();
  
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({
    transform: true,
    blend: true,
    shadow: false,
  });

  const activeLayer = layers.find(l => l.id === selection.activeLayerId);

  const toggleSection = (section: string) => {
    setExpandedSections(prev => ({ ...prev, [section]: !prev[section] }));
  };

  if (!activeLayer) {
    return (
      <div className="h-full flex flex-col items-center justify-center text-gray-500 p-6">
        <Layers size={40} className="mb-3 opacity-30" />
        <p className="text-sm">选择一个图层</p>
        <p className="text-xs opacity-60 mt-1">查看和编辑属性</p>
      </div>
    );
  }

  const Section = ({ id, title, icon, children }: { id: string; title: string; icon: React.ReactNode; children: React.ReactNode }) => (
    <div className="border-b border-dark-100">
      <button
        onClick={() => toggleSection(id)}
        className="w-full panel-header hover:bg-dark-300/50 transition-colors cursor-pointer"
      >
        <div className="flex items-center gap-2">
          {expandedSections[id] ? <ChevronDown size={14} className="text-gray-400" /> : <ChevronRight size={14} className="text-gray-400" />}
          <span className="text-gray-400">{icon}</span>
          <span className="panel-title">{title}</span>
        </div>
      </button>
      {expandedSections[id] && <div className="p-3 space-y-4">{children}</div>}
    </div>
  );

  const Slider = ({
    label,
    value,
    min,
    max,
    step = 1,
    unit = '',
    onChange,
    onCommit,
  }: {
    label: string;
    value: number;
    min: number;
    max: number;
    step?: number;
    unit?: string;
    onChange: (v: number) => void;
    onCommit?: () => void;
  }) => (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <label className="text-xs text-gray-400">{label}</label>
        <span className="text-xs text-gray-300 font-mono">
          {Number.isInteger(step) ? Math.round(value) : value.toFixed(2)}{unit}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        onMouseUp={onCommit}
        onTouchEnd={onCommit}
        className="w-full h-2 bg-dark-100 rounded-full appearance-none cursor-pointer accent-accent-primary"
      />
    </div>
  );

  const handleTransformChange = (field: string, value: number) => {
    startTransaction();
    updateLayerTransform(activeLayer.id, { [field]: value });
  };

  const handleTransformCommit = () => {
    commitTransaction();
  };

  const categorizedBlendModes = BLEND_MODES.reduce((acc, mode) => {
    if (!acc[mode.category]) acc[mode.category] = [];
    acc[mode.category].push(mode);
    return acc;
  }, {} as Record<string, typeof BLEND_MODES>);

  return (
    <div className="h-full overflow-y-auto">
      <div className="panel-header bg-dark-300">
        <span className="panel-title flex items-center gap-2">
          <Layers size={14} />
          属性
        </span>
      </div>

      <Section id="transform" title="变换" icon={<Move size={14} />}>
        <div className="grid grid-cols-2 gap-3">
          <Slider
            label="X 位置"
            value={activeLayer.transform.x}
            min={-5000}
            max={5000}
            onChange={(v) => handleTransformChange('x', v)}
            onCommit={handleTransformCommit}
            unit="px"
          />
          <Slider
            label="Y 位置"
            value={activeLayer.transform.y}
            min={-5000}
            max={5000}
            onChange={(v) => handleTransformChange('y', v)}
            onCommit={handleTransformCommit}
            unit="px"
          />
          <Slider
            label="宽度"
            value={activeLayer.transform.width}
            min={1}
            max={10000}
            onChange={(v) => handleTransformChange('width', v)}
            onCommit={handleTransformCommit}
            unit="px"
          />
          <Slider
            label="高度"
            value={activeLayer.transform.height}
            min={1}
            max={10000}
            onChange={(v) => handleTransformChange('height', v)}
            onCommit={handleTransformCommit}
            unit="px"
          />
        </div>

        <div className="grid grid-cols-2 gap-3 pt-2 border-t border-dark-100">
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-xs text-gray-400 flex items-center gap-1">
                <Scaling size={12} /> 水平缩放
              </label>
              <span className="text-xs text-gray-300 font-mono">{Math.round(activeLayer.transform.scaleX * 100)}%</span>
            </div>
            <input
              type="range"
              min={0.01}
              max={5}
              step={0.01}
              value={activeLayer.transform.scaleX}
              onChange={(e) => handleTransformChange('scaleX', parseFloat(e.target.value))}
              onMouseUp={handleTransformCommit}
              className="w-full h-2 bg-dark-100 rounded-full appearance-none cursor-pointer accent-accent-primary"
            />
          </div>
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-xs text-gray-400 flex items-center gap-1">
                <Scaling size={12} /> 垂直缩放
              </label>
              <span className="text-xs text-gray-300 font-mono">{Math.round(activeLayer.transform.scaleY * 100)}%</span>
            </div>
            <input
              type="range"
              min={0.01}
              max={5}
              step={0.01}
              value={activeLayer.transform.scaleY}
              onChange={(e) => handleTransformChange('scaleY', parseFloat(e.target.value))}
              onMouseUp={handleTransformCommit}
              className="w-full h-2 bg-dark-100 rounded-full appearance-none cursor-pointer accent-accent-primary"
            />
          </div>
        </div>

        <div className="pt-2 border-t border-dark-100">
          <div className="flex items-center justify-between mb-1.5">
            <label className="text-xs text-gray-400 flex items-center gap-1">
              <RotateCw size={12} /> 旋转
            </label>
            <span className="text-xs text-gray-300 font-mono">{Math.round(activeLayer.transform.rotation * 180 / Math.PI)}°</span>
          </div>
          <input
            type="range"
            min={-Math.PI * 2}
            max={Math.PI * 2}
            step={0.01}
            value={activeLayer.transform.rotation}
            onChange={(e) => handleTransformChange('rotation', parseFloat(e.target.value))}
            onMouseUp={handleTransformCommit}
            className="w-full h-2 bg-dark-100 rounded-full appearance-none cursor-pointer accent-accent-primary"
          />
        </div>
      </Section>

      <Section id="blend" title="混合选项" icon={<Droplets size={14} />}>
        <div>
          <label className="block text-xs text-gray-400 mb-2">混合模式</label>
          <select
            value={activeLayer.style.blendMode}
            onChange={(e) => updateLayerBlendMode(activeLayer.id, e.target.value as BlendMode)}
            className="select-field"
          >
            {Object.entries(categorizedBlendModes).map(([category, modes]) => (
              <optgroup key={category} label={category}>
                {modes.map(mode => (
                  <option key={mode.value} value={mode.value}>{mode.label}</option>
                ))}
              </optgroup>
            ))}
          </select>
        </div>

        <Slider
          label="不透明度"
          value={activeLayer.style.opacity * 100}
          min={0}
          max={100}
          onChange={(v) => updateLayerOpacity(activeLayer.id, v / 100)}
          onCommit={() => saveHistory()}
          unit="%"
        />
      </Section>

      <Section id="shadow" title="图层样式" icon={<Sun size={14} />}>
        <ShadowConfigEditor
          layerId={activeLayer.id}
          shadow={activeLayer.style.shadow}
          updateLayerStyle={updateLayerStyle}
          saveHistory={saveHistory}
        />
      </Section>
    </div>
  );
};

const ShadowConfigEditor = ({
  layerId,
  shadow,
  updateLayerStyle,
  saveHistory,
}: {
  layerId: string;
  shadow: ShadowConfig;
  updateLayerStyle: (id: string, style: Partial<any>) => void;
  saveHistory: () => void;
}) => {
  const updateShadow = (updates: Partial<ShadowConfig>) => {
    updateLayerStyle(layerId, {
      shadow: { ...shadow, ...updates },
    });
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <label className="text-sm text-gray-300 font-medium flex items-center gap-2">
          <input
            type="checkbox"
            checked={shadow.enabled}
            onChange={(e) => {
              updateShadow({ enabled: e.target.checked });
              saveHistory();
            }}
            className="w-4 h-4 rounded accent-accent-primary"
          />
          投影效果
        </label>
      </div>

      {shadow.enabled && (
        <>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-gray-400 mb-1.5">X 偏移</label>
              <input
                type="range"
                min={-100}
                max={100}
                value={shadow.offsetX}
                onChange={(e) => updateShadow({ offsetX: parseInt(e.target.value) })}
                onMouseUp={saveHistory}
                className="w-full h-2 bg-dark-100 rounded-full appearance-none cursor-pointer accent-accent-primary"
              />
              <div className="text-right text-xs text-gray-500 mt-0.5">{shadow.offsetX}px</div>
            </div>
            <div>
              <label className="block text-xs text-gray-400 mb-1.5">Y 偏移</label>
              <input
                type="range"
                min={-100}
                max={100}
                value={shadow.offsetY}
                onChange={(e) => updateShadow({ offsetY: parseInt(e.target.value) })}
                onMouseUp={saveHistory}
                className="w-full h-2 bg-dark-100 rounded-full appearance-none cursor-pointer accent-accent-primary"
              />
              <div className="text-right text-xs text-gray-500 mt-0.5">{shadow.offsetY}px</div>
            </div>
          </div>

          <div>
            <label className="block text-xs text-gray-400 mb-1.5">模糊半径</label>
            <input
              type="range"
              min={0}
              max={200}
              value={shadow.blur}
              onChange={(e) => updateShadow({ blur: parseInt(e.target.value) })}
              onMouseUp={saveHistory}
              className="w-full h-2 bg-dark-100 rounded-full appearance-none cursor-pointer accent-accent-primary"
            />
            <div className="text-right text-xs text-gray-500 mt-0.5">{shadow.blur}px</div>
          </div>

          <div>
            <label className="block text-xs text-gray-400 mb-1.5">不透明度</label>
            <input
              type="range"
              min={0}
              max={100}
              value={shadow.opacity * 100}
              onChange={(e) => updateShadow({ opacity: parseInt(e.target.value) / 100 })}
              onMouseUp={saveHistory}
              className="w-full h-2 bg-dark-100 rounded-full appearance-none cursor-pointer accent-accent-primary"
            />
            <div className="text-right text-xs text-gray-500 mt-0.5">{Math.round(shadow.opacity * 100)}%</div>
          </div>

          <div>
            <label className="block text-xs text-gray-400 mb-1.5">颜色</label>
            <div className="flex items-center gap-2">
              <input
                type="color"
                value={shadow.color}
                onChange={(e) => {
                  updateShadow({ color: e.target.value });
                  saveHistory();
                }}
                className="w-10 h-10 rounded border border-dark-100 bg-transparent cursor-pointer"
              />
              <input
                type="text"
                value={shadow.color}
                onChange={(e) => updateShadow({ color: e.target.value })}
                onBlur={saveHistory}
                className="flex-1 input-field font-mono text-xs"
              />
            </div>
          </div>
        </>
      )}
    </div>
  );
};
