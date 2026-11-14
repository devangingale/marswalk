// Written with AI assistance, directed and reviewed by the team.
import { describe, expect, it, vi } from 'vitest';
import { EntityCollection, type Entity } from 'cesium';
import samplePlanJson from '../fixtures/plan.sample.json';
import { createGrid, localMetresToLonLat, type GridHeader } from '../lib/grid';
import type { Plan } from '../lib/plan';
import { buildCornerPlan } from './cornerPlan';
import type { MarkerImages } from './markerImages';
import { GlobeOverlays, dropBubbles, mergeForks, photoSites, surfaceHeightM } from './overlays';

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

describe('surfaceHeightM', () => {
  it('adds the Cesium-to-bundle offset to exact grid elevation', () => {
    const header: GridHeader = {
      width: 2, height: 2, cell_x_m: 1, cell_y_m: 1,
      elev: { file: 'elev.bin', dtype: 'uint16', scale_m: 1, offset_m: 0, nodata: 65535 },
      cost: { file: 'cost.bin', dtype: 'uint8', impassable: 255 },
    };
    const grid = createGrid(header, new Uint16Array([30, 30, 30, 30]), new Uint8Array(4), ORIGIN);
    const point = grid.localMetresToLonLat(0, 0);
    expect(surfaceHeightM(grid, point.lon, point.lat, 72.5)).toBe(102.5);
  });
});

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

  it('keeps the planned route above rover photo markers', () => {
    const { host, overlays } = setup();
    overlays.setPlan(samplePlan, ORIGIN);
    overlays.setRover(null, [{ lon: 137.1, lat: -4.6, count: 1, solMin: 3543, solMax: 3543 }], {
      traverse: false,
      photos: true,
    });
    const photoIndex = host.entities.values.findIndex((entity) => overlays.hoverLabel(pick(entity))?.startsWith('1 photo'));
    const photo = host.entities.values[photoIndex];
    const routeIndex = host.entities.values.findIndex((entity) => Boolean(entity.polyline));
    expect(photoIndex).toBeGreaterThanOrEqual(0);
    expect(photo.billboard?.scale?.getValue(undefined as never)).toBe(1.5);
    expect(routeIndex).toBeGreaterThan(photoIndex);
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

  it('keeps dense route vertices when drawing shared ground', () => {
    const line = Array.from({ length: 101 }, (_, i) => {
      const point = localMetresToLonLat(1000, 1000 + i * 2, ORIGIN);
      return [point.lon, point.lat] as [number, number];
    });
    const plan: Plan = {
      ...samplePlan,
      start: { ...samplePlan.start, lon: line[0][0], lat: line[0][1] },
      stops: [{ id: 's1', name: 'Stop 1', lon: line.at(-1)![0], lat: line.at(-1)![1], dwell_s: 1200 }],
      route: {
        ...samplePlan.route,
        legs: [
          { ...samplePlan.route.legs[0], from: 'start', to: 'Stop 1', line, distance_m: 200 },
          { ...samplePlan.route.legs[0], from: 'Stop 1', to: 'start', line: [...line].reverse(), distance_m: 200 },
        ],
      },
    };
    const { host, overlays } = setup();
    overlays.setPlan(plan, ORIGIN);
    const casing = host.entities.values.find((entity) => entity.polyline?.width?.getValue(undefined as never) === 10);
    expect(casing?.polyline?.positions?.getValue(undefined as never)).toHaveLength(101);
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

describe('dropBubbles', () => {
  const branches = (...labels: string[]) => labels.map((toLabel, legIndex) => ({ legIndex, toLabel }));
  // 40 m apart along a line north of the origin, then one 200 m further.
  const north = (m: number) => ORIGIN.lat0 + (m / 3396190) * (180 / Math.PI);

  it('drops a split and merge with the same branches a few tens of metres apart', () => {
    const forks = [
      { lon: ORIGIN.lon0, lat: north(0), branches: branches('s1', 'drop-off') },
      { lon: ORIGIN.lon0, lat: north(40), branches: branches('drop-off', 's1') },
      { lon: ORIGIN.lon0, lat: north(240), branches: branches('s1', 'drop-off') },
    ];
    expect(dropBubbles(forks, ORIGIN).map((f) => Math.round((f.lat - ORIGIN.lat0) * 59274.7))).toEqual([240]);
  });

  it('keeps nearby forks that lead to different places', () => {
    const forks = [
      { lon: ORIGIN.lon0, lat: north(0), branches: branches('c1', 'drop-off') },
      { lon: ORIGIN.lon0, lat: north(40), branches: branches('c2', 'c3') },
    ];
    expect(dropBubbles(forks, ORIGIN).length).toBe(2);
  });
});
