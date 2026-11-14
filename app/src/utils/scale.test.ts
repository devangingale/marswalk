// Written with AI assistance, directed and reviewed by the team.

import { describe, it, expect } from 'vitest';
import { calculateMarsDistanceMeters, calculateMarsScaleBar } from './scale';
import { MARS_RADIUS_METERS } from '../config';

describe('Mars scale calculation (Contracts Section 3)', () => {
  it('uses Mars sphere radius R = 3396190 m', () => {
    expect(MARS_RADIUS_METERS).toBe(3396190);
  });

  it('calculates true ground distance along the equator', () => {
    // 1 degree longitude at latitude 0
    const dist1Deg = calculateMarsDistanceMeters(0, 0, 1, 0);
    const expected = (3396190 * Math.PI) / 180;
    expect(dist1Deg).toBeCloseTo(expected, 4);
    expect(dist1Deg).toBeCloseTo(59274.7, 1);
  });

  it('calculates true ground distance at Gale crater latitude (-4.79 deg)', () => {
    const lat = -4.7913;
    // 0.01 degrees of longitude
    const dist = calculateMarsDistanceMeters(137.36, lat, 137.37, lat);
    const expected = 3396190 * Math.cos((lat * Math.PI) / 180) * (0.01 * (Math.PI / 180));
    expect(dist).toBeCloseTo(expected, 1);
    expect(dist).toBeCloseTo(590.68, 1);
  });

  it('demonstrates Earth Web Mercator vs Mars true ground difference (~1.88x)', () => {
    const marsDist = calculateMarsDistanceMeters(0, 0, 1, 0);
    const earthEquator1Deg = (6378137 * Math.PI) / 180; // WGS84 authalic / semi-major
    const ratio = earthEquator1Deg / marsDist;
    expect(ratio).toBeGreaterThan(1.87);
    expect(ratio).toBeLessThan(1.89);
  });

  it('generates a clean readable scale bar in Mars metres', () => {
    // Suppose 100 screen pixels correspond to 0.002 degrees at Gale crater
    const lon1 = 137.39;
    const lon2 = 137.392;
    const lat = -4.78;
    const screenPx = 100;

    const result = calculateMarsScaleBar(lon1, lon2, lat, screenPx, 120);
    expect(result.pixelWidth).toBeGreaterThanOrEqual(50);
    expect(result.pixelWidth).toBeLessThanOrEqual(220);
    expect(['50 m', '100 m', '200 m', '500 m', '1 km']).toContain(result.label);
    expect(result.metersPerPixel).toBeGreaterThan(0);
  });

  it('formats km correctly for large spans', () => {
    // Large span: 0.1 degrees
    const lon1 = 137.0;
    const lon2 = 137.1;
    const lat = -4.8;
    const screenPx = 100;

    const result = calculateMarsScaleBar(lon1, lon2, lat, screenPx, 120);
    expect(result.label).toContain('km');
    expect(result.distanceMeters).toBeGreaterThanOrEqual(1000);
  });
});
