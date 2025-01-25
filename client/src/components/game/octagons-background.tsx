import { useEffect, useRef } from 'react';

interface OctagonsBackgroundProps {
  className?: string;
}

export function OctagonsBackground({ className = "" }: OctagonsBackgroundProps) {
  const backgroundRef = useRef<SVGSVGElement>(null);

  useEffect(() => {
    const handleScroll = () => {
      if (!backgroundRef.current) return;
      const scrolled = window.scrollY;
      backgroundRef.current.style.transform = `translateY(${scrolled * 0.1}px)`;
    };

    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  return (
    <svg
      ref={backgroundRef}
      className={`absolute inset-0 w-full h-full ${className}`}
      viewBox="0 0 1000 1000"
      preserveAspectRatio="xMidYMid slice"
      style={{ transition: 'transform 0.1s ease-out' }}
    >
      <defs>
        <pattern
          id="octagon-pattern"
          x="0"
          y="0"
          width="100"
          height="100"
          patternUnits="userSpaceOnUse"
        >
          <path
            d="M38.29 0h23.42L100 38.29v23.42L61.71 100H38.29L0 61.71V38.29L38.29 0z"
            fill="none"
            stroke="currentColor"
            strokeWidth="1"
            className="text-primary/10"
          />
        </pattern>
        
        {/* Gradient overlay for depth */}
        <linearGradient id="depth-gradient" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="rgba(52, 152, 219, 0.05)" />
          <stop offset="50%" stopColor="rgba(52, 152, 219, 0.02)" />
          <stop offset="100%" stopColor="rgba(52, 152, 219, 0.05)" />
        </linearGradient>
      </defs>

      {/* Base pattern layer */}
      <rect width="100%" height="100%" fill="url(#octagon-pattern)" />
      
      {/* Gradient overlay */}
      <rect width="100%" height="100%" fill="url(#depth-gradient)" />
      
      {/* Additional scattered octagons for depth */}
      {Array.from({ length: 20 }).map((_, i) => {
        const x = Math.random() * 1000;
        const y = Math.random() * 1000;
        const size = 20 + Math.random() * 40;
        
        return (
          <path
            key={`octagon-${i}`}
            d={`M${x + size * 0.3829} ${y}h${size * 0.2342}L${x + size} ${y + size * 0.3829}v${size * 0.2342}L${x + size * 0.6171} ${y + size}h${-size * 0.2342}L${x} ${y + size * 0.6171}v${-size * 0.2342}L${x + size * 0.3829} ${y}z`}
            className="text-primary/5"
            fill="currentColor"
          />
        );
      })}
    </svg>
  );
}
