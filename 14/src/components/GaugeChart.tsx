import { useMemo } from 'react';

interface GaugeChartProps {
  value: number;
  min?: number;
  max: number;
  label: string;
  unit: string;
  color?: string;
  size?: number;
}

export function GaugeChart({
  value,
  min = 0,
  max,
  label,
  unit,
  color = '#00f0ff',
  size = 160
}: GaugeChartProps) {
  const strokeWidth = 10;
  const radius = (size - strokeWidth) / 2;
  const circumference = Math.PI * radius;
  const center = size / 2;

  const clampedValue = useMemo(() => {
    return Math.max(min, Math.min(max, value));
  }, [value, min, max]);

  const percentage = useMemo(() => {
    const range = max - min;
    if (range === 0) return 0;
    return (clampedValue - min) / range;
  }, [clampedValue, min, max]);

  const progress = circumference * percentage;

  const gradientId = useMemo(() => `gauge-gradient-${label.replace(/\s/g, '-')}`, [label]);
  const glowId = useMemo(() => `gauge-glow-${label.replace(/\s/g, '-')}`, [label]);

  const tickCount = 10;
  const ticks = useMemo(() => {
    return Array.from({ length: tickCount + 1 }, (_, i) => {
      const t = i / tickCount;
      return {
        angle: Math.PI + t * Math.PI,
        major: i % 2 === 0,
        value: min + t * (max - min)
      };
    });
  }, [min, max]);

  const pointerAngle = Math.PI + percentage * Math.PI;
  const pointerLength = radius - 18;
  const pointerX = center + Math.cos(pointerAngle) * pointerLength;
  const pointerY = center + Math.sin(pointerAngle) * pointerLength;

  const formatValue = (v: number): string => {
    if (Math.abs(v) >= 100) return v.toFixed(0);
    if (Math.abs(v) >= 10) return v.toFixed(1);
    return v.toFixed(2);
  };

  return (
    <div className="relative flex flex-col items-center justify-center">
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        className="drop-shadow-lg"
      >
        <defs>
          <filter id={glowId} x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="2.5" result="coloredBlur" />
            <feMerge>
              <feMergeNode in="coloredBlur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
          <linearGradient id={gradientId} x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor={color} stopOpacity="0.3" />
            <stop offset="50%" stopColor={color} stopOpacity="1" />
            <stop offset="100%" stopColor={color} stopOpacity="0.5" />
          </linearGradient>
        </defs>

        <circle
          cx={center}
          cy={center}
          r={radius}
          fill="none"
          stroke="rgba(30, 58, 95, 0.6)"
          strokeWidth={strokeWidth + 2}
          strokeDasharray={`${circumference} ${circumference * 2}`}
          strokeLinecap="round"
          transform={`rotate(90 ${center} ${center})`}
        />

        <circle
          cx={center}
          cy={center}
          r={radius}
          fill="none"
          stroke={`url(#${gradientId})`}
          strokeWidth={strokeWidth}
          strokeDasharray={`${progress} ${circumference * 2}`}
          strokeLinecap="round"
          transform={`rotate(90 ${center} ${center})`}
          filter={`url(#${glowId})`}
          className="transition-all duration-300 ease-out"
        />

        {ticks.map((tick, i) => {
          const innerR = radius - strokeWidth / 2 - (tick.major ? 10 : 6);
          const outerR = radius - strokeWidth / 2 - 2;
          const x1 = center + Math.cos(tick.angle) * innerR;
          const y1 = center + Math.sin(tick.angle) * innerR;
          const x2 = center + Math.cos(tick.angle) * outerR;
          const y2 = center + Math.sin(tick.angle) * outerR;
          return (
            <line
              key={i}
              x1={x1}
              y1={y1}
              x2={x2}
              y2={y2}
              stroke={tick.major ? color : 'rgba(139, 163, 199, 0.4)'}
              strokeWidth={tick.major ? 1.5 : 1}
              opacity={tick.major ? 0.8 : 0.5}
            />
          );
        })}

        <line
          x1={center}
          y1={center}
          x2={pointerX}
          y2={pointerY}
          stroke={color}
          strokeWidth="2.5"
          strokeLinecap="round"
          filter={`url(#${glowId})`}
          className="transition-all duration-300 ease-out"
        />
        <circle
          cx={center}
          cy={center}
          r="5"
          fill={color}
          filter={`url(#${glowId})`}
        />

        <text
          x={center}
          y={center - 8}
          textAnchor="middle"
          className="font-mono"
          fill="#e0f7ff"
          fontSize={size * 0.17}
          fontWeight="600"
        >
          {formatValue(clampedValue)}
        </text>
        <text
          x={center}
          y={center + 12}
          textAnchor="middle"
          fill="#8ba3c7"
          fontSize={size * 0.08}
        >
          {unit}
        </text>
      </svg>

      <div className="mt-1 text-center">
        <span
          className="text-xs font-medium tracking-wider"
          style={{ color }}
        >
          {label}
        </span>
      </div>
    </div>
  );
}
