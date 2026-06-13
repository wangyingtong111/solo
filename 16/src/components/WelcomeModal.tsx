import { useState, useRef, useCallback } from 'react';
import { Image, Upload, FileText, X, FileSpreadsheet, Sparkles } from 'lucide-react';

interface WelcomeModalProps {
  onFileSelect: (file: File) => void;
  onCreateNew: (width: number, height: number) => void;
}

const PRESETS = [
  { name: '社交媒体', width: 1080, height: 1080, desc: 'Instagram帖子' },
  { name: '横版海报', width: 1920, height: 1080, desc: '全高清' },
  { name: '封面设计', width: 2560, height: 1440, desc: '2K分辨率' },
  { name: '电商主图', width: 800, height: 800, desc: '正方形画布' },
];

export const WelcomeModal = ({ onFileSelect, onCreateNew }: WelcomeModalProps) => {
  const [showNewProject, setShowNewProject] = useState(false);
  const [width, setWidth] = useState(1920);
  const [height, setHeight] = useState(1080);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileInput = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      onFileSelect(file);
    }
  }, [onFileSelect]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files?.[0];
    if (file && (file.type.startsWith('image/') || file.name.endsWith('.psd'))) {
      onFileSelect(file);
    }
  }, [onFileSelect]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
  }, []);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
      <div className="relative w-full max-w-3xl mx-4 bg-dark-400 rounded-xl shadow-2xl overflow-hidden">
        <div className="absolute top-4 right-4">
          <button
            onClick={() => onCreateNew(1920, 1080)}
            className="p-2 text-gray-400 hover:text-white transition-colors"
          >
            <X size={20} />
          </button>
        </div>
        
        <div className="p-8">
          <div className="text-center mb-8">
            <div className="inline-flex items-center gap-2 mb-2">
              <Sparkles size={32} className="text-accent-primary" />
              <h1 className="text-4xl font-bold bg-gradient-to-r from-accent-primary via-purple-500 to-accent-secondary bg-clip-text text-transparent">
                PixelForge
              </h1>
            </div>
            <p className="text-gray-400">专业级在线图片编辑器 · AI智能抠图 · WebGL高性能渲染</p>
          </div>

          {!showNewProject ? (
            <>
              <div
                onDrop={handleDrop}
                onDragOver={handleDragOver}
                className="border-2 border-dashed border-dark-100 rounded-xl p-12 text-center hover:border-accent-primary transition-colors cursor-pointer mb-8 group"
                onClick={() => fileInputRef.current?.click()}
              >
                <div className="w-20 h-20 mx-auto mb-4 bg-dark-300 rounded-2xl flex items-center justify-center group-hover:bg-accent-primary/10 transition-colors">
                  <Upload size={40} className="text-accent-primary" />
                </div>
                <p className="text-xl text-gray-200 mb-2 font-medium">拖拽图片到这里</p>
                <p className="text-sm text-gray-500">或点击选择文件</p>
                <div className="flex items-center justify-center gap-4 mt-4">
                  <span className="inline-flex items-center gap-1 text-xs text-gray-600">
                    <Image size={12} />
                    JPG PNG WEBP
                  </span>
                  <span className="inline-flex items-center gap-1 text-xs text-gray-600">
                    <FileSpreadsheet size={12} />
                    PSD
                  </span>
                </div>
              </div>

              <input
                ref={fileInputRef}
                type="file"
                accept="image/*,.psd"
                className="hidden"
                onChange={handleFileInput}
              />

              <div className="border-t border-dark-100 pt-6">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider">快速开始</h3>
                  <button
                    onClick={() => setShowNewProject(true)}
                    className="text-sm text-accent-primary hover:text-accent-secondary transition-colors"
                  >
                    自定义尺寸 →
                  </button>
                </div>
                
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  {PRESETS.map((preset) => (
                    <button
                      key={preset.name}
                      onClick={() => onCreateNew(preset.width, preset.height)}
                      className="p-4 bg-dark-300 rounded-lg hover:bg-dark-200 border border-dark-100 hover:border-accent-primary/50 transition-all text-left group"
                    >
                      <div className="w-10 h-10 mb-3 bg-accent-primary/10 rounded-lg flex items-center justify-center group-hover:bg-accent-primary/20 transition-colors">
                        <FileText size={20} className="text-accent-primary" />
                      </div>
                      <p className="text-sm font-medium text-gray-200 mb-1">{preset.name}</p>
                      <p className="text-xs text-gray-500">{preset.width} × {preset.height}</p>
                      <p className="text-xs text-gray-600 mt-0.5">{preset.desc}</p>
                    </button>
                  ))}
                </div>
              </div>
            </>
          ) : (
            <div>
              <button
                onClick={() => setShowNewProject(false)}
                className="text-sm text-gray-400 hover:text-white mb-6 flex items-center gap-1"
              >
                ← 返回
              </button>
              
              <h3 className="text-xl font-semibold text-white mb-6">创建新项目</h3>
              
              <div className="grid grid-cols-2 gap-6 mb-8">
                <div>
                  <label className="block text-sm text-gray-400 mb-2">宽度 (px)</label>
                  <input
                    type="number"
                    value={width}
                    onChange={(e) => setWidth(Math.max(1, parseInt(e.target.value) || 0))}
                    className="input-field text-lg"
                  />
                </div>
                <div>
                  <label className="block text-sm text-gray-400 mb-2">高度 (px)</label>
                  <input
                    type="number"
                    value={height}
                    onChange={(e) => setHeight(Math.max(1, parseInt(e.target.value) || 0))}
                    className="input-field text-lg"
                  />
                </div>
              </div>

              <div className="flex gap-3">
                <button
                  onClick={() => setShowNewProject(false)}
                  className="flex-1 py-3 bg-dark-200 text-gray-300 rounded-lg hover:bg-dark-100 transition-colors font-medium"
                >
                  取消
                </button>
                <button
                  onClick={() => onCreateNew(width, height)}
                  className="flex-1 py-3 bg-gradient-to-r from-accent-primary to-accent-secondary text-white rounded-lg hover:opacity-90 transition-opacity font-medium shadow-lg shadow-accent-primary/25"
                >
                  创建画布
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
