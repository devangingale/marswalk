// Written with AI assistance, directed and reviewed by the team.
import { describe, expect, it } from 'vitest';
import { Cartesian3, Ellipsoid, Matrix4 } from 'cesium';
import { cartesianToLonLat } from './frame';
import { hillshadeLight, liftMatrix, measureEdgeSeam, siteCorners } from './siteTerrain';
import type { RouteGrid } from '../lib/grid';
import type { SiteData } from '../types';
import type { Cesium3DTileset, Viewer } from 'cesium';

const GALE = { lon: 137.36468863872997, lat: -4.761729489694319 };
const METRES_PER_DEGREE = (3396190 * Math.PI) / 180;

describe('liftMatrix', () => {
  const lift = liftMatrix(GALE.lon, GALE.lat, -4008.44, 4008.44);

  it('raises the patch centre by the lift along its normal', () => {
    const p = cartesianToLonLat(
      Matrix4.multiplyByPoint(lift, Cartesian3.fromDegrees(GALE.lon, GALE.lat, -4008.44, Ellipsoid.MARS), new Cartesian3()),
    );
    expect(Math.abs(p!.lon - GALE.lon) * METRES_PER_DEGREE).toBeLessThan(0.01);
    expect(Math.abs(p!.lat - GALE.lat) * METRES_PER_DEGREE).toBeLessThan(0.01);
    expect(p!.heightM).toBeCloseTo(0, 6);
  });

  it('keeps longitude, latitude and relief 2 km from the centre to within 1 cm', () => {
    const lon = GALE.lon + 0.0337;
    const lat = GALE.lat - 0.0337;
    const p = cartesianToLonLat(
      Matrix4.multiplyByPoint(lift, Cartesian3.fromDegrees(lon, lat, -3700, Ellipsoid.MARS), new Cartesian3()),
    );
    expect(Math.abs(p!.lon - lon) * METRES_PER_DEGREE).toBeLessThan(0.01);
    expect(Math.abs(p!.lat - lat) * METRES_PER_DEGREE).toBeLessThan(0.01);
    expect(p!.heightM).toBeCloseTo(308.44, 2);
  });
});

describe('siteCorners', () => {
  it('walks the site rectangle counter-clockwise from the south-west at the datum', () => {
    const corners = siteCorners([137.36, -4.77, 137.37, -4.76]).map((c) => cartesianToLonLat(c)!);
    expect(corners.map((c) => [c.lon, c.lat].map((v) => Number(v.toFixed(9))))).toEqual([
      [137.36, -4.77],
      [137.37, -4.77],
      [137.37, -4.76],
      [137.36, -4.76],
    ]);
    corners.forEach((c) => expect(c.heightM).toBeCloseTo(0, 6));
  });
});

describe('hillshadeLight', () => {
  it('points 45 degrees above the horizon towards the north-west', () => {
    const light = hillshadeLight(GALE.lon, GALE.lat);
    const up = Ellipsoid.MARS.geodeticSurfaceNormal(Cartesian3.fromDegrees(GALE.lon, GALE.lat, 0, Ellipsoid.MARS));
    const north = Cartesian3.fromDegrees(GALE.lon, GALE.lat + 0.001, 0, Ellipsoid.MARS);
    const east = Cartesian3.fromDegrees(GALE.lon + 0.001, GALE.lat, 0, Ellipsoid.MARS);
    const origin = Cartesian3.fromDegrees(GALE.lon, GALE.lat, 0, Ellipsoid.MARS);
    const towards = (p: Cartesian3) => Cartesian3.normalize(Cartesian3.subtract(p, origin, new Cartesian3()), new Cartesian3());
    expect(Cartesian3.magnitude(light)).toBeCloseTo(1, 12);
    expect(Cartesian3.dot(light, up)).toBeCloseTo(Math.SQRT1_2, 9);
    expect(Cartesian3.dot(light, towards(north))).toBeCloseTo(0.5, 4);
    expect(Cartesian3.dot(light, towards(east))).toBeCloseTo(-0.5, 4);
  });
});

describe('measureEdgeSeam', () => {
  const fakeSite = {
    bounds_lonlat: [137.36, -4.82, 137.42, -4.76],
  } as unknown as SiteData;

  const fakeGrid = {
    lonlatToRowCol: (_lon: number, _lat: number) => ({ row: 0, col: 0 }),
    getElevation: (_row: number, _col: number) => -4000,
  } as unknown as RouteGrid;

  it('returns null when offline (no mars tileset)', async () => {
    const viewer = {} as Viewer;
    expect(await measureEdgeSeam(viewer, null, fakeSite, fakeGrid, 70.91)).toBeNull();
  });

  it('computes mean and max seam differences along the site boundary', async () => {
    const sampleHeights = [-3929.0, -3930.0, -3928.5, -3929.5];
    let call = 0;
    const fakeViewer = {
      isDestroyed: () => false,
      scene: {
        sampleHeightMostDetailed: async (cartos: { longitude: number; latitude: number }[]) => {
          return cartos.map(() => {
            const h = sampleHeights[call % sampleHeights.length];
            call++;
            return { height: h };
          });
        },
      },
    } as unknown as Viewer;

    const fakeTileset = {} as Cesium3DTileset;
    // bundle height (-4000) + heightOffset (70.91) = -3929.09
    // diffs to sample heights:
    // |-3929.09 - (-3929.0)| = 0.09
    // |-3929.09 - (-3930.0)| = 0.91
    // |-3929.09 - (-3928.5)| = 0.59
    // |-3929.09 - (-3929.5)| = 0.41
    // mean: (0.09 + 0.91 + 0.59 + 0.41) / 4 = 0.50
    // max: 0.91
    const report = await measureEdgeSeam(fakeViewer, fakeTileset, fakeSite, fakeGrid, 70.91, 1);
    expect(report).not.toBeNull();
    expect(report!.samples).toBe(4);
    expect(report!.meanM).toBeCloseTo(0.5, 2);
    expect(report!.maxM).toBeCloseTo(0.91, 2);
  });
});
