import { useRef, useEffect } from 'react';

interface WaveformChartProps {
  data: number[];
  color?: string;
  height?: number;
  showGrid?: boolean;
  label?: string;
}

export default function WaveformChart({
  data,
  color = '#00d4ff',
  height = 200,
  showGrid = true,
  label,
}: WaveformChartProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();

    canvas.width = rect.width * dpr;
    canvas.height = height * dpr;
    ctx.scale(dpr, dpr);

    const width = rect.width;
    const h = height;

    ctx.clearRect(0, 0, width, h);

    if (showGrid) {
      ctx.strokeStyle = 'rgba(0, 212, 255, 0.1)';
      ctx.lineWidth = 1;

      const gridLinesX = 10;
      const gridLinesY = 5;

      for (let i = 0; i <= gridLinesX; i++) {
        const x = (width / gridLinesX) * i;
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, h);
        ctx.stroke();
      }

      for (let i = 0; i <= gridLinesY; i++) {
        const y = (h / gridLinesY) * i;
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(width, y);
        ctx.stroke();
      }

      ctx.strokeStyle = 'rgba(0, 212, 255, 0.3)';
      ctx.beginPath();
      ctx.moveTo(0, h / 2);
      ctx.lineTo(width, h / 2);
      ctx.stroke();
    }

    if (data.length > 1) {
      const gradient = ctx.createLinearGradient(0, 0, 0, h);
      gradient.addColorStop(0, color + '40');
      gradient.addColorStop(0.5, color + '15');
      gradient.addColorStop(1, color + '00');

      let maxVal = 0;
      for (let i = 0; i < data.length; i++) {
        const abs = Math.abs(data[i]);
        if (abs > maxVal) maxVal = abs;
      }
      if (maxVal === 0) maxVal = 1;

      const amplitude = maxVal * 1.2;
      const centerY = h / 2;
      const stepX = width / (data.length - 1);

      ctx.beginPath();
      ctx.moveTo(0, centerY);

      for (let i = 0; i < data.length; i++) {
        const x = i * stepX;
        const y = centerY - (data[i] / amplitude) * (h / 2 - 10);
        if (i === 0) {
          ctx.moveTo(x, y);
        } else {
          ctx.lineTo(x, y);
        }
      }

      ctx.lineTo(width, centerY);
      ctx.closePath();
      ctx.fillStyle = gradient;
      ctx.fill();

      ctx.beginPath();
      for (let i = 0; i < data.length; i++) {
        const x = i * stepX;
        const y = centerY - (data[i] / amplitude) * (h / 2 - 10);
        if (i === 0) {
          ctx.moveTo(x, y);
        } else {
          ctx.lineTo(x, y);
        }
      }
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.shadowColor = color;
      ctx.shadowBlur = 8;
      ctx.stroke();
      ctx.shadowBlur = 0;
    }

    if (label) {
      ctx.fillStyle = 'rgba(0, 212, 255, 0.8)';
      ctx.font = '11px JetBrains Mono, monospace';
      ctx.fillText(label, 8, 16);
    }
  }, [data, color, height, showGrid, label]);

  return (
    <canvas
      ref={canvasRef}
      className="w-full"
      style={{ height: `${height}px` }}
    />
  );
}
