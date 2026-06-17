import { useEffect, useRef } from 'react';
import { useThree, useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useAppStore } from '../store/useAppStore';
import { calculateLODLevel } from '../utils/cameraFly';

interface LODControllerProps {
  onChange: (lodLevel: number) => void;
}

export const LODController = ({ onChange }: LODControllerProps) => {
  const { camera } = useThree();
  const currentLODRef = useRef(2);
  const lastCheckRef = useRef(0);
  
  const setCurrentLODLevel = useAppStore(state => state.setCurrentLODLevel);
  
  useFrame((state) => {
    const now = state.clock.elapsedTime;
    if (now - lastCheckRef.current < 0.1) return;
    lastCheckRef.current = now;
    
    const targetPos = new THREE.Vector3(0, 0, 0);
    const newLOD = calculateLODLevel(camera.position, targetPos);
    
    if (newLOD !== currentLODRef.current) {
      currentLODRef.current = newLOD;
      setCurrentLODLevel(newLOD);
      onChange(newLOD);
    }
  });
  
  return null;
};
