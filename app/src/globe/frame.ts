// Written with AI assistance, directed and reviewed by the team.
import {
  Cartesian3,
  Cartographic,
  Cesium3DTileset,
  Ellipsoid,
  HeadingPitchRange,
  Math as CesiumMath,
  Viewer,
} from 'cesium';
import { GridOrigin, RouteGrid, lonlatToLocalMetres } from '../lib/grid';
import type { SiteData } from '../types';
import { attachSiteTerrain, type SiteTerrainMesh } from './siteTerrain';

export interface LonLatHeight {
  lon: number;
  lat: number;
  heightM: number;
}

export interface Pose {
  lon: number;
  lat: number;
  headingDeg: number;
}

/**
 * Cesium Mars height minus bundle elevation at each site, measured in the spike.
 * Bundle elevations sit on a different vertical datum, so the sign differs by site.
 */
export const SPIKE_HEIGHT_OFFSETS_M: Record<string, number> = { gale: 73.76, jezero: -70.92 };

const OFFSET_TOLERANCE_M = 2;

export function cartesianToLonLat(c: Cartesian3 | undefined): LonLatHeight | null {
  if (!c) return null;
  const carto = Ellipsoid.MARS.cartesianToCartographic(c);
  if (!carto) return null;
  return {
    lon: CesiumMath.toDegrees(carto.longitude),
    lat: CesiumMath.toDegrees(carto.latitude),
    heightM: carto.height,
  };
}

export function lonLatToCartesian(lon: number, lat: number, heightM: number): Cartesian3 {
  return Cartesian3.fromDegrees(lon, lat, heightM, Ellipsoid.MARS);
}

/** Camera height on the Cesium surface for an eye eyeM above a bundle elevation. */
export function eyeHeightM(bundleElevM: number, heightOffsetM: number, eyeM = 1.7): number {
  return bundleElevM + heightOffsetM + eyeM;
}

export function visorCamera(pose: Pose, groundM: number, pitchDeg = -4) {
  return {
    destination: lonLatToCartesian(pose.lon, pose.lat, groundM + 1.7),
    orientation: {
      heading: CesiumMath.toRadians(pose.headingDeg),
      pitch: CesiumMath.toRadians(pitchDeg),
      roll: 0,
    },
  };
}

export function chaseCamera(pose: Pose, groundM: number, rangeM = 220, pitchDeg = -40) {
  return {
    target: lonLatToCartesian(pose.lon, pose.lat, groundM),
    offset: new HeadingPitchRange(CesiumMath.toRadians(pose.headingDeg), CesiumMath.toRadians(pitchDeg), rangeM),
  };
}

/** Ground metres per screen pixel between two picked points, in the local-metre frame. */
export function metresPerPixel(
  a: { lon: number; lat: number },
  b: { lon: number; lat: number },
  pixels: number,
  origin: GridOrigin,
): number {
  const pa = lonlatToLocalMetres(a.lon, a.lat, origin);
  const pb = lonlatToLocalMetres(b.lon, b.lat, origin);
  return Math.hypot(pb.x_m - pa.x_m, pb.y_m - pa.y_m) / pixels;
}

/**
 * Picks the height offset for a site: the measured value when there is one, else the spike value.
 * Warns when the two disagree by more than 2 m, or when nothing was measured.
 */
export function chooseHeightOffset(
  siteId: string,
  measuredM: number | undefined,
  warn: (message: string) => void = console.warn,
): number {
  const spike = SPIKE_HEIGHT_OFFSETS_M[siteId];
  if (measuredM === undefined || !Number.isFinite(measuredM)) {
    if (spike === undefined) {
      warn(`Height offset at ${siteId} not measured and no spike value; using 0 m`);
      return 0;
    }
    warn(`Height offset at ${siteId} not measured, using spike value ${spike.toFixed(2)} m`);
    return spike;
  }
  if (spike !== undefined && Math.abs(measuredM - spike) > OFFSET_TOLERANCE_M) {
    warn(
      `Height offset at ${siteId} measured ${measuredM.toFixed(2)} m, spike value ${spike.toFixed(2)} m ` +
        `(${Math.abs(measuredM - spike).toFixed(2)} m apart)`,
    );
    if (Math.abs(measuredM - spike) > 100) return spike;
  }
  return measuredM;
}

export interface OfflineSurface {
  mesh: SiteTerrainMesh | null;
  /** Add to a bundle elevation to reach the mesh; null when the ground is the bare ellipsoid (0 m). */
  heightOffsetM: number | null;
}

/**
 * The ground Walk and Visor stand on without Cesium Mars: our site terrain mesh, lifted onto the
 * ellipsoid, when the bundle has one, else the ellipsoid itself. Bundle heights plus a Cesium Mars
 * offset would put the camera kilometres under the ellipsoid at Gale, where the view is black.
 */
export async function attachOfflineSurface(viewer: Viewer, site: SiteData): Promise<OfflineSurface> {
  const mesh = await attachSiteTerrain(viewer, null, site);
  return { mesh, heightOffsetM: mesh ? mesh.heightOffsetM : null };
}

/**
 * Measures Cesium Mars height minus bundle elevation at the site centre.
 * Falls back to the spike value when the tileset is missing or returns no height there.
 */
export async function siteHeightOffsetM(
  viewer: Viewer,
  tileset: Cesium3DTileset | null,
  site: SiteData,
  grid: RouteGrid,
): Promise<number> {
  let measured: number | undefined;
  if (tileset) {
    const centre = grid.localMetresToLonLat(grid.width_m / 2, grid.height_m / 2);
    const { row, col } = grid.lonlatToRowCol(centre.lon, centre.lat);
    const bundleM = grid.getElevation(row, col);
    if (Number.isFinite(bundleM)) {
      try {
        const [sampled] = await viewer.scene.sampleHeightMostDetailed([
          Cartographic.fromDegrees(centre.lon, centre.lat),
        ]);
        if (sampled?.height !== undefined) measured = sampled.height - bundleM;
      } catch (error) {
        console.warn('Height sample at the site centre failed', error);
      }
    }
  }
  return chooseHeightOffset(site.id, measured);
}
