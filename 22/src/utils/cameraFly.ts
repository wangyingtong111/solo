import * as THREE from 'three';
import { OrbitControls } from 'three-stdlib';
import { Cluster } from '../types';

const easeInOutCubic = (t: number): number => {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
};

const lerp = (a: number, b: number, t: number): number => {
  return a + (b - a) * t;
};

const lerpVector3 = (
  a: THREE.Vector3,
  b: THREE.Vector3,
  t: number
): THREE.Vector3 => {
  return new THREE.Vector3(
    lerp(a.x, b.x, t),
    lerp(a.y, b.y, t),
    lerp(a.z, b.z, t)
  );
};

const getClusterBBoxCenter = (cluster: Cluster): THREE.Vector3 => {
  return new THREE.Vector3(
    (cluster.boundingBox.min[0] + cluster.boundingBox.max[0]) / 2,
    (cluster.boundingBox.min[1] + cluster.boundingBox.max[1]) / 2,
    (cluster.boundingBox.min[2] + cluster.boundingBox.max[2]) / 2
  );
};

const getOptimalCameraDistance = (cluster: Cluster): number => {
  const dx = cluster.boundingBox.max[0] - cluster.boundingBox.min[0];
  const dy = cluster.boundingBox.max[1] - cluster.boundingBox.min[1];
  const dz = cluster.boundingBox.max[2] - cluster.boundingBox.min[2];
  const size = Math.max(dx, dy, dz);
  return Math.max(size * 2.5, 8);
};

export const flyToCluster = (
  cluster: Cluster,
  camera: THREE.PerspectiveCamera,
  controls: OrbitControls,
  duration: number = 300,
  onStart?: () => void,
  onComplete?: () => void
): (() => void) => {
  const startPosition = camera.position.clone();
  const startTarget = controls.target.clone();

  const targetCenter = getClusterBBoxCenter(cluster);
  const distance = getOptimalCameraDistance(cluster);

  const direction = new THREE.Vector3()
    .subVectors(camera.position, controls.target)
    .normalize();

  const targetPosition = new THREE.Vector3()
    .copy(targetCenter)
    .add(direction.multiplyScalar(distance));

  let startTime: number | null = null;
  let animationId: number | null = null;
  let cancelled = false;

  const animate = (timestamp: number) => {
    if (cancelled) return;

    if (startTime === null) {
      startTime = timestamp;
    }

    const elapsed = timestamp - startTime;
    const progress = Math.min(elapsed / duration, 1);
    const easedProgress = easeInOutCubic(progress);

    const newPosition = lerpVector3(startPosition, targetPosition, easedProgress);
    const newTarget = lerpVector3(startTarget, targetCenter, easedProgress);

    camera.position.copy(newPosition);
    controls.target.copy(newTarget);
    controls.update();

    if (progress < 1) {
      animationId = requestAnimationFrame(animate);
    } else {
      if (onComplete) onComplete();
    }
  };

  if (onStart) onStart();
  animationId = requestAnimationFrame(animate);

  return () => {
    cancelled = true;
    if (animationId !== null) {
      cancelAnimationFrame(animationId);
    }
  };
};

export const calculateLODLevel = (
  cameraPosition: THREE.Vector3,
  targetPosition: THREE.Vector3
): number => {
  const distance = cameraPosition.distanceTo(targetPosition);

  if (distance < 30) return 0;
  if (distance < 60) return 1;
  return 2;
};

export const formatNumber = (num: number): string => {
  if (num >= 1000000) {
    return (num / 1000000).toFixed(1) + 'M';
  }
  if (num >= 1000) {
    return (num / 1000).toFixed(1) + 'K';
  }
  return num.toString();
};

export const formatMemory = (bytes: number): string => {
  if (bytes >= 1073741824) {
    return (bytes / 1073741824).toFixed(2) + ' GB';
  }
  if (bytes >= 1048576) {
    return (bytes / 1048576).toFixed(2) + ' MB';
  }
  if (bytes >= 1024) {
    return (bytes / 1024).toFixed(2) + ' KB';
  }
  return bytes + ' B';
};
