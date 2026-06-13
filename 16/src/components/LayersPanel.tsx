import { useState, useRef, useCallback } from 'react';
import { useEditorStore } from '@/store/useEditorStore';
import type { Layer, ImageLayer } from '@/types';
import { Eye, EyeOff, Lock, Unlock, Plus, Trash2, Copy, ChevronDown, Image, Type, Square } from 'lucide-react';
import clsx from 'clsx';

export const LayersPanel = () => {
  const {
    layers,
    selection,
    setActiveLayer,
    toggleLayerVisibility,
    toggleLayerLock,
    duplicateLayer,
    removeLayer,
    moveLayer,
    updateLayer,
    saveHistory,
  } = useEditorStore();

  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const getLayerIcon = (layer: Layer) => {
    switch (layer.type) {
      case 'image': return <Image size={14} />;
      case 'text': return <Type size={14} />;
      case 'shape': return <Square size={14} />;
      default: return <Image size={14} />;
    }
  };

  const generateLayerThumbnail = (layer: ImageLayer): string => {
    if (!layer.originalImage) return '';
    try {
      const canvas = document.createElement('canvas');
      const maxSize = 48;
      const scale = Math.min(maxSize / layer.originalWidth, maxSize / layer.originalHeight, 1);
      canvas.width = Math.max(1, layer.originalWidth * scale);
      canvas.height = Math.max(1, layer.originalHeight * scale);
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(layer.originalImage, 0, 0, canvas.width, canvas.height);
      return canvas.toDataURL();
    } catch {
      return '';
    }
  };

  const handleDragStart = (e: React.DragEvent, index: number) => {
    setDraggedIndex(index);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault();
    setDragOverIndex(index);
  };

  const handleDrop = (e: React.DragEvent, index: number) => {
    e.preventDefault();
    if (draggedIndex !== null && draggedIndex !== index) {
      moveLayer(draggedIndex, index);
      saveHistory();
    }
    setDraggedIndex(null);
    setDragOverIndex(null);
  };

  const handleDragEnd = () => {
    setDraggedIndex(null);
    setDragOverIndex(null);
  };

  const startEditing = useCallback((layer: Layer) => {
    setEditingId(layer.id);
    setEditValue(layer.name);
    setTimeout(() => inputRef.current?.focus(), 0);
  }, []);

  const finishEditing = useCallback(() => {
    if (editingId && editValue.trim()) {
      updateLayer(editingId, { name: editValue.trim() });
    }
    setEditingId(null);
    setEditValue('');
  }, [editingId, editValue, updateLayer]);

  const reversedLayers = [...layers].reverse();
  const reversedIndices = layers.map((_, i) => i).reverse();

  return (
    <div className="flex flex-col flex-1 overflow-hidden border-t border-dark-100">
      <div className="panel-header">
        <div className="flex items-center gap-2">
          <ChevronDown size={14} className="text-gray-400" />
          <span className="panel-title">图层</span>
          <span className="text-xs text-gray-500">({layers.length})</span>
        </div>
        <div className="flex items-center gap-1">
          <button
            className="p-1 text-gray-400 hover:text-white transition-colors rounded"
            title="新建图层"
            disabled
          >
            <Plus size={14} />
          </button>
          <button
            onClick={() => {
              if (selection.activeLayerId) {
                duplicateLayer(selection.activeLayerId);
              }
            }}
            className="p-1 text-gray-400 hover:text-white transition-colors rounded disabled:opacity-30"
            disabled={!selection.activeLayerId}
            title="复制图层"
          >
            <Copy size={14} />
          </button>
          <button
            onClick={() => {
              if (selection.activeLayerId) {
                removeLayer(selection.activeLayerId);
                saveHistory();
              }
            }}
            className="p-1 text-gray-400 hover:text-red-400 transition-colors rounded disabled:opacity-30"
            disabled={!selection.activeLayerId}
            title="删除图层"
          >
            <Trash2 size={14} />
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-1 space-y-0.5">
        {reversedLayers.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-gray-500 py-8">
            <Image size={32} className="mb-2 opacity-30" />
            <p className="text-xs">暂无图层</p>
            <p className="text-xs opacity-60 mt-1">上传图片开始创作</p>
          </div>
        ) : (
          reversedLayers.map((layer, displayIndex) => {
            const originalIndex = reversedIndices[displayIndex];
            const isActive = selection.activeLayerId === layer.id;
            const thumbnail = layer.type === 'image' 
              ? generateLayerThumbnail(layer as ImageLayer) 
              : '';
            
            return (
              <div
                key={layer.id}
                draggable
                onDragStart={(e) => handleDragStart(e, originalIndex)}
                onDragOver={(e) => handleDragOver(e, originalIndex)}
                onDrop={(e) => handleDrop(e, originalIndex)}
                onDragEnd={handleDragEnd}
                onClick={() => setActiveLayer(layer.id)}
                onDoubleClick={() => startEditing(layer)}
                className={clsx(
                  'layer-item rounded-md group',
                  isActive && 'layer-item-active',
                  draggedIndex === originalIndex && 'opacity-50',
                  dragOverIndex === originalIndex && draggedIndex !== originalIndex && 'border-t-2 border-accent-primary'
                )}
              >
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    toggleLayerVisibility(layer.id);
                  }}
                  className="p-1 text-gray-400 hover:text-white transition-colors flex-shrink-0"
                  title={layer.style.visible ? '隐藏' : '显示'}
                >
                  {layer.style.visible ? <Eye size={14} /> : <EyeOff size={14} />}
                </button>

                <div className="w-10 h-10 rounded bg-dark-300 flex items-center justify-center overflow-hidden flex-shrink-0 border border-dark-100">
                  {thumbnail ? (
                    <img
                      src={thumbnail}
                      alt=""
                      className="w-full h-full object-cover"
                      draggable={false}
                    />
                  ) : (
                    <span className="text-gray-500">{getLayerIcon(layer)}</span>
                  )}
                </div>

                <div className="flex-1 min-w-0">
                  {editingId === layer.id ? (
                    <input
                      ref={inputRef}
                      value={editValue}
                      onChange={(e) => setEditValue(e.target.value)}
                      onBlur={finishEditing}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') finishEditing();
                        if (e.key === 'Escape') {
                          setEditingId(null);
                          setEditValue('');
                        }
                      }}
                      onClick={(e) => e.stopPropagation()}
                      className="w-full bg-dark-200 border border-accent-primary rounded px-1 py-0.5 text-xs text-white outline-none"
                    />
                  ) : (
                    <>
                      <p className={clsx(
                        'text-xs font-medium truncate',
                        layer.style.visible ? 'text-gray-200' : 'text-gray-500'
                      )}>
                        {layer.name}
                      </p>
                      <p className="text-[10px] text-gray-500 truncate">
                        {layer.type === 'image' && `${Math.round(layer.transform.width)}×${Math.round(layer.transform.height)}`}
                        {layer.type === 'text' && '文字图层'}
                        {layer.type === 'shape' && '形状图层'}
                        {layer.style.blendMode !== 'normal' && ` · ${layer.style.blendMode}`}
                      </p>
                    </>
                  )}
                </div>

                <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleLayerLock(layer.id);
                    }}
                    className={clsx(
                      'p-1 rounded transition-colors',
                      layer.style.locked ? 'text-yellow-500' : 'text-gray-500 hover:text-white'
                    )}
                    title={layer.style.locked ? '解锁' : '锁定'}
                  >
                    {layer.style.locked ? <Lock size={12} /> : <Unlock size={12} />}
                  </button>
                </div>

                <div className="w-5 text-right flex-shrink-0">
                  <span className="text-[10px] text-gray-500">
                    {Math.round(layer.style.opacity * 100)}%
                  </span>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};
