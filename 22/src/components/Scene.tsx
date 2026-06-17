import { useRef, useState, useEffect, useCallback } from 'react';
import { Canvas, useThree } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import * as THREE from 'three';
import { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import { PointCloudData, Cluster } from '../types';
import { PointCloud } from './PointCloud';
import { BackgroundParticles } from './BackgroundParticles';
import { LODController } from './LODController';
import { flyToCluster } from '../utils/cameraFly';
import { useAppStore } from '../store/useAppStore';

interface SceneContentProps {
  data: PointCloudData;
  lodLevel: number;
  onPointClick: (cluster: Cluster) => void;
  onLODChange: (level: number) => void;
  flyToClusterRef: React.MutableRefObject<((cluster: Cluster) => void) | null>;
}

const SceneContent = ({ data, lodLevel, onPointClick, onLODChange, flyToClusterRef }: SceneContentProps) => {
  const { camera } = useThree();
  const controlsRef = useRef<OrbitControlsImpl>(null);
  
  const setIsCameraFlying = useAppStore(state => state.setIsCameraFlying);
  const cancelFlightRef = useRef<(() => void) | null>(null);

  const handleFlyToCluster = useCallback((cluster: Cluster) => {
    if (!controlsRef.current) return;
    
    if (cancelFlightRef.current) {
      cancelFlightRef.current();
    }

    controlsRef.current.enabled = false;
    
    cancelFlightRef.current = flyToCluster(
      cluster,
      camera as THREE.PerspectiveCamera,
      controlsRef.current,
      300,
      () => setIsCameraFlying(true),
      () => {
        setIsCameraFlying(false);
        if (controlsRef.current) {
          controlsRef.current.enabled = true;
        }
      }
    );
  }, [camera, setIsCameraFlying]);

  useEffect(() => {
    flyToClusterRef.current = handleFlyToCluster;
  }, [handleFlyToCluster, flyToClusterRef]);

  useEffect(() => {
    return () => {
      if (cancelFlightRef.current) {
        cancelFlightRef.current();
      }
    };
  }, []);

  return (
    <>
      <ambientLight intensity={0.2} />
      <BackgroundParticles />
      <PointCloud data={data} lodLevel={lodLevel} onPointClick={onPointClick} />
      <LODController onChange={onLODChange} />
      <OrbitControls
        ref={controlsRef}
        enableDamping
        dampingFactor={0.05}
        enablePan={false}
        minDistance={5}
        maxDistance={150}
        zoomSpeed={0.8}
        rotateSpeed={0.5}
      />
    </>
  );
};

interface SceneProps {
  data: PointCloudData;
  onPointClick: (cluster: Cluster) => void;
  flyToClusterRef: React.MutableRefObject<((cluster: Cluster) => void) | null>;
}

export const Scene = ({ data, onPointClick, flyToClusterRef }: SceneProps) => {
  const [lodLevel, setLodLevel] = useState(2);

  return (
    <Canvas
      camera={{ position: [0, 0, 50], fov: 60, near: 0.1, far: 2000 }}
      gl={{
        antialias: true,
        alpha: false,
        powerPreference: 'high-performance',
        pixelRatio: Math.min(window.devicePixelRatio, 1.5),
      }}
      dpr={[1, 1.5]}
      onCreated={({ gl }) => {
        gl.setClearColor('#0a0a0f');
      }}
      style={{ background: '#0a0a0f' }}
    >
      <fog attach="fog" args={['#0a0a0f', 40, 120]} />
      <SceneContent
        data={data}
        lodLevel={lodLevel}
        onPointClick={onPointClick}
        onLODChange={setLodLevel}
        flyToClusterRef={flyToClusterRef}
      />
    </Canvas>
  );
};
