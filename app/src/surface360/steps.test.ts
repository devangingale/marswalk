// Written with AI assistance, directed and reviewed by the team.
import { describe, expect, it } from 'vitest';
import { SAMPLE_MANIFEST, distanceM, stopById, stopLonLat } from './panoramas';
import { legBetween, legLabel, stepsFor, surfaceDistanceM } from './steps';

describe('EVA steps', () => {
  const a = stopById(SAMPLE_MANIFEST, 'sol_4')!;
  const b = stopById(SAMPLE_MANIFEST, 'sol_122')!;

  it('measures the geodesic on the Mars ellipsoid, close to the spherical estimate', () => {
    const geodesic = surfaceDistanceM(a, b);
    expect(geodesic).toBeGreaterThan(250);
    expect(geodesic).toBeLessThan(400);
    expect(Math.abs(geodesic - distanceM(stopLonLat(a), stopLonLat(b))) / geodesic).toBeLessThan(0.01);
  });

  it('counts 0.75 m strides', () => {
    expect(stepsFor(142)).toBe(189);
    expect(stepsFor(0)).toBe(0);
    expect(legLabel(142)).toBe('142 m (~189 steps)');
    expect(legLabel(1900)).toBe('1.9 km (~2,533 steps)');
  });

  it('is zero between stops at the same point', () => {
    expect(legBetween(a, { ...a, id: 'twin' })).toBe(0);
  });
});
