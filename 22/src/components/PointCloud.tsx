import { useRef, useMemo, useEffect, useState } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { PointCloudData, Cluster } from '../types';
import { getChunksForLOD, mergeChunks } from '../utils/pointCloudGenerator';
import { useAppStore } from '../store/useAppStore';

interface PointCloudProps {
  data: PointCloudData;
  lodLevel: number;
  onPointClick: (cluster: Cluster) => void;
}

const vertexShader = `
  attribute float clusterId;
  attribute float isHighlighted;
  
  varying vec3 vColor;
  varying float vHighlight;
  varying float vPointSize;
  
  uniform float uPointSize;
  uniform float uHighlightedClusterId;
  uniform float uTime;
  
  void main() {
    vColor = color;
    vHighlight = step(uHighlightedClusterId - 0.5, clusterId) * step(clusterId, uHighlightedClusterId + 0.5);
    
    vec3 pos = position;
    
    if (vHighlight > 0.5) {
      float pulse = 1.0 + 0.15 * sin(uTime * 3.0);
      vColor = vec3(1.0, 0.28, 0.34) * pulse;
      vPointSize = uPointSize * 1.8;
    } else {
      vPointSize = uPointSize;
    }
    
    vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
    gl_PointSize = vPointSize * (300.0 / -mvPosition.z);
    gl_Position = projectionMatrix * mvPosition;
  }
`;

const fragmentShader = `
  varying vec3 vColor;
  varying float vHighlight;
  varying float vPointSize;
  
  void main() {
    vec2 center = gl_PointCoord - vec2(0.5);
    float dist = length(center);
    
    if (dist > 0.5) {
      discard;
    }
    
    float alpha = 1.0 - smoothstep(0.3, 0.5, dist);
    
    vec3 finalColor = vColor;
    if (vHighlight > 0.5) {
      float glow = 1.0 - smoothstep(0.2, 0.5, dist);
      finalColor += vec3(1.0, 0.3, 0.4) * glow * 0.5;
    }
    
    gl_FragColor = vec4(finalColor, alpha * 0.9);
  }
`;

export const PointCloud = ({ data, lodLevel, onPointClick }: PointCloudProps) => {
  const pointsRef = useRef<THREE.Points>(null);
  const materialRef = useRef<THREE.ShaderMaterial>(null);
  const geometryRef = useRef<THREE.BufferGeometry>(null);
  const { camera, gl, raycaster, pointer } = useThree();
  
  const highlightedClusterId = useAppStore(state => state.highlightedClusterId);
  const setRenderedPoints = useAppStore(state => state.setRenderedPoints);
  const clusters = data.clusters;
  
  const [hoveredPoint, setHoveredPoint] = useState<number | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const dragStartRef = useRef({ x: 0, y: 0 });
  
  const { positions, colors, clusterIds, totalPoints } = useMemo(() => {
    const chunks = getChunksForLOD(data.chunks, lodLevel);
    return mergeChunks(chunks);
  }, [data, lodLevel]);
  
  useEffect(() => {
    setRenderedPoints(totalPoints);
  }, [totalPoints, setRenderedPoints]);
  
  const geometry = useMemo(() => {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.setAttribute('clusterId', new THREE.BufferAttribute(clusterIds, 1));
    geo.computeBoundingSphere();
    geo.computeBoundingBox();
    return geo;
  }, [positions, colors, clusterIds]);
  
  const material = useMemo(() => {
    return new THREE.ShaderMaterial({
      vertexShader,
      fragmentShader,
      uniforms: {
        uPointSize: { value: 0.08 },
        uHighlightedClusterId: { value: highlightedClusterId ?? -1 },
        uTime: { value: 0 },
      },
      transparent: true,
      vertexColors: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
  }, []);
  
  useEffect(() => {
    if (materialRef.current) {
      materialRef.current.uniforms.uHighlightedClusterId.value = highlightedClusterId ?? -1;
    }
  }, [highlightedClusterId]);
  
  useFrame((state) => {
    if (materialRef.current) {
      materialRef.current.uniforms.uTime.value = state.clock.elapsedTime;
    }
  });
  
  useEffect(() => {
    const handlePointerDown = (e: PointerEvent) => {
      dragStartRef.current = { x: e.clientX, y: e.clientY };
      setIsDragging(false);
    };
    
    const handlePointerMove = (e: PointerEvent) => {
      const dx = Math.abs(e.clientX - dragStartRef.current.x);
      const dy = Math.abs(e.clientY - dragStartRef.current.y);
      if (dx > 3 || dy > 3) {
        setIsDragging(true);
      }
    };
    
    const handlePointerUp = (e: PointerEvent) => {
      if (isDragging) return;
      
      const rect = gl.domElement.getBoundingClientRect();
      const x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      const y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
      
      raycaster.setFromCamera(new THREE.Vector2(x, y), camera);
      
      if (pointsRef.current) {
        const intersects = raycaster.intersectObject(pointsRef.current);
        if (intersects.length > 0) {
          const pointIndex = intersects[0].index;
          if (pointIndex !== undefined && geometryRef.current) {
            const clusterIdAttr = geometryRef.current.getAttribute('clusterId') as THREE.BufferAttribute;
            const clusterId = Math.round(clusterIdAttr.array[pointIndex] as number);
            const cluster = clusters.find(c => c.id === clusterId);
            if (cluster) {
              onPointClick(cluster);
            }
          }
        }
      }
    };
    
    const handlePointerMoveHover = (e: PointerEvent) => {
      const rect = gl.domElement.getBoundingClientRect();
      const x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      const y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
      
      raycaster.setFromCamera(new THREE.Vector2(x, y), camera);
      
      if (pointsRef.current) {
        const intersects = raycaster.intersectObject(pointsRef.current);
        if (intersects.length > 0 && intersects[0].index !== undefined) {
          setHoveredPoint(intersects[0].index);
          gl.domElement.style.cursor = 'pointer';
        } else {
          setHoveredPoint(null);
          gl.domElement.style.cursor = 'grab';
        }
      }
    };
    
    gl.domElement.addEventListener('pointerdown', handlePointerDown);
    gl.domElement.addEventListener('pointermove', handlePointerMove);
    gl.domElement.addEventListener('pointerup', handlePointerUp);
    gl.domElement.addEventListener('pointermove', handlePointerMoveHover);
    
    return () => {
      gl.domElement.removeEventListener('pointerdown', handlePointerDown);
      gl.domElement.removeEventListener('pointermove', handlePointerMove);
      gl.domElement.removeEventListener('pointerup', handlePointerUp);
      gl.domElement.removeEventListener('pointermove', handlePointerMoveHover);
    };
  }, [gl, camera, raycaster, clusters, isDragging, onPointClick]);
  
  useEffect(() => {
    geometryRef.current = geometry;
    materialRef.current = material;
    
    return () => {
      geometry.dispose();
      material.dispose();
    };
  }, [geometry, material]);
  
  return (
    <points ref={pointsRef} geometry={geometry} material={material} frustumCulled={false} />
  );
};
