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

      const y = Math.max(10, height - 30);
      const xLeft = 20;
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
      className="map-ui"
      style={{ left: '16px', bottom: '16px' }}
      title="True Mars ground scale (R = 3396190 m, contracts section 3)"
    >
      <div className="s48-scale" style={{ width: `${scale.pixelWidth}px` }}>
        <div className="s48-scale__label">{scale.label} (Mars)</div>
        <div className="s48-scale__bar" aria-hidden="true">
          <i />
          <i />
          <i />
          <i />
        </div>
      </div>
    </div>
  );
};
