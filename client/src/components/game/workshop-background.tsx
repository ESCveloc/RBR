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
        {/* Gradient for metallic effect */}
        <linearGradient id="metallic" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#2c3e50" />
          <stop offset="50%" stopColor="#3498db" />
          <stop offset="100%" stopColor="#2c3e50" />
        </linearGradient>
        
        {/* Gradient for workshop lighting */}
        <radialGradient id="workshop-light" cx="50%" cy="50%" r="50%" fx="50%" fy="50%">
          <stop offset="0%" stopColor="rgba(255, 255, 255, 0.2)" />
          <stop offset="100%" stopColor="rgba(0, 0, 0, 0.8)" />
        </radialGradient>
      </defs>

      {/* Background */}
      <rect width="100%" height="100%" fill="#1a1a1a" />
      
      {/* Workshop floor grid */}
      <path
        d="M0 700 L1200 700 M0 600 L1200 600 M0 500 L1200 500 M0 400 L1200 400
           M200 800 L200 0 M400 800 L400 0 M600 800 L600 0 M800 800 L800 0 M1000 800 L1000 0"
        stroke="rgba(255, 255, 255, 0.1)"
        strokeWidth="1"
      />

      {/* Workbench */}
      <rect x="100" y="400" width="400" height="200" fill="url(#metallic)" />
      
      {/* Tactical gear display */}
      <g transform="translate(600, 300)">
        {/* Helmet outline */}
        <path
          d="M50 0 C20 0 0 20 0 50 L0 80 C0 110 20 130 50 130 L80 130 C110 130 130 110 130 80 L130 50 C130 20 110 0 80 0 Z"
          fill="url(#metallic)"
          stroke="#3498db"
          strokeWidth="2"
        />
        
        {/* Visor */}
        <path
          d="M30 40 L100 40 L115 60 L15 60 Z"
          fill="#3498db"
          opacity="0.7"
        />
      </g>

      {/* Tool rack */}
      <g transform="translate(800, 200)">
        <rect x="0" y="0" width="200" height="20" fill="url(#metallic)" />
        <rect x="20" y="20" width="5" height="100" fill="url(#metallic)" />
        <rect x="180" y="20" width="5" height="100" fill="url(#metallic)" />
      </g>

      {/* Ambient lighting */}
      <circle cx="600" cy="100" r="400" fill="url(#workshop-light)" opacity="0.4" />
    </svg>
  );
}
