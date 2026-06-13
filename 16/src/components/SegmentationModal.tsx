import { useState, useCallback, useEffect, useRef } from 'react';
import { X, Wand2, Brush, Eraser, RotateCcw, Download, Check, ChevronDown } from 'lucide-react';
import { segmentationService } from '@/services/SegmentationService';
import type { AISegmentationResult } from '@/types';

type ViewMode = 'overlay' | 'mask' | 'original';
type BrushMode = 'add' | 'remove';

interface SegmentationModalProps {
  isOpen: boolean;
  onClose: () => void;
  imageData: ImageData;
  onApply: (mask: Uint8ClampedArray) => void;
}

export const SegmentationModal = ({ isOpen, onClose, imageData, onApply }: SegmentationModalProps) => {
  const [progress, setProgress] = useState(0);
  const [isProcessing, setIsProcessing] = useState(true);
  const [segmentationResult, setSegmentationResult] = useState<AISegmentationResult | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>('overlay');
  const [brushMode, setBrushMode] = useState<BrushMode>('add');
  const [brushSize, setBrushSize] = useState(30);
  const [brushHardness, setBrushHardness] = useState(0.8);
  const [brushFeather, setBrushFeather] = useState(5);
  const [error, setError] = useState<string>('');
  const [isDrawing, setIsDrawing] = useState(false);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const overlayCanvasRef = useRef<HTMLCanvasElement>(null);
  const lastPointRef = useRef<{ x: number; y: number } | null>(null);
  const [showBrushSettings, setShowBrushSettings] = useState(false);

  const runSegmentation = useCallback(async () => {
    if (!isOpen) return;
    
    setIsProcessing(true);
    setProgress(0);
    setError('');
    
    try {
      segmentationService.initMaskCanvas(imageData.width, imageData.height);
      
      const result = await segmentationService.segmentImage(
        imageData,
        (p) => setProgress(p)
      );
      
      setSegmentationResult(result);
      
      segmentationService.initMaskCanvas(result.width, result.height, result.mask);
      
      drawPreview();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'AI分割失败');
    } finally {
      setIsProcessing(false);
    }
  }, [isOpen, imageData]);

  useEffect(() => {
    if (isOpen && imageData) {
      runSegmentation();
    }
  }, [isOpen, imageData, runSegmentation]);

  useEffect(() => {
    drawPreview();
  }, [viewMode, segmentationResult]);

  const drawPreview = useCallback(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;

    const { width, height } = imageData;
    canvas.width = width;
    canvas.height = height;

    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = width;
    tempCanvas.height = height;
    const tempCtx = tempCanvas.getContext('2d')!;
    tempCtx.putImageData(imageData, 0, 0);

    const maskCanvas = segmentationService.getMaskCanvas();

    switch (viewMode) {
      case 'original':
        ctx.drawImage(tempCanvas, 0, 0);
        break;
      case 'mask':
        if (maskCanvas) {
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(0, 0, width, height);
          ctx.globalCompositeOperation = 'source-in';
          ctx.drawImage(maskCanvas, 0, 0);
          ctx.globalCompositeOperation = 'destination-atop';
          ctx.fillStyle = '#000000';
          ctx.fillRect(0, 0, width, height);
          ctx.globalCompositeOperation = 'source-over';
        }
        break;
      case 'overlay':
      default:
        ctx.fillStyle = '#1a1a2e';
        ctx.fillRect(0, 0, width, height);
        if (maskCanvas) {
          ctx.save();
          ctx.globalCompositeOperation = 'destination-over';
          ctx.drawImage(tempCanvas, 0, 0);
          ctx.restore();
          
          ctx.save();
          ctx.globalCompositeOperation = 'destination-in';
          ctx.drawImage(maskCanvas, 0, 0);
          ctx.restore();
        } else {
          ctx.drawImage(tempCanvas, 0, 0);
        }
        break;
    }
  }, [imageData, viewMode, segmentationResult]);

  const getCanvasCoords = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };

    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    return {
      x: (e.clientX - rect.left) * scaleX,
      y: (e.clientY - rect.top) * scaleY,
    };
  }, []);

  const handleMouseDown = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    if (isProcessing || !segmentationResult) return;
    
    const { x, y } = getCanvasCoords(e);
    setIsDrawing(true);
    lastPointRef.current = { x, y };
    
    segmentationService.setBrushSize(brushSize);
    segmentationService.setBrushHardness(brushHardness);
    segmentationService.setBrushFeather(brushFeather);
    segmentationService.startBrush(x, y, brushMode);
    
    drawPreview();
  }, [isProcessing, segmentationResult, getCanvasCoords, brushSize, brushHardness, brushFeather, brushMode, drawPreview]);

  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!isDrawing || isProcessing) return;
    
    const { x, y } = getCanvasCoords(e);
    
    if (lastPointRef.current) {
      segmentationService.moveBrush(x, y);
    } else {
      segmentationService.startBrush(x, y, brushMode);
    }
    
    lastPointRef.current = { x, y };
    drawPreview();
  }, [isDrawing, isProcessing, getCanvasCoords, brushMode, drawPreview]);

  const handleMouseUp = useCallback(() => {
    if (!isDrawing) return;
    setIsDrawing(false);
    lastPointRef.current = null;
    segmentationService.endBrush();
    drawPreview();
  }, [isDrawing, drawPreview]);

  const handleMouseLeave = useCallback(() => {
    if (isDrawing) {
      setIsDrawing(false);
      lastPointRef.current = null;
      segmentationService.endBrush();
      drawPreview();
    }
  }, [isDrawing, drawPreview]);

  const handleInvertMask = useCallback(() => {
    segmentationService.invertMask();
    drawPreview();
  }, [drawPreview]);

  const handleFeatherMask = useCallback(() => {
    segmentationService.featherMask(brushFeather);
    drawPreview();
  }, [brushFeather, drawPreview]);

  const handleReset = useCallback(() => {
    if (segmentationResult) {
      segmentationService.initMaskCanvas(
        segmentationResult.width,
        segmentationResult.height,
        segmentationResult.mask
      );
      drawPreview();
    }
  }, [segmentationResult, drawPreview]);

  const handleApply = useCallback(() => {
    const mask = segmentationService.getMaskData();
    if (mask.length > 0) {
      onApply(mask);
      onClose();
    }
  }, [onApply, onClose]);

  const handleDownloadMask = useCallback(() => {
    const maskCanvas = segmentationService.getMaskCanvas();
    if (!maskCanvas) return;

    maskCanvas.toBlob((blob) => {
      if (blob) {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'mask.png';
        a.click();
        URL.revokeObjectURL(url);
      }
    }, 'image/png');
  }, []);

  const handleCancel = useCallback(() => {
    segmentationService.cancel();
    onClose();
  }, [onClose]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm">
      <div className="relative w-full max-w-6xl mx-4 bg-dark-400 rounded-xl shadow-2xl overflow-hidden max-h-[92vh] flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-dark-100">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-gradient-to-br from-purple-500 to-pink-500 rounded-lg flex items-center justify-center">
              <Wand2 size={20} className="text-white" />
            </div>
            <div>
              <h2 className="text-xl font-semibold text-white">AI 智能抠图</h2>
              <p className="text-sm text-gray-500">
                {isProcessing 
                  ? 'AI正在分析图像，请稍候...' 
                  : segmentationResult 
                    ? `置信度 ${Math.round(segmentationResult.confidence * 100)}% · 画笔手动修正`
                    : '准备就绪'
                }
              </p>
            </div>
          </div>
          <button
            onClick={handleCancel}
            className="p-2 text-gray-400 hover:text-white hover:bg-dark-200 rounded-lg transition-colors"
          >
            <X size={20} />
          </button>
        </div>

        {isProcessing && (
          <div className="px-6 py-4 border-b border-dark-100 bg-dark-300/50">
            <div className="flex items-center gap-4">
              <div className="w-10 h-10 border-2 border-dark-100 border-t-accent-primary rounded-full animate-spin shrink-0" />
              <div className="flex-1">
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-sm font-medium text-gray-300">正在处理图像...</span>
                  <span className="text-sm font-semibold text-accent-primary">{Math.round(progress * 100)}%</span>
                </div>
                <div className="h-2 bg-dark-100 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-gradient-to-r from-accent-primary to-purple-500 rounded-full transition-all duration-300"
                    style={{ width: `${progress * 100}%` }}
                  />
                </div>
              </div>
            </div>
          </div>
        )}

        {error && (
          <div className="mx-6 mt-4 p-4 bg-red-500/10 border border-red-500/30 rounded-lg flex items-center gap-3">
            <div className="w-8 h-8 bg-red-500/20 rounded-lg flex items-center justify-center shrink-0">
              <X size={16} className="text-red-400" />
            </div>
            <div className="flex-1">
              <p className="text-sm font-medium text-red-400">处理出错</p>
              <p className="text-xs text-red-400/70 mt-0.5">{error}</p>
            </div>
            <button
              onClick={runSegmentation}
              className="px-4 py-1.5 bg-red-500/20 hover:bg-red-500/30 text-red-400 rounded-lg text-sm font-medium transition-colors"
            >
              重试
            </button>
          </div>
        )}

        <div className="flex-1 overflow-hidden flex">
          <div className="flex-1 p-6 overflow-auto flex items-center justify-center">
            <div className="relative inline-block">
              <div className="checkerboard rounded-xl overflow-hidden shadow-2xl border border-dark-100">
                <canvas
                  ref={canvasRef}
                  onMouseDown={handleMouseDown}
                  onMouseMove={handleMouseMove}
                  onMouseUp={handleMouseUp}
                  onMouseLeave={handleMouseLeave}
                  className={`max-w-full max-h-[55vh] block ${
                    !isProcessing && segmentationResult ? 'cursor-crosshair' : 'cursor-default'
                  }`}
                  style={{ imageRendering: viewMode === 'mask' ? 'pixelated' : 'auto' }}
                />
              </div>

              {isDrawing && (
                <div
                  className="absolute pointer-events-none rounded-full border-2 border-white/50"
                  style={{
                    width: brushSize * 2,
                    height: brushSize * 2,
                    background: brushMode === 'add' ? 'rgba(34, 197, 94, 0.1)' : 'rgba(239, 68, 68, 0.1)',
                    borderColor: brushMode === 'add' ? 'rgba(34, 197, 94, 0.5)' : 'rgba(239, 68, 68, 0.5)',
                    transform: 'translate(-50%, -50%)',
                    left: '50%',
                    top: '50%',
                  }}
                />
              )}
            </div>
          </div>

          <div className="w-72 border-l border-dark-100 bg-dark-300/30 flex flex-col">
            <div className="p-4 border-b border-dark-100">
              <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">预览模式</h3>
              <div className="grid grid-cols-3 gap-1.5">
                {[
                  { mode: 'overlay' as ViewMode, label: '叠加', desc: '原图+蒙版' },
                  { mode: 'mask' as ViewMode, label: '蒙版', desc: 'Alpha通道' },
                  { mode: 'original' as ViewMode, label: '原图', desc: '无蒙版' },
                ].map(({ mode, label, desc }) => (
                  <button
                    key={mode}
                    onClick={() => setViewMode(mode)}
                    title={desc}
                    className={`py-2 px-2 rounded-lg text-sm font-medium transition-all ${
                      viewMode === mode
                        ? 'bg-accent-primary text-white'
                        : 'bg-dark-200 text-gray-400 hover:bg-dark-100 hover:text-gray-300'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            <div className="p-4 border-b border-dark-100">
              <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">画笔工具</h3>
              <div className="grid grid-cols-2 gap-2 mb-4">
                <button
                  onClick={() => setBrushMode('add')}
                  className={`flex flex-col items-center gap-1.5 p-3 rounded-lg border transition-all ${
                    brushMode === 'add'
                      ? 'bg-green-500/10 border-green-500/50 text-green-400'
                      : 'bg-dark-200 border-dark-100 text-gray-400 hover:border-dark-200'
                  }`}
                >
                  <Brush size={18} />
                  <span className="text-xs font-medium">添加</span>
                </button>
                <button
                  onClick={() => setBrushMode('remove')}
                  className={`flex flex-col items-center gap-1.5 p-3 rounded-lg border transition-all ${
                    brushMode === 'remove'
                      ? 'bg-red-500/10 border-red-500/50 text-red-400'
                      : 'bg-dark-200 border-dark-100 text-gray-400 hover:border-dark-200'
                  }`}
                >
                  <Eraser size={18} />
                  <span className="text-xs font-medium">擦除</span>
                </button>
              </div>

              <div className="space-y-4">
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="text-xs text-gray-500">画笔大小</label>
                    <span className="text-xs text-gray-400 font-medium">{brushSize}px</span>
                  </div>
                  <input
                    type="range"
                    min="1"
                    max="200"
                    value={brushSize}
                    onChange={(e) => setBrushSize(parseInt(e.target.value))}
                    className="slider-track"
                  />
                </div>

                <div className="relative">
                  <button
                    onClick={() => setShowBrushSettings(!showBrushSettings)}
                    className="w-full flex items-center justify-between py-1.5 px-2 bg-dark-200 hover:bg-dark-100 rounded text-xs text-gray-400 transition-colors"
                  >
                    <span>高级画笔设置</span>
                    <ChevronDown
                      size={14}
                      className={`transition-transform ${showBrushSettings ? 'rotate-180' : ''}`}
                    />
                  </button>

                  {showBrushSettings && (
                    <div className="mt-3 space-y-4 p-3 bg-dark-200/50 rounded-lg">
                      <div>
                        <div className="flex items-center justify-between mb-1.5">
                          <label className="text-xs text-gray-500">硬度</label>
                          <span className="text-xs text-gray-400 font-medium">
                            {Math.round(brushHardness * 100)}%
                          </span>
                        </div>
                        <input
                          type="range"
                          min="0"
                          max="1"
                          step="0.05"
                          value={brushHardness}
                          onChange={(e) => setBrushHardness(parseFloat(e.target.value))}
                          className="slider-track"
                        />
                      </div>

                      <div>
                        <div className="flex items-center justify-between mb-1.5">
                          <label className="text-xs text-gray-500">羽化</label>
                          <span className="text-xs text-gray-400 font-medium">{brushFeather}px</span>
                        </div>
                        <input
                          type="range"
                          min="0"
                          max="50"
                          value={brushFeather}
                          onChange={(e) => setBrushFeather(parseInt(e.target.value))}
                          className="slider-track"
                        />
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>

            <div className="p-4 border-b border-dark-100">
              <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">蒙版操作</h3>
              <div className="grid grid-cols-2 gap-2">
                <button
                  onClick={handleInvertMask}
                  disabled={!segmentationResult}
                  className="flex items-center justify-center gap-1.5 py-2 px-3 bg-dark-200 hover:bg-dark-100 disabled:opacity-40 disabled:cursor-not-allowed rounded-lg text-xs text-gray-400 hover:text-gray-300 transition-colors"
                >
                  <RotateCcw size={14} />
                  反选
                </button>
                <button
                  onClick={handleFeatherMask}
                  disabled={!segmentationResult}
                  className="flex items-center justify-center gap-1.5 py-2 px-3 bg-dark-200 hover:bg-dark-100 disabled:opacity-40 disabled:cursor-not-allowed rounded-lg text-xs text-gray-400 hover:text-gray-300 transition-colors"
                >
                  <Brush size={14} />
                  羽化
                </button>
                <button
                  onClick={handleReset}
                  disabled={!segmentationResult}
                  className="flex items-center justify-center gap-1.5 py-2 px-3 bg-dark-200 hover:bg-dark-100 disabled:opacity-40 disabled:cursor-not-allowed rounded-lg text-xs text-gray-400 hover:text-gray-300 transition-colors col-span-2"
                >
                  <RotateCcw size={14} />
                  恢复AI结果
                </button>
              </div>
            </div>

            <div className="flex-1 p-4 overflow-auto">
              <div className="bg-dark-200/50 rounded-lg p-3">
                <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">使用技巧</h4>
                <ul className="text-xs text-gray-600 space-y-1.5">
                  <li className="flex gap-2">
                    <span className="text-accent-primary shrink-0">•</span>
                    用"添加"画笔涂抹想保留的区域
                  </li>
                  <li className="flex gap-2">
                    <span className="text-accent-primary shrink-0">•</span>
                    用"擦除"画笔涂抹想去除的背景
                  </li>
                  <li className="flex gap-2">
                    <span className="text-accent-primary shrink-0">•</span>
                    切换"蒙版"模式可查看精确的Alpha通道
                  </li>
                  <li className="flex gap-2">
                    <span className="text-accent-primary shrink-0">•</span>
                    细节区域请调小画笔并放大视图
                  </li>
                </ul>
              </div>
            </div>

            <div className="p-4 border-t border-dark-100 space-y-2">
              <button
                onClick={handleDownloadMask}
                disabled={!segmentationResult}
                className="w-full flex items-center justify-center gap-2 py-2.5 bg-dark-200 hover:bg-dark-100 disabled:opacity-40 disabled:cursor-not-allowed rounded-lg text-sm text-gray-400 hover:text-gray-300 transition-colors font-medium"
              >
                <Download size={16} />
                下载蒙版PNG
              </button>
            </div>
          </div>
        </div>

        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-dark-100 bg-dark-300/50">
          <button
            onClick={handleCancel}
            className="px-5 py-2.5 bg-dark-200 text-gray-300 rounded-lg hover:bg-dark-100 transition-colors font-medium"
          >
            取消
          </button>
          <button
            onClick={handleApply}
            disabled={!segmentationResult || isProcessing}
            className="px-6 py-2.5 bg-gradient-to-r from-green-500 to-emerald-500 text-white rounded-lg hover:opacity-90 transition-opacity font-medium shadow-lg shadow-green-500/25 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
          >
            <Check size={18} />
            应用蒙版
          </button>
        </div>
      </div>
    </div>
  );
};
