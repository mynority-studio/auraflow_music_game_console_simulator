import React from 'react';

export const PixelIcon = ({ grid, color = 'currentColor', className = '' }: { grid: number[][], color?: string, className?: string }) => {
  const height = grid.length;
  const width = grid[0].length;
  return (
    <svg viewBox={`0 0 ${width} ${height}`} className={className} style={{ width: '100%', height: '100%', imageRendering: 'pixelated' }}>
      {grid.map((row, y) => row.map((cell, x) => cell ? <rect key={`${x}-${y}`} x={x} y={y} width="1" height="1" fill={color} /> : null))}
    </svg>
  );
};
