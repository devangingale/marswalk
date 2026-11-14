// Written with AI assistance, directed and reviewed by the team.
import { describe, it, expect } from 'vitest';
import { MARS_R } from '../lib/grid';
import { NBSP } from './format';
import { distanceBearing } from './navigate';
import { circleRing, crewLabel, roverLabel, applyCrewSpread } from './crewMarkers';

const M_PER_DEG = (MARS_R * Math.PI) / 180;

describe('circleRing', () => {
  const centre = { lon: 137.4, lat: -4.7 };

  it('is a closed ring of segments + 1 points, starting due north', () => {
    const ring = circleRing(centre, 40, 8);
    expect(ring).toHaveLength(9);
    expect(ring[8]).toEqual(ring[0]);
    const first = distanceBearing(centre, ring[0]);
    expect(first.distanceM).toBeCloseTo(40, 3);
    expect(first.bearingDeg).toBeCloseTo(0, 3);
    expect(distanceBearing(centre, ring[2]).bearingDeg).toBeCloseTo(90, 3);
  });

  it('keeps every point at the radius', () => {
    for (const p of circleRing(centre, 62, 48)) {
      expect(distanceBearing(centre, p).distanceM).toBeCloseTo(62, 2);
    }
  });
});

describe('crewLabel', () => {
  it('shows the id and the uncertainty in whole metres', () => {
    expect(crewLabel({ id: 'EV1', uncertaintyM: 12.4 })).toBe(`EV1 ±${NBSP}12${NBSP}m`);
    expect(crewLabel({ id: 'EV2', uncertaintyM: 2 })).toBe(`EV2 ±${NBSP}2${NBSP}m`);
  });
});

describe('roverLabel', () => {
  it('shows the drive time to the crew before a call', () => {
    expect(roverLabel(18 * 60 + 10, null)).toBe(`Rover · 18${NBSP}min to crew`);
  });
  it('shows the arrival clock once called', () => {
    expect(roverLabel(600, '18:22')).toBe('Rover · arrives 18:22');
  });
  it('shows the rover alone without an estimate', () => {
    expect(roverLabel(null, null)).toBe('Rover');
  });
});

describe('applyCrewSpread', () => {
  const crew = [
    { id: 'EV1', lon: 0, lat: 0, uncertaintyM: 10 },
    { id: 'EV2', lon: 0, lat: -3 / M_PER_DEG, uncertaintyM: 10 },
  ];

  it('moves the second crew member east of the lead by the spread', () => {
    const out = applyCrewSpread(crew, 80);
    expect(out[0]).toEqual(crew[0]);
    const r = distanceBearing(out[0], out[1]);
    expect(r.distanceM).toBeCloseTo(80, 3);
    expect(r.bearingDeg).toBeCloseTo(90, 3);
  });

  it('leaves the crew alone without a spread', () => {
    expect(applyCrewSpread(crew, null)).toBe(crew);
  });
});
