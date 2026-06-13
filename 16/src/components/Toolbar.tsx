import { useCallback, useEffect } from 'react';
import {
  Undo2, Redo2, Upload, Download, Image, Wand2,
  ZoomIn, ZoomOut, Maximize2, Copy, Trash2, Eye, Lock,
  Plus, FolderUp, Layers
} from 'lucide-react';
import { useEditorStore } from '@/store/useEditorStore';
import type { Layer } from '@/types';
import clsx from 'clsx';

interface ToolbarProps {
  toolMode: string;
  setToolMode: (mode: any) => void;
  zoom: number;
  setZoom: (zoom: number) => void;
  onFileUpload: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onExport: () => void;
  onSegmentation: () => void;
  activeLayer?: Layer;
}

export const Toolbar = ({
  toolMode,
  setToolMode,
  zoom,
  setZoom,
  onFileUpload,
  onExport,
  onSegmentation,
  activeLayer,
}: ToolbarProps) => {
  const {
    canUndo,
    canRedo,
    undo,
    redo,
    setCanvasSize,
    duplicateLayer,
    removeLayer,
    toggleLayerVisibility,
    toggleLayerLock,
    addLayer,
    layers,
    selection,
    saveHistory,
  } = useEditorStore();

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey) {
        if (e.key === 'z' && !e.shiftKey) {
          e.preventDefault();
          undo();
        } else if ((e.key === 'z' && e.shiftKey) || (e.key === 'y')) {
          e.preventDefault();
          redo();
        } else if (e.key === 'd' && selection.activeLayerId) {
          e.preventDefault();
          duplicateLayer(selection.activeLayerId);
        } else if (e.key === 's') {
          e.preventDefault();
          onExport();
        }
      }
      
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (selection.activeLayerId && document.activeElement?.tagName !== 'INPUT') {
          e.preventDefault();
          removeLayer(selection.activeLayerId);
          saveHistory();
        }
      }
      
      if (e.key === 'v') setToolMode('select');
      if (e.key === 'm') setToolMode('move');
      if (e.key === 'c') setToolMode('crop');
      if (e.key === 'b') setToolMode('brush');
      if (e.key === 'e') setToolMode('eraser');
      if (e.key === 't') setToolMode('text');
      if (e.key === 'u') setToolMode('shape');
      
      if (e.key === '+' || e.key === '=') {
        e.preventDefault();
        setZoom(Math.min(10, zoom * 1.1));
      }
      if (e.key === '-') {
        e.preventDefault();
        setZoom(Math.max(0.1, zoom / 1.1));
      }
      if (e.key === '0') {
        e.preventDefault();
        setZoom(1);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [undo, redo, duplicateLayer, removeLayer, saveHistory, selection.activeLayerId, setToolMode, zoom, setZoom, onExport]);

  const handleFitToScreen = useCallback(() => {
    const store = useEditorStore.getState();
    if (layers.length === 0) {
      setZoom(1);
      return;
    }
    
    const container = document.querySelector('.flex-1.overflow-hidden') as HTMLElement;
    if (!container) return;
    
    const padding = 80;
    const availableW = container.clientWidth - padding * 2;
    const availableH = container.clientHeight - padding * 2;
    
    const scaleX = availableW / store.canvas.width;
    const scaleY = availableH / store.canvas.height;
    
    setZoom(Math.min(scaleX, scaleY));
  }, [layers.length, setZoom]);

  const handleAddImageLayer = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = onFileUpload as any;
    input.click();
  };

  return (
    <div className="h-12 bg-dark-500 border-b border-dark-100 flex items-center px-2 gap-1">
      <div className="flex items-center gap-1 pr-2 border-r border-dark-100">
        <div className="flex items-center gap-1 px-2">
          <Layers size={18} className="text-accent-primary" />
          <span className="text-sm font-semibold text-white">PixelForge</span>
        </div>
      </div>

      <div className="flex items-center gap-1 px-2 border-r border-dark-100">
        <button
          onClick={undo}
          disabled={!canUndo()}
          className={clsx(
            'btn-tool',
            !canUndo() && 'opacity-30 cursor-not-allowed hover:bg-transparent hover:text-gray-400'
          )}
          title="撤销 (Ctrl+Z)"
        >
          <Undo2 size={18} />
        </button>
        <button
          onClick={redo}
          disabled={!canRedo()}
          className={clsx(
            'btn-tool',
            !canRedo() && 'opacity-30 cursor-not-allowed hover:bg-transparent hover:text-gray-400'
          )}
          title="重做 (Ctrl+Shift+Z)"
        >
          <Redo2 size={18} />
        </button>
      </div>

      <div className="flex items-center gap-1 px-2 border-r border-dark-100">
        <label className="btn-tool cursor-pointer" title="上传文件">
          <Upload size={18} />
          <input
            type="file"
            accept="image/*,.psd"
            className="hidden"
            onChange={onFileUpload}
          />
        </label>
        <button
          className="btn-tool"
          title="AI智能抠图"
          onClick={onSegmentation}
        >
          <Wand2 size={18} />
        </button>
      </div>

      <div className="flex items-center gap-1 px-2 border-r border-dark-100">
        <button
          onClick={handleFitToScreen}
          className="btn-tool"
          title="适应屏幕"
        >
          <Maximize2 size={18} />
        </button>
        <button
          onClick={() => setZoom(Math.min(10, zoom * 1.2))}
          className="btn-tool"
          title="放大"
        >
          <ZoomIn size={18} />
        </button>
        <div className="min-w-[60px] text-center text-sm text-gray-300 font-medium">
          {Math.round(zoom * 100)}%
        </div>
        <button
          onClick={() => setZoom(Math.max(0.1, zoom / 1.2))}
          className="btn-tool"
          title="缩小"
        >
          <ZoomOut size={18} />
        </button>
      </div>

      <div className="flex items-center gap-1 px-2 border-r border-dark-100">
        <button
          onClick={handleAddImageLayer}
          className="btn-tool"
          title="添加图片"
        >
          <Image size={18} />
        </button>
        <button
          className="btn-tool"
          title="添加文件夹"
          disabled
        >
          <FolderUp size={18} />
        </button>
        <button
          className="btn-tool"
          title="添加新图层"
          disabled
        >
          <Plus size={18} />
        </button>
      </div>

      {activeLayer && (
        <div className="flex items-center gap-1 px-2 border-r border-dark-100">
          <button
            onClick={() => toggleLayerVisibility(activeLayer.id)}
            className={clsx(
              'btn-tool',
              !activeLayer.style.visible && 'text-accent-secondary'
            )}
            title={activeLayer.style.visible ? '隐藏图层' : '显示图层'}
          >
            <Eye size={18} />
          </button>
          <button
            onClick={() => toggleLayerLock(activeLayer.id)}
            className={clsx(
              'btn-tool',
              activeLayer.style.locked && 'text-yellow-500'
            )}
            title={activeLayer.style.locked ? '解锁图层' : '锁定图层'}
          >
            <Lock size={18} />
          </button>
          <button
            onClick={() => duplicateLayer(activeLayer.id)}
            className="btn-tool"
            title="复制图层 (Ctrl+D)"
          >
            <Copy size={18} />
          </button>
          <button
            onClick={() => {
              removeLayer(activeLayer.id);
              saveHistory();
            }}
            className="btn-tool hover:text-red-400"
            title="删除图层 (Delete)"
          >
            <Trash2 size={18} />
          </button>
        </div>
      )}

      <div className="flex-1" />

      <div className="flex items-center gap-1 px-2">
        <button
          onClick={() => setCanvasSize(1920, 1080)}
          className="px-3 h-9 rounded-md text-xs text-gray-400 hover:text-white hover:bg-dark-100 transition-colors"
        >
          1920×1080
        </button>
      </div>

      <div className="flex items-center gap-1 pl-2 border-l border-dark-100">
        <button
          onClick={onExport}
          className="h-10 px-4 rounded-md bg-gradient-to-r from-accent-primary to-accent-secondary text-white text-sm font-medium hover:opacity-90 transition-opacity shadow-lg shadow-accent-primary/25 flex items-center gap-2"
        >
          <Download size={16} />
          导出
        </button>
      </div>
    </div>
  );
};
