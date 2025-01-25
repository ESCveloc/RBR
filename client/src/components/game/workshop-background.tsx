import { useEffect, useRef } from 'react';

interface WorkshopBackgroundProps {
  className?: string;
}

export function WorkshopBackground({ className = "" }: WorkshopBackgroundProps) {
  return (
    <svg
      className={`absolute inset-0 w-full h-full ${className}`}
      viewBox="0 0 1200 800"
      preserveAspectRatio="xMidYMid slice"
    >
      <defs>
        {/* Metal texture gradient */}
        <linearGradient id="metallic" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#2c3e50" />
          <stop offset="50%" stopColor="#34495e" />
          <stop offset="100%" stopColor="#2c3e50" />
        </linearGradient>

        {/* Tactical screen glow */}
        <radialGradient id="screen-glow" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#3498db" stopOpacity="0.3" />
          <stop offset="100%" stopColor="#2980b9" stopOpacity="0" />
        </radialGradient>

        {/* Equipment highlight */}
        <linearGradient id="equipment-highlight" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor="#e74c3c" stopOpacity="0.2" />
          <stop offset="100%" stopColor="#c0392b" stopOpacity="0" />
        </linearGradient>

        {/* Military pattern */}
        <pattern id="military-pattern" x="0" y="0" width="20" height="20" patternUnits="userSpaceOnUse">
          <rect x="0" y="0" width="20" height="20" fill="#2c3e50" fillOpacity="0.1" />
          <path d="M0 10 L20 10 M10 0 L10 20" stroke="#34495e" strokeWidth="0.5" />
        </pattern>
      </defs>

      {/* Workshop floor */}
      <rect width="100%" height="100%" fill="#1a1a1a" />
      <rect width="100%" height="100%" fill="url(#military-pattern)" />

      {/* Grid lines */}
      <g stroke="rgba(52, 152, 219, 0.1)" strokeWidth="1">
        {Array.from({ length: 20 }).map((_, i) => (
          <path
            key={`grid-${i}`}
            d={`M${i * 60} 0 L${i * 60} 800 M0 ${i * 40} L1200 ${i * 40}`}
          />
        ))}
      </g>

      {/* Main workbench */}
      <g transform="translate(100, 300)">
        <rect width="400" height="150" fill="url(#metallic)" />
        <rect width="400" height="20" fill="#34495e" />
        {/* Tools on workbench */}
        {Array.from({ length: 5 }).map((_, i) => (
          <rect
            key={`tool-${i}`}
            x={50 + i * 70}
            y="30"
            width="40"
            height="10"
            fill="#7f8c8d"
          />
        ))}
      </g>

      {/* Weapon rack */}
      <g transform="translate(800, 100)">
        <rect width="300" height="400" fill="url(#metallic)" opacity="0.7" />
        {/* Weapon silhouettes */}
        {Array.from({ length: 4 }).map((_, i) => (
          <g key={`weapon-${i}`} transform={`translate(50, ${50 + i * 100})`}>
            <rect width="200" height="30" rx="5" fill="#2c3e50" />
            <rect
              width="200"
              height="30"
              rx="5"
              fill="url(#equipment-highlight)"
            />
          </g>
        ))}
      </g>

      {/* Tactical screens */}
      <g transform="translate(50, 50)">
        {Array.from({ length: 3 }).map((_, i) => (
          <g key={`screen-${i}`} transform={`translate(${i * 250}, 0)`}>
            <rect width="200" height="150" rx="10" fill="#2c3e50" />
            <rect
              width="180"
              height="130"
              x="10"
              y="10"
              fill="#34495e"
              opacity="0.8"
            />
            <rect
              width="180"
              height="130"
              x="10"
              y="10"
              fill="url(#screen-glow)"
            />
            {/* Screen content */}
            <path
              d={`M20 ${75 + Math.sin(i) * 20} L180 ${75 + Math.cos(i) * 20}`}
              stroke="#3498db"
              strokeWidth="2"
              fill="none"
            />
          </g>
        ))}
      </g>

      {/* Equipment storage */}
      <g transform="translate(600, 500)">
        <rect width="500" height="250" fill="url(#metallic)" />
        {/* Compartments */}
        {Array.from({ length: 10 }).map((_, i) => (
          <rect
            key={`compartment-${i}`}
            x={i * 50}
            y="0"
            width="45"
            height="250"
            fill="#2c3e50"
            stroke="#34495e"
          />
        ))}
      </g>

      {/* Ambient lighting */}
      <g opacity="0.3">
        <radialGradient id="ambient-light" cx="50%" cy="0%" r="70%">
          <stop offset="0%" stopColor="#3498db" stopOpacity="0.2" />
          <stop offset="100%" stopColor="#2c3e50" stopOpacity="0" />
        </radialGradient>
        <rect width="100%" height="100%" fill="url(#ambient-light)" />
      </g>
    </svg>
  );
}