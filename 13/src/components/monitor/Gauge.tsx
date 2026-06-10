interface GaugeProps {
  value: number;
  max: number;
  threshold?: number;
  label: string;
  unit?: string;
  color?: string;
  size?: number;
}

export default function Gauge({
  value,
  max,
  threshold,
  label,
  unit = '',
  color = '#00d4ff',
  size = 140,
}: GaugeProps) {
  const percentage = Math.min(100, (value / max) * 100);
  const strokeWidth = 8;
  const radius = (size - strokeWidth) / 2;
  const circumference = Math.PI * radius;

  const getColor = () => {
    if (threshold && value > threshold * 1.3) return '#ff4757';
    if (threshold && value > threshold) return '#ffa502';
    return color;
  };

  const currentColor = getColor();

  return (
    <div className="flex flex-col items-center">
      <div className="relative" style={{ width: size, height: size / 2 + 20 }}>
        <svg
          width={size}
          height={size / 2 + 20}
          viewBox={`0 0 ${size} ${size / 2 + 20}`}
        >
          <defs>
            <linearGradient id={`gauge-gradient-${label}`} x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor={currentColor} stopOpacity="0.8" />
              <stop offset="100%" stopColor={currentColor} stopOpacity="1" />
            </linearGradient>
            <filter id={`glow-${label}`}>
              <feGaussianBlur stdDeviation="3" result="coloredBlur" />
              <feMerge>
                <feMergeNode in="coloredBlur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          </defs>

          <path
            d={`M ${strokeWidth / 2} ${size / 2} A ${radius} ${radius} 0 0 1 ${size - strokeWidth / 2} ${size / 2}`}
            fill="none"
            stroke="rgba(255, 255, 255, 0.1)"
            strokeWidth={strokeWidth}
            strokeLinecap="round"
          />

          <path
            d={`M ${strokeWidth / 2} ${size / 2} A ${radius} ${radius} 0 0 1 ${size - strokeWidth / 2} ${size / 2}`}
            fill="none"
            stroke={`url(#gauge-gradient-${label})`}
            strokeWidth={strokeWidth}
            strokeLinecap="round"
            strokeDasharray={`${(percentage / 100) * circumference}`}
            strokeDashoffset={0}
            transform={`rotate(-180 ${size / 2} ${size / 2})`}
            filter={`url(#glow-${label})`}
            style={{ transition: 'stroke-dasharray 0.5s ease' }}
          />

          {threshold && threshold < max && (
            <line
              x1={size / 2 + radius * Math.cos(Math.PI - (threshold / max) * Math.PI)}
              y1={size / 2 - radius * Math.sin(Math.PI - (threshold / max) * Math.PI)}
              x2={size / 2 + (radius - 12) * Math.cos(Math.PI - (threshold / max) * Math.PI)}
              y2={size / 2 - (radius - 12) * Math.sin(Math.PI - (threshold / max) * Math.PI)}
              stroke="#ff4757"
              strokeWidth="2"
              strokeLinecap="round"
            />
          )}

          <text
            x={size / 2}
            y={size / 2 - 5}
            textAnchor="middle"
            dominantBaseline="middle"
            fill={currentColor}
            fontSize="20"
            fontWeight="bold"
            fontFamily="Orbitron, monospace"
            style={{ textShadow: `0 0 10px ${currentColor}80` }}
          >
            {value.toFixed(2)}
          </text>
        </svg>
      </div>
      <div className="text-xs text-gray-400 mt-1 font-medium">
        {label}
        {unit && <span className="text-gray-500 ml-1">({unit})</span>}
      </div>
    </div>
  );
}
