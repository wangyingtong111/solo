import { useEffect, useRef } from 'react';
import { useAppStore } from '../store/useAppStore';

export const usePerformanceMonitor = () => {
  const frameCountRef = useRef(0);
  const lastTimeRef = useRef(performance.now());
  const animationFrameRef = useRef<number>();
  const memoryCheckRef = useRef(0);

  const setFps = useAppStore(state => state.setFps);
  const setMemoryUsage = useAppStore(state => state.setMemoryUsage);

  useEffect(() => {
    const measure = () => {
      frameCountRef.current++;
      const now = performance.now();
      const elapsed = now - lastTimeRef.current;

      if (elapsed >= 500) {
        const fps = (frameCountRef.current * 1000) / elapsed;
        setFps(Math.round(fps));
        frameCountRef.current = 0;
        lastTimeRef.current = now;

        memoryCheckRef.current++;
        if (memoryCheckRef.current % 4 === 0) {
          if ('memory' in performance) {
            const mem = (performance as any).memory;
            if (mem) {
              setMemoryUsage(mem.usedJSHeapSize);
            }
          }
        }
      }

      animationFrameRef.current = requestAnimationFrame(measure);
    };

    animationFrameRef.current = requestAnimationFrame(measure);

    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, [setFps, setMemoryUsage]);
};
