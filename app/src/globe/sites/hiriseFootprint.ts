// Written with AI assistance, directed and reviewed by the team.
// Thin outline of the selected site's HiRISE footprint on the globe.

import { ArcType, ClassificationType, Color, Entity } from 'cesium';
import { lonLatToCartesian } from '../frame';

/** Entity options for a footprint outline (a closed ring), clamped to the globe and 3D tiles. */
export function footprintOutline(ring: [number, number][], colour: Color): Entity.ConstructorOptions {
  return {
    id: 'site-hirise-footprint',
    polyline: {
      positions: ring.map(([lon, lat]) => lonLatToCartesian(lon, lat, 0)),
      width: 2,
      clampToGround: true,
      arcType: ArcType.GEODESIC,
      classificationType: ClassificationType.BOTH,
      material: colour,
    },
  };
}
