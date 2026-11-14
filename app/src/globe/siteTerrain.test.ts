// Written with AI assistance, directed and reviewed by the team.
import { describe, expect, it } from 'vitest';
import { Cartesian3, Ellipsoid, Matrix4 } from 'cesium';
import { cartesianToLonLat } from './frame';
import { hillshadeLight, liftMatrix, siteCorners } from './siteTerrain';

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
