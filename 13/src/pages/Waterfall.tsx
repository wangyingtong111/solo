import { useRef, useMemo, useState, useEffect } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { OrbitControls, Grid, Html } from '@react-three/drei';
import * as THREE from 'three';
import { useAppStore } from '@/store/useAppStore';
import { BarChart3, RotateCcw, Settings, Layers, Activity } from 'lucide-react';

const TIME_STEPS = 30;
const MAX_FREQ_BINS = 512;
const HEIGHT_SCALE = 12;
const SAMPLE_RATE = 5000;
const FFT_SIZE = 1024;
const FREQ_RESOLUTION = SAMPLE_RATE / FFT_SIZE;

const FREQ_RANGES = [
  { label: '0-500Hz', bins: 103, width: 35 },
  { label: '0-1250Hz', bins: 256, width: 45 },
  { label: '0-2500Hz', bins: 512, width: 55 },
];

interface WaterfallData {
  spectrum: number[];
  timestamp: number;
}

export default function WaterfallPage() {
  const { sensorStates, activeSensorId, sensors } = useAppStore();
  const [waterfallData, setWaterfallData] = useState<WaterfallData[]>([]);
  const [colorMode, setColorMode] = useState<'spectrum' | 'heat'>('spectrum');
  const [freqRangeIdx, setFreqRangeIdx] = useState(1);

  const state = sensorStates[activeSensorId];
  const activeSensor = sensors.find(s => s.id === activeSensorId);
  const freqRange = FREQ_RANGES[freqRangeIdx];
  const freqBins = freqRange.bins;
  const maxFreq = freqBins * FREQ_RESOLUTION;

  useEffect(() => {
    const interval = setInterval(() => {
      if (state?.features?.spectrum) {
        setWaterfallData(prev => {
          const spec = state.features!.spectrum.slice(0, freqBins);
          const newData = [
            { spectrum: spec, timestamp: Date.now() },
            ...prev,
          ].slice(0, TIME_STEPS);
          return newData;
        });
      }
    }, 200);

    return () => clearInterval(interval);
  }, [state?.features?.spectrum, freqBins]);

  const handleReset = () => {
    setWaterfallData([]);
  };

  return (
    <div className="min-h-screen pt-16 pb-6 px-6 grid-bg">
      <div className="max-w-[1600px] mx-auto">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h2 className="tech-title text-2xl mb-1">三维瀑布图</h2>
            <p className="text-sm text-gray-400">
              {activeSensor?.name || `CH${activeSensorId}`} · 频谱包络随时间变化
            </p>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1 bg-slate-800/60 rounded-lg p-1 border border-slate-700/50">
              {FREQ_RANGES.map((range, idx) => (
                <button
                  key={range.label}
                  onClick={() => setFreqRangeIdx(idx)}
                  className={`px-3 py-1.5 text-xs font-medium rounded-md transition-all ${
                    freqRangeIdx === idx
                      ? 'bg-tech-cyan/20 text-tech-cyan border border-tech-cyan/30'
                      : 'text-gray-400 hover:text-white hover:bg-slate-700/50'
                  }`}
                >
                  {range.label}
                </button>
              ))}
            </div>
            <button
              onClick={() => setColorMode(colorMode === 'spectrum' ? 'heat' : 'spectrum')}
              className="btn-tech flex items-center gap-2"
            >
              <Layers className="w-4 h-4" />
              {colorMode === 'spectrum' ? '光谱色' : '热力色'}
            </button>
            <button
              onClick={handleReset}
              className="btn-tech flex items-center gap-2"
            >
              <RotateCcw className="w-4 h-4" />
              重置
            </button>
          </div>
        </div>

        <div className="panel-glow overflow-hidden rounded-lg" style={{ height: 'calc(100vh - 180px)' }}>
          <Canvas
            camera={{ position: [38, 26, 38], fov: 45 }}
            gl={{ antialias: true, alpha: false }}
          >
            <color attach="background" args={['#050d18']} />
            <fog attach="fog" args={['#050d18', 35, 90]} />

            <ambientLight intensity={0.3} />
            <pointLight position={[15, 25, 15]} intensity={1.0} color="#00d4ff" />
            <pointLight position={[-15, 15, -15]} intensity={0.5} color="#6366f1" />
            <pointLight position={[0, 30, 0]} intensity={0.3} color="#ffffff" />

            <Grid
              position={[0, -0.5, 0]}
              args={[80, 60]}
              cellSize={1}
              cellThickness={0.5}
              cellColor="#1e3a5f"
              sectionSize={5}
              sectionThickness={1}
              sectionColor="#00d4ff"
              fadeDistance={70}
              fadeStrength={1}
              followCamera={false}
            />

            <WaterfallBars data={waterfallData} colorMode={colorMode} freqBins={freqBins} graphWidth={freqRange.width} />

            <AxisLabels maxFreq={maxFreq} />

            <OrbitControls
              enableDamping
              dampingFactor={0.05}
              minDistance={15}
              maxDistance={70}
              maxPolarAngle={Math.PI / 2.2}
            />
          </Canvas>
        </div>

        <div className="mt-4 grid grid-cols-4 gap-4">
          <InfoCard icon={BarChart3} label="频率范围" value={`0 - ${maxFreq.toFixed(0)} Hz`} />
          <InfoCard icon={Settings} label="时间窗口" value={`${(TIME_STEPS * 0.2).toFixed(1)}s`} />
          <InfoCard icon={Activity} label="频谱分辨率" value={`${FREQ_RESOLUTION.toFixed(2)} Hz/bin`} />
          <InfoCard icon={Layers} label="频谱线数" value={`${freqBins} lines`} />
        </div>
      </div>
    </div>
  );
}

function InfoCard({ icon: Icon, label, value }: { icon: any; label: string; value: string }) {
  return (
    <div className="panel p-4">
      <div className="flex items-center gap-2 mb-1">
        <Icon className="w-4 h-4 text-tech-cyan" />
        <span className="text-xs text-gray-400">{label}</span>
      </div>
      <div className="font-display text-lg text-white">{value}</div>
    </div>
  );
}

function WaterfallBars({ data, colorMode, freqBins, graphWidth }: {
  data: WaterfallData[];
  colorMode: 'spectrum' | 'heat';
  freqBins: number;
  graphWidth: number;
}) {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const dummy = useMemo(() => new THREE.Object3D(), []);
  const colorObj = useMemo(() => new THREE.Color(), []);

  const totalBars = TIME_STEPS * freqBins;
  const barWidth = Math.max(0.08, (graphWidth / freqBins) * 0.7);
  const barDepth = 0.4;

  const barsData = useMemo(() => {
    const result: { x: number; y: number; z: number; height: number; color: string }[] = [];

    for (let t = 0; t < TIME_STEPS; t++) {
      const spectrumData = data[t]?.spectrum || new Array(freqBins).fill(0.01);
      const maxVal = Math.max(...spectrumData.slice(0, freqBins), 0.001);

      for (let f = 0; f < freqBins; f++) {
        const x = (f / freqBins - 0.5) * graphWidth;
        const z = (t / TIME_STEPS - 0.5) * 25;
        const value = spectrumData[f] || 0.01;
        const normalized = value / maxVal;
        const height = Math.max(0.05, normalized * HEIGHT_SCALE);

        let color: string;
        if (colorMode === 'spectrum') {
          const hue = 210 - (f / freqBins) * 180 + normalized * 30;
          color = `hsl(${Math.max(0, Math.min(360, hue))}, 90%, 55%)`;
        } else {
          if (normalized > 0.85) {
            color = '#ff4757';
          } else if (normalized > 0.6) {
            color = '#ff6b35';
          } else if (normalized > 0.35) {
            color = '#ffa502';
          } else if (normalized > 0.15) {
            color = '#2ed573';
          } else {
            color = '#00d4ff';
          }
        }

        result.push({ x, y: height / 2, z, height, color });
      }
    }

    return result;
  }, [data, colorMode, freqBins, graphWidth, barWidth]);

  useFrame(() => {
    if (!meshRef.current) return;

    for (let i = 0; i < totalBars; i++) {
      const bar = barsData[i] || { x: 0, y: 0.025, z: 0, height: 0.05, color: '#111' };
      dummy.position.set(bar.x, bar.y, bar.z);
      dummy.scale.set(barWidth, bar.height, barDepth);
      dummy.updateMatrix();
      meshRef.current.setMatrixAt(i, dummy.matrix);

      colorObj.set(bar.color);
      meshRef.current.setColorAt(i, colorObj);
    }

    meshRef.current.instanceMatrix.needsUpdate = true;
    if (meshRef.current.instanceColor) {
      meshRef.current.instanceColor.needsUpdate = true;
    }
  });

  return (
    <instancedMesh ref={meshRef} args={[undefined, undefined, totalBars]} castShadow receiveShadow>
      <boxGeometry args={[1, 1, 1]} />
      <meshStandardMaterial
        emissiveIntensity={0.25}
        roughness={0.4}
        metalness={0.3}
        transparent
        opacity={0.95}
      />
    </instancedMesh>
  );
}

function AxisLabels({ maxFreq }: { maxFreq: number }) {
  return (
    <group position={[0, 0, 0]}>
      <Html position={[0, -0.3, -14]} center style={{ pointerEvents: 'none' }}>
        <div className="text-tech-cyan/80 text-xs font-display whitespace-nowrap">
          时间 →
        </div>
      </Html>
      <Html position={[-22, -0.3, 0]} center style={{ pointerEvents: 'none' }}>
        <div className="text-tech-cyan/80 text-xs font-display whitespace-nowrap">
          ← 频率 (0 - {maxFreq.toFixed(0)} Hz)
        </div>
      </Html>
      <Html position={[-20, 8, -15]} center style={{ pointerEvents: 'none' }}>
        <div className="text-green-400/80 text-xs font-display whitespace-nowrap">
          幅值 ↑
        </div>
      </Html>
    </group>
  );
}
