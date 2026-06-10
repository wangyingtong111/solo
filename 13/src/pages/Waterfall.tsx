import { useRef, useMemo, useState, useEffect } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { OrbitControls, Grid, Html } from '@react-three/drei';
import * as THREE from 'three';
import { useAppStore } from '@/store/useAppStore';
import { BarChart3, RotateCcw, Settings, Layers } from 'lucide-react';

const TIME_STEPS = 30;
const FREQ_BINS = 50;
const HEIGHT_SCALE = 12;

interface WaterfallData {
  spectrum: number[];
  timestamp: number;
}

export default function WaterfallPage() {
  const { sensorStates, activeSensorId, sensors } = useAppStore();
  const [waterfallData, setWaterfallData] = useState<WaterfallData[]>([]);
  const [colorMode, setColorMode] = useState<'spectrum' | 'heat'>('spectrum');

  const state = sensorStates[activeSensorId];
  const activeSensor = sensors.find(s => s.id === activeSensorId);

  useEffect(() => {
    const interval = setInterval(() => {
      if (state?.features?.spectrum) {
        setWaterfallData(prev => {
          const spec = state.features!.spectrum.slice(0, FREQ_BINS);
          const newData = [
            { spectrum: spec, timestamp: Date.now() },
            ...prev,
          ].slice(0, TIME_STEPS);
          return newData;
        });
      }
    }, 200);

    return () => clearInterval(interval);
  }, [state?.features?.spectrum]);

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
            <button
              onClick={handleReset}
              className="btn-tech flex items-center gap-2"
            >
              <RotateCcw className="w-4 h-4" />
              重置
            </button>
            <button
              onClick={() => setColorMode(colorMode === 'spectrum' ? 'heat' : 'spectrum')}
              className="btn-tech flex items-center gap-2"
            >
              <Layers className="w-4 h-4" />
              {colorMode === 'spectrum' ? '光谱色' : '热力色'}
            </button>
          </div>
        </div>

        <div className="panel-glow overflow-hidden rounded-lg" style={{ height: 'calc(100vh - 180px)' }}>
          <Canvas
            camera={{ position: [28, 22, 28], fov: 45 }}
            gl={{ antialias: true, alpha: false }}
          >
            <color attach="background" args={['#050d18']} />
            <fog attach="fog" args={['#050d18', 25, 70]} />

            <ambientLight intensity={0.3} />
            <pointLight position={[15, 25, 15]} intensity={1.0} color="#00d4ff" />
            <pointLight position={[-15, 15, -15]} intensity={0.5} color="#6366f1" />
            <pointLight position={[0, 30, 0]} intensity={0.3} color="#ffffff" />

            <Grid
              position={[0, -0.5, 0]}
              args={[60, 60]}
              cellSize={1}
              cellThickness={0.5}
              cellColor="#1e3a5f"
              sectionSize={5}
              sectionThickness={1}
              sectionColor="#00d4ff"
              fadeDistance={50}
              fadeStrength={1}
              followCamera={false}
            />

            <WaterfallBars data={waterfallData} colorMode={colorMode} />

            <AxisLabels />

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
          <InfoCard icon={BarChart3} label="频率范围" value="0 - 2500 Hz" />
          <InfoCard icon={Settings} label="时间窗口" value={`${(TIME_STEPS * 0.2).toFixed(1)}s`} />
          <InfoCard icon={Layers} label="频谱分辨率" value={`${FREQ_BINS} bins`} />
          <InfoCard icon={RotateCcw} label="刷新率" value="5 Hz" />
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

function WaterfallBars({ data, colorMode }: { data: WaterfallData[]; colorMode: 'spectrum' | 'heat' }) {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const dummy = useMemo(() => new THREE.Object3D(), []);
  const colorObj = useMemo(() => new THREE.Color(), []);

  const totalBars = TIME_STEPS * FREQ_BINS;

  const barsData = useMemo(() => {
    const result: { x: number; y: number; z: number; height: number; color: string }[] = [];

    for (let t = 0; t < TIME_STEPS; t++) {
      const spectrumData = data[t]?.spectrum || new Array(FREQ_BINS).fill(0.01);
      const maxVal = Math.max(...spectrumData, 0.001);

      for (let f = 0; f < FREQ_BINS; f++) {
        const x = (f / FREQ_BINS - 0.5) * 30;
        const z = (t / TIME_STEPS - 0.5) * 25;
        const value = spectrumData[f] || 0.01;
        const normalized = value / maxVal;
        const height = Math.max(0.05, normalized * HEIGHT_SCALE);

        let color: string;
        if (colorMode === 'spectrum') {
          const hue = 210 - (f / FREQ_BINS) * 180 + normalized * 30;
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
  }, [data, colorMode]);

  useFrame(() => {
    if (!meshRef.current) return;

    for (let i = 0; i < totalBars; i++) {
      const bar = barsData[i] || { x: 0, y: 0.025, z: 0, height: 0.05, color: '#111' };
      dummy.position.set(bar.x, bar.y, bar.z);
      dummy.scale.set(0.45, bar.height, 0.4);
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

function AxisLabels() {
  return (
    <group position={[0, 0, 0]}>
      <Html position={[0, -0.3, -14]} center style={{ pointerEvents: 'none' }}>
        <div className="text-tech-cyan/80 text-xs font-display whitespace-nowrap">
          时间 →
        </div>
      </Html>
      <Html position={[-16, -0.3, 0]} center style={{ pointerEvents: 'none' }}>
        <div className="text-tech-cyan/80 text-xs font-display whitespace-nowrap">
          ← 频率
        </div>
      </Html>
      <Html position={[-15, 8, -15]} center style={{ pointerEvents: 'none' }}>
        <div className="text-green-400/80 text-xs font-display whitespace-nowrap">
          幅值 ↑
        </div>
      </Html>
    </group>
  );
}
