// Written with AI assistance, directed and reviewed by the team.
// Straight-line surface distance between panorama stops on the Mars ellipsoid.
import { Cartographic, Ellipsoid, EllipsoidGeodesic, Math as CesiumMath } from 'cesium';
import type { PanoramaStop } from './panoramas';

function geodesic(a: PanoramaStop, b: PanoramaStop): EllipsoidGeodesic {
  return new EllipsoidGeodesic(
    Cartographic.fromDegrees(a.lon_east, a.lat),
    Cartographic.fromDegrees(b.lon_east, b.lat),
    Ellipsoid.MARS,
  );
}

const samePoint = (a: PanoramaStop, b: PanoramaStop) => a.lat === b.lat && a.lon_east === b.lon_east;

/** Geodesic surface distance between two stops on Cesium's Mars ellipsoid, metres. */
export function geodesicM(a: PanoramaStop, b: PanoramaStop): number {
  return samePoint(a, b) ? 0 : geodesic(a, b).surfaceDistance;
}

/** Initial compass bearing of the geodesic from a to b, degrees clockwise from north; null for the same point. */
export function geodesicBearingDeg(a: PanoramaStop, b: PanoramaStop): number | null {
  return samePoint(a, b) ? null : CesiumMath.toDegrees(CesiumMath.zeroToTwoPi(geodesic(a, b).startHeading));
}

/** "833 m" or "2.13 km" */
export function formatMetres(metres: number): string {
  return metres < 1000 ? `${Math.round(metres).toLocaleString('en-GB')} m` : `${(metres / 1000).toFixed(2)} km`;
}
