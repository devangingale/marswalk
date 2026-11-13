// Written with AI assistance, directed and reviewed by the team.

import React, { useEffect, useState } from 'react';
import type { Map as MapLibreMap } from 'maplibre-gl';
import { calculateMarsScaleBar, MarsScaleResult } from '../utils/scale';

interface ScaleBarProps {
  map: MapLibreMap | null;
  defaultLat?: number;
}

export const ScaleBar: React.FC<ScaleBarProps> = ({ map, defaultLat = -4.7913 }) => {
  const [scale, setScale] = useState<MarsScaleResult>({
    distanceMeters: 100,
    pixelWidth: 100,
    label: '100 m',
    metersPerPixel: 1,
  });

  useEffect(() => {
    if (!map) return;

    const updateScale = () => {
      const container = map.getContainer();
      const width = container.clientWidth;
      const height = container.clientHeight;

      if (width <= 0 || height <= 0) return;

      // Sample a horizontal 100px segment near bottom-left of map
      const y = Math.max(10, height - 40);
      const xLeft = 30;
      const xRight = xLeft + 100;

      const pLeft = map.unproject([xLeft, y]);
      const pRight = map.unproject([xRight, y]);

      const result = calculateMarsScaleBar(
        pLeft.lng,
        pRight.lng,
        (pLeft.lat + pRight.lat) / 2 || defaultLat,
        100,
        120
      );

      setScale(result);
    };

    updateScale();

    map.on('move', updateScale);
    map.on('zoom', updateScale);
    map.on('resize', updateScale);

    return () => {
      map.off('move', updateScale);
      map.off('zoom', updateScale);
      map.off('resize', updateScale);
    };
  }, [map, defaultLat]);

  return (
    <div
      style={{
        position: 'absolute',
        bottom: '16px',
        left: '16px',
        zIndex: 20,
        backgroundColor: 'rgba(15, 23, 42, 0.85)',
        backdropFilter: 'blur(4px)',
        border: '1px solid rgba(51, 65, 85, 0.8)',
        borderRadius: '4px',
        padding: '6px 10px',
        color: '#f8fafc',
        fontFamily: 'monospace, sans-serif',
        boxShadow: '0 2px 6px rgba(0,0,0,0.4)',
        pointerEvents: 'auto',
      }}
      title="True Mars ground scale (R = 3396190 m, contracts section 3). Independent of Earth Mercator projection."
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '3px' }}>
        <span style={{ fontSize: '11px', fontWeight: 700, color: '#f8fafc' }}>
          {scale.label}
        </span>
        <span style={{ fontSize: '9px', color: '#94a3b8', marginLeft: '8px' }}>
          MARS R=3396 km
        </span>
      </div>
      <div
        style={{
          width: `${scale.pixelWidth}px`,
          height: '4px',
          backgroundColor: '#38bdf8',
          borderLeft: '2px solid #ffffff',
          borderRight: '2px solid #ffffff',
          position: 'relative',
        }}
      />
    </div>
  );
};
