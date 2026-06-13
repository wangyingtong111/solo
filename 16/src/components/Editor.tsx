import { useEffect, useRef, useState, useCallback } from 'react';
import { useEditorStore } from '@/store/useEditorStore';
import { WebGLRenderer } from '@/engine/WebGLRenderer';
import { Toolbar } from './Toolbar';
import { LayersPanel } from './LayersPanel';
import { PropertiesPanel } from './PropertiesPanel';
import { FiltersPanel } from './FiltersPanel';
import { ExportModal } from './ExportModal';
import { SegmentationModal } from './SegmentationModal';
import { filterService } from '@/services/FilterService';
import { exportService, type ExportFormat } from '@/services/ExportService';
import { psdParserService } from '@/services/PSDParserService';
import { segmentationService } from '@/services/SegmentationService';
import type { ImageLayer, Layer } from '@/types';
import { createDefaultStyle, createDefaultTransform } from '@/utils/layer';
import { generateId } from '@/utils/id';
import clsx from 'clsx';
import { startTransaction, commitTransaction } from '@/store/useEditorStore';

interface EditorProps {
  initialFile: File | null;
}

type ToolMode = 'select' | 'move' | 'crop' | 'brush' | 'eraser' | 'text' | 'shape';

export const Editor = ({ initialFile }: EditorProps) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<WebGLRenderer | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  
  const [toolMode, setToolMode] = useState<ToolMode>('select');
  const [showExport, setShowExport] = useState(false);
  const [showSegmentation, setShowSegmentation] = useState(false);
  const [isPanning, setIsPanning] = useState(false);
  const [viewport, setViewport] = useState({ x: 0, y: 0, width: 0, height: 0, zoom: 1 });
  const [isDraggingLayer, setIsDraggingLayer] = useState(false);
  const dragStartRef = useRef({ x: 0, y: 0, layerX: 0, layerY: 0 });

  const {
    layers,
    canvas,
    selection,
    setCanvasSize,
    setZoom,
    setPan,
    addLayer,
    updateLayer,
    updateLayerTransform,
    setActiveLayer,
  } = useEditorStore();

  const loadImageFile = useCallback(async (file: File) => {
    if (file.name.toLowerCase().endsWith('.psd')) {
      try {
        const psdLayers = await psdParserService.parseFile(file);
        const canvasSize = psdParserService.getCanvasSize();
        
        if (canvasSize) {
          setCanvasSize(canvasSize.width, canvasSize.height);
        }
        
        const editorLayers = psdParserService.convertToEditorLayers(
          psdLayers, 
          canvasSize?.width || 1920, 
          canvasSize?.height || 1080
        );
        
        for (const layer of editorLayers) {
          if (layer.type === 'image' && rendererRef.current && (layer as ImageLayer).originalImage) {
            await new Promise<void>((resolve) => {
              if ((layer as ImageLayer).originalImage!.complete) {
                resolve();
              } else {
                (layer as ImageLayer).originalImage!.onload = () => resolve();
              }
            });
            
            const { id: textureId } = rendererRef.current.createTexture((layer as ImageLayer).originalImage!);
            (layer as any).textureId = textureId;
          }
          
          useEditorStore.setState(state => ({
            layers: [...state.layers, layer],
            selection: {
              activeLayerId: layer.id,
              selectedLayerIds: [layer.id],
              marquee: null,
            },
          }));
        }
        
        useEditorStore.getState().saveHistory();
      } catch (error) {
        console.error('PSD parse error:', error);
      }
      return;
    }

    const img = new Image();
    const url = URL.createObjectURL(file);
    
    img.onload = () => {
      const tempCanvas = document.createElement('canvas');
      tempCanvas.width = img.width;
      tempCanvas.height = img.height;
      const tempCtx = tempCanvas.getContext('2d')!;
      tempCtx.drawImage(img, 0, 0);
      const imageData = tempCtx.getImageData(0, 0, img.width, img.height);
      
      const scale = Math.min(canvas.width / img.width, canvas.height / img.height, 1) * 0.8;
      const finalWidth = img.width * scale;
      const finalHeight = img.height * scale;
      
      let textureId: string | null = null;
      if (rendererRef.current) {
        const result = rendererRef.current.createTexture(img);
        textureId = result.id;
      }
      
      const newLayer: ImageLayer = {
        id: generateId(),
        name: file.name.replace(/\.[^.]+$/, ''),
        type: 'image',
        style: createDefaultStyle(),
        transform: {
          ...createDefaultTransform(),
          x: (canvas.width - finalWidth) / 2,
          y: (canvas.height - finalHeight) / 2,
          width: finalWidth,
          height: finalHeight,
          scaleX: finalWidth / img.width,
          scaleY: finalHeight / img.height,
        },
        mask: { enabled: false, data: null, invert: false },
        parentId: null,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        imageData,
        textureId,
        originalImage: img,
        originalWidth: img.width,
        originalHeight: img.height,
      };
      
      addLayer(newLayer as any);
      URL.revokeObjectURL(url);
    };
    
    img.src = url;
  }, [addLayer, canvas.width, canvas.height, setCanvasSize]);

  useEffect(() => {
    if (!canvasRef.current || !containerRef.current) return;
    
    try {
      rendererRef.current = new WebGLRenderer(canvasRef.current);
      exportService.setRenderer(rendererRef.current);
      
      const rect = containerRef.current.getBoundingClientRect();
      rendererRef.current.resize(rect.width, rect.height);
      setViewport(v => ({ ...v, width: rect.width, height: rect.height }));
    } catch (e) {
      console.error('Failed to initialize WebGL renderer:', e);
    }
    
    return () => {
      rendererRef.current?.destroy();
      filterService.destroy();
      segmentationService.destroy();
    };
  }, []);

  useEffect(() => {
    if (initialFile) {
      loadImageFile(initialFile);
    }
  }, [initialFile, loadImageFile]);

  useEffect(() => {
    const render = () => {
      if (rendererRef.current && canvasRef.current && containerRef.current) {
        const rect = containerRef.current.getBoundingClientRect();
        
        rendererRef.current.render(
          layers,
          {
            x: canvas.panX,
            y: canvas.panY,
            width: rect.width,
            height: rect.height,
            zoom: canvas.zoom,
          },
          canvas.backgroundColor
        );
      }
      animationFrameRef.current = requestAnimationFrame(render);
    };
    
    animationFrameRef.current = requestAnimationFrame(render);
    
    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, [layers, canvas.panX, canvas.panY, canvas.zoom, canvas.backgroundColor]);

  useEffect(() => {
    const handleResize = () => {
      if (!containerRef.current || !rendererRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      rendererRef.current.resize(rect.width, rect.height);
      setViewport(v => ({ ...v, width: rect.width, height: rect.height }));
    };
    
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? 0.9 : 1.1;
    const newZoom = Math.max(0.1, Math.min(10, canvas.zoom * delta));
    setZoom(newZoom);
  }, [canvas.zoom, setZoom]);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button === 1 || (e.button === 0 && e.altKey)) {
      setIsPanning(true);
      return;
    }
    
    if (toolMode === 'select' || toolMode === 'move') {
      const activeLayer = layers.find(l => l.id === selection.activeLayerId);
      if (activeLayer && !activeLayer.style.locked) {
        setIsDraggingLayer(true);
        dragStartRef.current = {
          x: e.clientX,
          y: e.clientY,
          layerX: activeLayer.transform.x,
          layerY: activeLayer.transform.y,
        };
      }
    }
  }, [toolMode, layers, selection.activeLayerId]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (isPanning) {
      setPan(
        canvas.panX - e.movementX / canvas.zoom,
        canvas.panY - e.movementY / canvas.zoom
      );
      return;
    }
    
    if (isDraggingLayer && selection.activeLayerId) {
      const dx = (e.clientX - dragStartRef.current.x) / canvas.zoom;
      const dy = (e.clientY - dragStartRef.current.y) / canvas.zoom;
      updateLayerTransform(selection.activeLayerId, {
        x: dragStartRef.current.layerX + dx,
        y: dragStartRef.current.layerY + dy,
      });
    }
  }, [isPanning, isDraggingLayer, canvas.panX, canvas.panY, canvas.zoom, selection.activeLayerId, setPan, updateLayerTransform]);

  const handleMouseUp = useCallback(() => {
    if (isDraggingLayer) {
      useEditorStore.getState().saveHistory();
    }
    setIsPanning(false);
    setIsDraggingLayer(false);
  }, [isDraggingLayer]);

  const handleCanvasClick = useCallback((e: React.MouseEvent) => {
    if (!containerRef.current || isDraggingLayer || isPanning) return;
    
    const rect = containerRef.current.getBoundingClientRect();
    const clickX = (e.clientX - rect.left - viewport.width / 2) / canvas.zoom + canvas.panX;
    const clickY = (e.clientY - rect.top - viewport.height / 2) / canvas.zoom + canvas.panY;
    
    for (let i = layers.length - 1; i >= 0; i--) {
      const layer = layers[i];
      if (!layer.style.visible) continue;
      
      const { x, y, width, height } = layer.transform;
      if (clickX >= x && clickX <= x + width && clickY >= y && clickY <= y + height) {
        setActiveLayer(layer.id);
        break;
      }
    }
  }, [layers, viewport, canvas, isDraggingLayer, isPanning, setActiveLayer]);

  const handleFileUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      loadImageFile(file);
    }
    e.target.value = '';
  }, [loadImageFile]);

  const handleExport = useCallback(async (format: ExportFormat, quality: number) => {
    try {
      const blob = await exportService.export(layers, { width: canvas.width, height: canvas.height }, {
        format,
        quality,
        scale: 1,
        transparent: true,
      });
      exportService.download(blob, exportService.getFilename('pixelforge', format));
    } catch (error) {
      console.error('Export error:', error);
    }
  }, [layers, canvas.width, canvas.height]);

  const activeLayer = layers.find(l => l.id === selection.activeLayerId);

  const getActiveLayerImageData = useCallback((): ImageData | null => {
    if (!activeLayer || activeLayer.type !== 'image') return null;
    const imgLayer = activeLayer as ImageLayer;
    
    if (imgLayer.imageData) return imgLayer.imageData;
    
    if (imgLayer.originalImage) {
      const tempCanvas = document.createElement('canvas');
      tempCanvas.width = imgLayer.originalWidth;
      tempCanvas.height = imgLayer.originalHeight;
      const tempCtx = tempCanvas.getContext('2d')!;
      tempCtx.drawImage(imgLayer.originalImage, 0, 0);
      return tempCtx.getImageData(0, 0, tempCanvas.width, tempCanvas.height);
    }
    
    return null;
  }, [activeLayer]);

  const handleApplySegmentationMask = useCallback((mask: Uint8ClampedArray) => {
    if (!activeLayer || activeLayer.type !== 'image') return;
    
    startTransaction();
    useEditorStore.getState().updateLayer(activeLayer.id, {
      mask: {
        enabled: true,
        data: mask,
        invert: false,
      },
    });
    commitTransaction();
  }, [activeLayer]);

  const segmentationImageData = getActiveLayerImageData();

  return (
    <div className="w-full h-full flex flex-col bg-dark-600">
      <Toolbar
        toolMode={toolMode}
        setToolMode={setToolMode}
        zoom={canvas.zoom}
        setZoom={setZoom}
        onFileUpload={handleFileUpload}
        onExport={() => setShowExport(true)}
        onSegmentation={() => setShowSegmentation(true)}
        activeLayer={activeLayer}
      />
      
      <div className="flex flex-1 overflow-hidden">
        <div className="w-14 bg-dark-500 border-r border-dark-100 flex flex-col items-center py-2 gap-1">
          <ToolButton icon="select" active={toolMode === 'select'} onClick={() => setToolMode('select')} label="选择" />
          <ToolButton icon="move" active={toolMode === 'move'} onClick={() => setToolMode('move')} label="移动" />
          <ToolButton icon="crop" active={toolMode === 'crop'} onClick={() => setToolMode('crop')} label="裁剪" />
          <div className="w-8 h-px bg-dark-100 my-1" />
          <ToolButton icon="brush" active={toolMode === 'brush'} onClick={() => setToolMode('brush')} label="画笔" />
          <ToolButton icon="eraser" active={toolMode === 'eraser'} onClick={() => setToolMode('eraser')} label="橡皮擦" />
          <div className="w-8 h-px bg-dark-100 my-1" />
          <ToolButton icon="text" active={toolMode === 'text'} onClick={() => setToolMode('text')} label="文字" />
          <ToolButton icon="shape" active={toolMode === 'shape'} onClick={() => setToolMode('shape')} label="形状" />
        </div>
        
        <div
          ref={containerRef}
          className="flex-1 relative overflow-hidden checkerboard"
          onWheel={handleWheel}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
          onClick={handleCanvasClick}
          style={{ cursor: isPanning ? 'grabbing' : isDraggingLayer ? 'grabbing' : toolMode === 'select' ? 'pointer' : 'crosshair' }}
        >
          <canvas
            ref={canvasRef}
            className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 shadow-2xl"
            style={{
              width: canvas.width * canvas.zoom,
              height: canvas.height * canvas.zoom,
            }}
          />
          
          <div className="absolute bottom-4 left-4 bg-dark-400/90 backdrop-blur-sm rounded-lg px-3 py-1.5 text-xs text-gray-400 border border-dark-100">
            {canvas.width} × {canvas.height} · {Math.round(canvas.zoom * 100)}%
          </div>
          
          <div className="absolute top-4 left-4 bg-dark-400/90 backdrop-blur-sm rounded-lg px-3 py-1.5 text-xs text-gray-400 border border-dark-100">
            {layers.length} 个图层
          </div>
        </div>
        
        <div className="w-72 bg-dark-400 border-l border-dark-100 flex flex-col overflow-hidden">
          <FiltersPanel />
          <LayersPanel />
        </div>
        
        <div className="w-80 bg-dark-400 border-l border-dark-100 overflow-hidden">
          <PropertiesPanel />
        </div>
      </div>
      
      {showExport && (
        <ExportModal
          isOpen={showExport}
          onClose={() => setShowExport(false)}
          layers={layers}
          canvasSize={{ width: canvas.width, height: canvas.height }}
        />
      )}
      
      {showSegmentation && segmentationImageData && (
        <SegmentationModal
          isOpen={showSegmentation}
          onClose={() => setShowSegmentation(false)}
          imageData={segmentationImageData}
          onApply={handleApplySegmentationMask}
        />
      )}
    </div>
  );
};

const ToolButton = ({ icon, active, onClick, label }: { icon: string; active: boolean; onClick: () => void; label: string }) => {
  const icons: Record<string, string> = {
    select: '☝',
    move: '✥',
    crop: '⌗',
    brush: '🖌',
    eraser: '⌫',
    text: 'T',
    shape: '◇',
  };
  
  return (
    <button
      onClick={onClick}
      title={label}
      className={clsx(
        'w-10 h-10 rounded-lg flex items-center justify-center text-lg transition-all',
        active
          ? 'bg-accent-primary text-white shadow-lg shadow-accent-primary/30'
          : 'text-gray-400 hover:text-white hover:bg-dark-300'
      )}
    >
      {icons[icon]}
    </button>
  );
};
