import { useState, useCallback, useEffect } from 'react';
import { X, Download, FileImage, FileCode, Layers, Image, FileJson } from 'lucide-react';
import { exportService, ExportFormat } from '@/services/ExportService';
import type { Layer } from '@/types';

interface ExportModalProps {
  isOpen: boolean;
  onClose: () => void;
  layers: Layer[];
  canvasSize: { width: number; height: number };
}

const EXPORT_FORMATS: Array<{
  format: ExportFormat;
  name: string;
  icon: React.ReactNode;
  description: string;
  hasQuality: boolean;
}> = [
  { format: 'png', name: 'PNG', icon: <FileImage size={20} />, description: '无损压缩，支持透明通道', hasQuality: false },
  { format: 'jpeg', name: 'JPEG', icon: <Image size={20} />, description: '有损压缩，照片首选', hasQuality: true },
  { format: 'webp', name: 'WebP', icon: <Layers size={20} />, description: '现代格式，体积更小', hasQuality: true },
  { format: 'svg', name: 'SVG 矢量', icon: <FileCode size={20} />, description: '可缩放矢量格式', hasQuality: false },
  { format: 'json', name: 'JSON 项目', icon: <FileJson size={20} />, description: '项目存档，可重新编辑', hasQuality: false },
];

const SCALE_PRESETS = [
  { value: 0.5, label: '50%' },
  { value: 1, label: '100%' },
  { value: 2, label: '200%' },
  { value: 3, label: '300%' },
];

export const ExportModal = ({ isOpen, onClose, layers, canvasSize }: ExportModalProps) => {
  const [format, setFormat] = useState<ExportFormat>('png');
  const [quality, setQuality] = useState(0.92);
  const [scale, setScale] = useState(1);
  const [transparent, setTransparent] = useState(true);
  const [onlySelected, setOnlySelected] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [previewBlob, setPreviewBlob] = useState<Blob | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string>('');
  const [error, setError] = useState<string>('');

  const currentFormat = EXPORT_FORMATS.find(f => f.format === format)!;
  const exportWidth = Math.floor(canvasSize.width * scale);
  const exportHeight = Math.floor(canvasSize.height * scale);

  useEffect(() => {
    if (previewUrl) {
      URL.revokeObjectURL(previewUrl);
    }
  }, [previewUrl]);

  useEffect(() => {
    setPreviewBlob(null);
    setPreviewUrl('');
    setError('');
  }, [format, scale, quality, transparent, onlySelected]);

  const handleExport = useCallback(async () => {
    if (isExporting) return;
    
    setIsExporting(true);
    setError('');
    
    try {
      const visibleLayers = onlySelected
        ? layers.filter(l => l.style.visible && l.id === (layers.find(ly => ly.style.visible)?.id))
        : layers.filter(l => l.style.visible);
      
      const blob = await exportService.export(
        format === 'json' ? layers : visibleLayers,
        canvasSize,
        {
          format,
          quality,
          scale,
          transparent,
          onlySelected,
        }
      );

      setPreviewBlob(blob);
      
      if (format !== 'json' && format !== 'svg') {
        setPreviewUrl(URL.createObjectURL(blob));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '导出失败');
    } finally {
      setIsExporting(false);
    }
  }, [isExporting, layers, canvasSize, format, quality, scale, transparent, onlySelected]);

  const handleDownload = useCallback(() => {
    if (!previewBlob) return;
    
    const filename = exportService.getFilename('pixelforge', format);
    exportService.download(previewBlob, filename);
  }, [previewBlob, format]);

  useEffect(() => {
    const timer = setTimeout(() => {
      if (isOpen && !previewBlob && !isExporting && !error) {
        handleExport();
      }
    }, 300);
    
    return () => clearTimeout(timer);
  }, [isOpen, previewBlob, isExporting, error, handleExport]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
      <div className="relative w-full max-w-4xl mx-4 bg-dark-400 rounded-xl shadow-2xl overflow-hidden max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-dark-100">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-accent-primary/10 rounded-lg flex items-center justify-center">
              <Download size={20} className="text-accent-primary" />
            </div>
            <div>
              <h2 className="text-xl font-semibold text-white">导出图片</h2>
              <p className="text-sm text-gray-500">选择格式和参数，预览后下载</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 text-gray-400 hover:text-white hover:bg-dark-200 rounded-lg transition-colors"
          >
            <X size={20} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div>
              <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-3">导出格式</h3>
              <div className="space-y-2 mb-6">
                {EXPORT_FORMATS.map((item) => (
                  <button
                    key={item.format}
                    onClick={() => setFormat(item.format)}
                    className={`w-full flex items-center gap-3 p-3 rounded-lg border transition-all text-left ${
                      format === item.format
                        ? 'bg-accent-primary/10 border-accent-primary text-white'
                        : 'bg-dark-300 border-dark-100 hover:border-dark-200 text-gray-300'
                    }`}
                  >
                    <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${
                      format === item.format ? 'bg-accent-primary/20' : 'bg-dark-200'
                    }`}>
                      {item.icon}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-medium">{item.name}</p>
                      <p className="text-xs text-gray-500 truncate">{item.description}</p>
                    </div>
                    <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center ${
                      format === item.format ? 'border-accent-primary' : 'border-dark-100'
                    }`}>
                      {format === item.format && (
                        <div className="w-2.5 h-2.5 rounded-full bg-accent-primary" />
                      )}
                    </div>
                  </button>
                ))}
              </div>

              {currentFormat.hasQuality && (
                <div className="mb-6">
                  <div className="flex items-center justify-between mb-2">
                    <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider">压缩质量</h3>
                    <span className="text-sm text-accent-primary font-medium">{Math.round(quality * 100)}%</span>
                  </div>
                  <input
                    type="range"
                    min="0.1"
                    max="1"
                    step="0.01"
                    value={quality}
                    onChange={(e) => setQuality(parseFloat(e.target.value))}
                    className="slider-track"
                  />
                  <div className="flex justify-between mt-1 text-xs text-gray-600">
                    <span>最小体积</span>
                    <span>最佳质量</span>
                  </div>
                </div>
              )}

              <div className="mb-6">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider">导出尺寸</h3>
                  <span className="text-sm text-gray-500">
                    {exportWidth} × {exportHeight} px
                  </span>
                </div>
                <div className="grid grid-cols-4 gap-2">
                  {SCALE_PRESETS.map((preset) => (
                    <button
                      key={preset.value}
                      onClick={() => setScale(preset.value)}
                      className={`py-2 px-3 rounded-lg text-sm font-medium transition-colors ${
                        scale === preset.value
                          ? 'bg-accent-primary text-white'
                          : 'bg-dark-300 text-gray-400 hover:bg-dark-200'
                      }`}
                    >
                      {preset.label}
                    </button>
                  ))}
                </div>
                <input
                  type="range"
                  min="0.25"
                  max="4"
                  step="0.25"
                  value={scale}
                  onChange={(e) => setScale(parseFloat(e.target.value))}
                  className="slider-track mt-3"
                />
              </div>

              {format !== 'svg' && format !== 'json' && (
                <div className="space-y-3 mb-6">
                  <label className="flex items-center gap-3 cursor-pointer group">
                    <input
                      type="checkbox"
                      checked={transparent}
                      onChange={(e) => setTransparent(e.target.checked)}
                      className="w-4 h-4 rounded border-dark-100 bg-dark-300 text-accent-primary focus:ring-accent-primary focus:ring-offset-0"
                    />
                    <div>
                      <p className="text-sm font-medium text-gray-300 group-hover:text-white transition-colors">
                        透明背景
                      </p>
                      <p className="text-xs text-gray-600">取消则填充白色背景</p>
                    </div>
                  </label>

                  <label className="flex items-center gap-3 cursor-pointer group">
                    <input
                      type="checkbox"
                      checked={onlySelected}
                      onChange={(e) => setOnlySelected(e.target.checked)}
                      className="w-4 h-4 rounded border-dark-100 bg-dark-300 text-accent-primary focus:ring-accent-primary focus:ring-offset-0"
                    />
                    <div>
                      <p className="text-sm font-medium text-gray-300 group-hover:text-white transition-colors">
                        仅导出可见图层
                      </p>
                      <p className="text-xs text-gray-600">隐藏的图层将被忽略</p>
                    </div>
                  </label>
                </div>
              )}
            </div>

            <div>
              <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-3">预览</h3>
              <div className="bg-dark-300 rounded-xl overflow-hidden border border-dark-100">
                <div className="checkerboard min-h-[320px] flex items-center justify-center p-4">
                  {isExporting ? (
                    <div className="flex flex-col items-center gap-3 text-gray-400">
                      <div className="w-10 h-10 border-2 border-dark-100 border-t-accent-primary rounded-full animate-spin" />
                      <p className="text-sm">正在渲染预览...</p>
                    </div>
                  ) : error ? (
                    <div className="flex flex-col items-center gap-2 text-red-400 p-4 text-center">
                      <p className="text-sm font-medium">渲染失败</p>
                      <p className="text-xs text-red-400/70">{error}</p>
                      <button
                        onClick={handleExport}
                        className="mt-2 px-4 py-1.5 bg-dark-200 hover:bg-dark-100 rounded text-xs text-gray-300 transition-colors"
                      >
                        重试
                      </button>
                    </div>
                  ) : previewUrl ? (
                    <img
                      src={previewUrl}
                      alt="Preview"
                      className="max-w-full max-h-[400px] object-contain rounded shadow-lg"
                    />
                  ) : format === 'svg' ? (
                    <div className="flex flex-col items-center gap-2 text-gray-500">
                      <FileCode size={48} className="opacity-50" />
                      <p className="text-sm">SVG矢量预览</p>
                      <p className="text-xs text-gray-600">下载后可在浏览器中查看</p>
                    </div>
                  ) : format === 'json' ? (
                    <div className="flex flex-col items-center gap-2 text-gray-500">
                      <FileJson size={48} className="opacity-50" />
                      <p className="text-sm">JSON项目文件</p>
                      <p className="text-xs text-gray-600">包含所有图层数据，可重新导入编辑</p>
                    </div>
                  ) : null}
                </div>

                <div className="px-4 py-3 border-t border-dark-100 bg-dark-400/50">
                  <div className="grid grid-cols-2 gap-4 text-xs">
                    <div>
                      <p className="text-gray-600 mb-0.5">画布尺寸</p>
                      <p className="text-gray-300 font-medium">
                        {canvasSize.width} × {canvasSize.height} px
                      </p>
                    </div>
                    <div>
                      <p className="text-gray-600 mb-0.5">输出尺寸</p>
                      <p className="text-gray-300 font-medium">
                        {exportWidth} × {exportHeight} px
                      </p>
                    </div>
                    <div>
                      <p className="text-gray-600 mb-0.5">图层数量</p>
                      <p className="text-gray-300 font-medium">
                        {onlySelected 
                          ? layers.filter(l => l.style.visible).length 
                          : layers.filter(l => l.style.visible).length
                        } / {layers.length}
                      </p>
                    </div>
                    <div>
                      <p className="text-gray-600 mb-0.5">文件大小</p>
                      <p className="text-gray-300 font-medium">
                        {previewBlob 
                          ? `${(previewBlob.size / 1024).toFixed(1)} KB`
                          : '计算中...'
                        }
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-dark-100 bg-dark-300/50">
          <button
            onClick={onClose}
            className="px-5 py-2.5 bg-dark-200 text-gray-300 rounded-lg hover:bg-dark-100 transition-colors font-medium"
          >
            取消
          </button>
          <button
            onClick={handleExport}
            disabled={isExporting}
            className="px-5 py-2.5 bg-dark-200 text-gray-300 rounded-lg hover:bg-dark-100 transition-colors font-medium disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
          >
            {isExporting ? (
              <>
                <div className="w-4 h-4 border-2 border-gray-500 border-t-gray-300 rounded-full animate-spin" />
                重新渲染
              </>
            ) : '重新渲染'}
          </button>
          <button
            onClick={handleDownload}
            disabled={!previewBlob || isExporting}
            className="px-6 py-2.5 bg-gradient-to-r from-accent-primary to-accent-secondary text-white rounded-lg hover:opacity-90 transition-opacity font-medium shadow-lg shadow-accent-primary/25 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
          >
            <Download size={18} />
            下载文件
          </button>
        </div>
      </div>
    </div>
  );
};
