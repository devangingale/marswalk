// Written with AI assistance, directed and reviewed by the team.
// EVA step estimates between panorama stops: surface distance on the Mars ellipsoid and the
// number of suited strides it takes.
import { Cartographic, Ellipsoid, EllipsoidGeodesic } from 'cesium';
import type { PanoramaStop } from './panoramas';

/**
 * Metres per suited stride in Mars gravity. An assumption for the demo, not a measured value:
 * close to an Earth walking stride, since a pressurised suit limits how far the legs swing.
 */
export const STRIDE_M = 0.75;

/** Geodesic surface distance between two stops on the Mars ellipsoid, metres. */
export function surfaceDistanceM(a: PanoramaStop, b: PanoramaStop): number {
  const geodesic = new EllipsoidGeodesic(
    Cartographic.fromDegrees(a.lon_east, a.lat),
    Cartographic.fromDegrees(b.lon_east, b.lat),
    Ellipsoid.MARS,
  );
  return geodesic.surfaceDistance;
}

export function stepsFor(metres: number): number {
  return Math.round(metres / STRIDE_M);
}

export function formatMetres(metres: number): string {
  return metres < 1000 ? `${Math.round(metres)} m` : `${(metres / 1000).toFixed(1)} km`;
}

/** "142 m (~189 steps)" */
export function legLabel(metres: number): string {
  return `${formatMetres(metres)} (~${stepsFor(metres).toLocaleString('en-GB')} steps)`;
}

/** Same-point stops guard against a meaningless zero-length geodesic. */
export function legBetween(a: PanoramaStop, b: PanoramaStop): number {
  return a.lat === b.lat && a.lon_east === b.lon_east ? 0 : surfaceDistanceM(a, b);
}

