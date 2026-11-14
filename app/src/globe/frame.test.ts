// Written with AI assistance, directed and reviewed by the team.
import { describe, expect, it, vi } from 'vitest';
import { Cartesian3 } from 'cesium';
import {
  SPIKE_HEIGHT_OFFSETS_M,
  cartesianToLonLat,
  chaseCamera,
  chooseHeightOffset,
  eyeHeightM,
  lonLatToCartesian,
  metresPerPixel,
  visorCamera,
} from './frame';

const GALE_ORIGIN = { lon0: 137.36045619776752, lat0: -4.765947140908848, lat_c: -4.761729489694319 };

describe('cartesianToLonLat', () => {
  it('returns null for a missed pick', () => {
    expect(cartesianToLonLat(undefined)).toBeNull();
  });

  it('maps the prime meridian on the equator to 0, 0 at the surface', () => {
    const p = cartesianToLonLat(new Cartesian3(3396190, 0, 0));
    expect(p).not.toBeNull();
    expect(p!.lon).toBeCloseTo(0, 6);
    expect(p!.lat).toBeCloseTo(0, 6);
    expect(p!.heightM).toBeCloseTo(0, 6);
  });

  it('round-trips through lonLatToCartesian', () => {
    const p = cartesianToLonLat(lonLatToCartesian(137.441633, -4.589467, -4501.04));
    expect(p!.lon).toBeCloseTo(137.441633, 7);
    expect(p!.lat).toBeCloseTo(-4.589467, 7);
    expect(p!.heightM).toBeCloseTo(-4501.04, 3);
  });
});

describe('eyeHeightM', () => {
  it('adds the site offset and 1.7 m eye height to the bundle elevation', () => {
    expect(eyeHeightM(-4501.04, 12.5)).toBeCloseTo(-4486.84, 9);
  });
});

describe('visorCamera', () => {
  it('looks along the heading, pitched down 4 degrees, 1.7 m above the ground', () => {
    const cam = visorCamera({ lon: 137.4, lat: -4.7, headingDeg: 90 }, -4500);
    expect(cam.orientation.heading).toBeCloseTo(Math.PI / 2, 12);
    expect(cam.orientation.pitch).toBeCloseTo((-4 * Math.PI) / 180, 12);
    expect(cam.orientation.roll).toBe(0);
    const at = cartesianToLonLat(cam.destination)!;
    expect(at.lon).toBeCloseTo(137.4, 7);
    expect(at.lat).toBeCloseTo(-4.7, 7);
    expect(at.heightM).toBeCloseTo(-4500 + 1.7, 3);
  });
});

describe('chaseCamera', () => {
  it('targets the ground under the walker with the default range and pitch', () => {
    const cam = chaseCamera({ lon: 137.4, lat: -4.7, headingDeg: 180 }, -4500);
    const target = cartesianToLonLat(cam.target)!;
    expect(target.heightM).toBeCloseTo(-4500, 3);
    expect(cam.offset.heading).toBeCloseTo(Math.PI, 12);
    expect(cam.offset.pitch).toBeCloseTo((-40 * Math.PI) / 180, 12);
    expect(cam.offset.range).toBe(220);
  });
});

describe('metresPerPixel', () => {
  it('measures 0.001 degrees of longitude at Gale in the local-metre frame', () => {
    const a = { lon: 137.4, lat: GALE_ORIGIN.lat_c };
    const b = { lon: 137.401, lat: GALE_ORIGIN.lat_c };
    const expected = (3396190 * Math.cos((GALE_ORIGIN.lat_c * Math.PI) / 180) * 0.001 * Math.PI) / 180 / 100;
    expect(metresPerPixel(a, b, 100, GALE_ORIGIN)).toBeCloseTo(expected, 9);
  });
});

describe('chooseHeightOffset', () => {
  it('keeps the spike values', () => {
    expect(SPIKE_HEIGHT_OFFSETS_M).toEqual({ gale: 73.76, jezero: -70.92 });
  });

  it('uses the measured value when it agrees with the spike value', () => {
    const warn = vi.fn();
    expect(chooseHeightOffset('gale', 74.9, warn)).toBe(74.9);
    expect(warn).not.toHaveBeenCalled();
  });

  it('uses the measured value but warns when it differs by more than 2 m', () => {
    const warn = vi.fn();
    expect(chooseHeightOffset('jezero', -67.5, warn)).toBe(-67.5);
    expect(warn).toHaveBeenCalledWith(
      'Height offset at jezero measured -67.50 m, spike value -70.92 m (3.42 m apart)',
    );
  });

  it('falls back to the spike value when nothing was measured', () => {
    const warn = vi.fn();
    expect(chooseHeightOffset('gale', undefined, warn)).toBe(73.76);
    expect(warn).toHaveBeenCalledWith('Height offset at gale not measured, using spike value 73.76 m');
  });

  it('returns 0 with a warning for an unknown site without a measurement', () => {
    const warn = vi.fn();
    expect(chooseHeightOffset('olympus', undefined, warn)).toBe(0);
    expect(warn).toHaveBeenCalledWith('Height offset at olympus not measured and no spike value; using 0 m');
  });

  it('accepts a measurement for an unknown site without warning', () => {
    const warn = vi.fn();
    expect(chooseHeightOffset('olympus', 5, warn)).toBe(5);
    expect(warn).not.toHaveBeenCalled();
  });
});
