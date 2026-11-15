// Written with AI assistance, directed and reviewed by the team.
import { describe, expect, it } from 'vitest';
import { Cartesian3 } from 'cesium';
import { PLANET_VIEW_MIN_HEIGHT_M, aimAtCentre, inPlanetView, radialZoom } from './planetView';

const R = 3396190;

describe('inPlanetView', () => {
  it('locks the globe in place only at whole-planet heights', () => {
    expect(PLANET_VIEW_MIN_HEIGHT_M).toBe(1_500_000);
    expect(inPlanetView(9_000_000)).toBe(true);
    expect(inPlanetView(1_500_000)).toBe(true);
    expect(inPlanetView(1_499_999)).toBe(false);
    expect(inPlanetView(4_000)).toBe(false);
  });
});

describe('radialZoom', () => {
  it('moves the camera straight towards or away from the centre', () => {
    const at = new Cartesian3(R + 9_000_000, 0, 0);
    const closer = radialZoom(at, R, 0.8);
    expect(closer.x).toBeCloseTo(R + 7_200_000, 3);
    expect(closer.y).toBe(0);
    expect(closer.z).toBe(0);
    const diagonal = radialZoom(new Cartesian3(0, R + 4_000_000, R + 4_000_000), R * Math.SQRT2, 1.25);
    // Height above the sphere of radius R*sqrt(2) scales by 1.25 along the same direction.
    const height = Cartesian3.magnitude(diagonal) - R * Math.SQRT2;
    const before = Math.hypot(R + 4_000_000, R + 4_000_000) - R * Math.SQRT2;
    expect(height).toBeCloseTo(before * 1.25, 3);
    expect(diagonal.y).toBeCloseTo(diagonal.z, 6);
  });
});

describe('aimAtCentre', () => {
  it('looks at the planet centre with north up', () => {
    const { direction, up } = aimAtCentre(new Cartesian3(R * 3, 0, 0));
    expect(direction.x).toBeCloseTo(-1, 12);
    expect(up.z).toBeCloseTo(1, 12);
    expect(Cartesian3.dot(direction, up)).toBeCloseTo(0, 12);
  });

  it('keeps a valid up vector above a pole', () => {
    const { direction, up } = aimAtCentre(new Cartesian3(0, 0, R * 3));
    expect(direction.z).toBeCloseTo(-1, 12);
    expect(Cartesian3.magnitude(up)).toBeCloseTo(1, 12);
    expect(Cartesian3.dot(direction, up)).toBeCloseTo(0, 12);
  });
});
