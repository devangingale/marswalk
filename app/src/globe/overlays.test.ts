// Written with AI assistance, directed and reviewed by the team.
import { describe, expect, it, vi } from 'vitest';
import { EntityCollection, type Entity } from 'cesium';
import samplePlanJson from '../fixtures/plan.sample.json';
import type { Plan } from '../lib/plan';
import { buildCornerPlan } from './cornerPlan';
import type { MarkerImages } from './markerImages';
import { GlobeOverlays, mergeForks, photoSites } from './overlays';

const samplePlan = samplePlanJson as unknown as Plan;
const ORIGIN = { lon0: 137.36045619776752, lat0: -4.765947140908848, lat_c: -4.761729489694319 };

const token = (name: string) => {
  if (name === '--map-route-casing-width') return '8px';
  if (name.endsWith('-width')) return '4px';
  if (name.endsWith('-opacity')) return '0.35';
  if (name === '--font-data') return 'sans-serif';
  return '#8ec1f5';
};
const image = { image: 'data:,', width: 1, height: 1 };
const images: MarkerImages = {
  stop: () => image,
  dropOff: () => image,
  finish: () => image,
  fork: () => image,
  chevron: () => image,
  cave: () => image,
  high: () => image,
  low: () => image,
  steepest: () => image,
  photo: () => image,
  walker: () => image,
};

function setup(onSectionHover?: (id: string | null) => void) {
  const host = { entities: new EntityCollection() };
  return { host, overlays: new GlobeOverlays(host, { token, images, onSectionHover }) };
}

const pick = (entity: Entity | undefined) => ({ id: entity });

describe('photoSites', () => {
  it('groups photos by position with counts and sol ranges', () => {
    const sites = photoSites([
      { lon: 137.1, lat: -4.6, sol: 3550 },
      { lon: 137.1, lat: -4.6, sol: 3543 },
      { lon: 137.1, lat: -4.6, sol: 3560 },
      { lon: 137.2, lat: -4.7, sol: 12 },
    ]);
    expect(sites).toEqual([
      { lon: 137.1, lat: -4.6, count: 3, solMin: 3543, solMax: 3560 },
      { lon: 137.2, lat: -4.7, count: 1, solMin: 12, solMax: 12 },
    ]);
  });
});

describe('GlobeOverlays', () => {
  it('labels a photo site with its count and sols', () => {
    const { host, overlays } = setup();
    overlays.setRover(null, [{ lon: 137.1, lat: -4.6, count: 24, solMin: 3543, solMax: 3560 }], {
      traverse: true,
      photos: true,
    });
    expect(overlays.hoverLabel(pick(host.entities.values[0]))).toBe('24 photos · sol 3543–3560');
  });

  it('removes every entity it added on clear', () => {
    const { host, overlays } = setup();
    overlays.setPlan(samplePlan);
    overlays.setWalker({ lon: 137.36, lat: -4.76, headingDeg: 0 });
    expect(host.entities.values.length).toBeGreaterThan(0);
    overlays.clear();
    expect(host.entities.values.length).toBe(0);
  });

  it('draws shared ground once: one casing line per stretch', () => {
    const { host, overlays } = setup();
    overlays.setPlan(buildCornerPlan(ORIGIN), ORIGIN);
    const casings = host.entities.values.filter((e) => e.polyline?.width?.getValue(undefined as never) === 10);
    expect(casings.length).toBe(6);
  });

  it('shows lat and lon in stop and drop-off hover labels', () => {
    const { host, overlays } = setup();
    const plan = buildCornerPlan(ORIGIN);
    overlays.setPlan(plan, ORIGIN);
    const labels = host.entities.values.map((e) => overlays.hoverLabel(pick(e))).filter(Boolean);
    expect(labels).toContain('Rover drop-off\n4.7617° S, 137.3647° E');
    expect(labels).toContain('Stop 2 · East spur\n4.7631° S, 137.3684° E');
    expect(labels).toContain('Fork\nto Stop 2\nto Stop 3');
    expect(labels).toContain('Fork\nto Stop 1\nback to drop-off');
  });

  it('highlights the whole route when it is small on screen', () => {
    const onSectionHover = vi.fn();
    const { host, overlays } = setup(onSectionHover);
    overlays.setPlan(buildCornerPlan(ORIGIN), ORIGIN);
    const route = host.entities.values.find((e) => e.polyline)!;
    expect(overlays.hover(pick(route), 300)).toEqual(['Drop-off → 1 → 2 → 3 → Drop-off · 1.7 km · 1 h 03 min']);
    expect(onSectionHover).not.toHaveBeenCalled();
  });

  it('highlights the section under the cursor when the route is large, and reports it', () => {
    const onSectionHover = vi.fn();
    const { host, overlays } = setup(onSectionHover);
    overlays.setPlan(buildCornerPlan(ORIGIN), ORIGIN);
    // The spur (legs 1 and 2) is the fourth stretch.
    const spur = host.entities.values.filter((e) => e.polyline)[3 * 3];
    expect(overlays.hover(pick(spur), 900)).toEqual(['1 → 3 via 2 · 922 m · 34 min']);
    expect(onSectionHover).toHaveBeenLastCalledWith('section-1');
    expect(overlays.hover(undefined, 900)).toEqual([]);
    expect(onSectionHover).toHaveBeenLastCalledWith(null);
  });

  it('shows slope markers only with an elevation grid covering the route', () => {
    const { host, overlays } = setup();
    overlays.setGradient(true);
    overlays.setPlan(samplePlan);
    expect(overlays.slopesAvailable).toBe(false);
    const labels = host.entities.values.map((e) => overlays.hoverLabel(pick(e)) ?? '');
    expect(labels.some((l) => l.startsWith('High'))).toBe(false);
  });
});

describe('mergeForks', () => {
  it('joins forks a few metres apart and keeps each branch once', () => {
    const forks = mergeForks(
      [
        { lon: 137.3665507, lat: -4.7588615, branches: [{ legIndex: 1, toLabel: 'c2' }, { legIndex: 2, toLabel: 'c3' }] },
        {
          lon: 137.36656993,
          lat: -4.75892016,
          branches: [
            { legIndex: 1, toLabel: 'c2' },
            { legIndex: 2, toLabel: 'c3' },
            { legIndex: 2, toLabel: 'c3' },
          ],
        },
        { lon: 137.3646885, lat: -4.7603798, branches: [{ legIndex: 0, toLabel: 'c1' }, { legIndex: 3, toLabel: 'drop-off' }] },
      ],
      ORIGIN,
    );
    expect(forks.map((f) => f.branches.map((b) => b.toLabel))).toEqual([
      ['c2', 'c3'],
      ['c1', 'drop-off'],
    ]);
  });
});
