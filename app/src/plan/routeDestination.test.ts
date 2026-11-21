import { describe, expect, it } from 'vitest';
import { createGrid, type GridHeader } from '../lib/grid';
import { buildPlan, isStopUnreachable, validatePlan, type PlanParams, type PlanStart, type PlanStop } from '../lib/plan';
import { reachableMask, snapToReachable } from '../lib/snap';
import { isLatestPlanRequest, reorderStop } from './planLogic';
import { buildTrack } from '../walk/track';
import { GlobeOverlays } from '../globe/overlays';
import { EntityCollection } from 'cesium';

describe('route destination and marker alignment', () => {
  const origin = { lon0: 137.4, lat0: -4.8, lat_c: -4.8 };
  const header: GridHeader = {
    width: 20,
    height: 20,
    cell_x_m: 4,
    cell_y_m: 4,
    elev: { file: 'e', dtype: 'uint16', scale_m: 1, offset_m: 0, nodata: 65535 },
    cost: { file: 'c', dtype: 'uint8', impassable: 255 },
    origin,
  };
  const elevData = new Uint16Array(header.width * header.height).fill(100);
  const costData = new Uint8Array(header.width * header.height).fill(0);

  // Set an impassable band between column 10 and 11 except at row 10
  for (let r = 0; r < 20; r++) {
    if (r !== 10) {
      costData[r * 20 + 10] = 255;
    }
  }

  const grid = createGrid(header, elevData, costData, origin);
  const params: PlanParams = {
    crew: 2,
    time_limit_s: 28800,
    suit_mass_kg: 120,
    body_mass_kg: 80,
    stop_time_s: 1200,
    solar_event: false,
  };

  const startCoords = grid.rowColToLonLat(5, 5);
  const start: PlanStart = { ...startCoords, kind: 'habitat', label: 'Shelter · Habitat' };

  it('distinguishes click coordinate, terrain snapping (e.g. Gale 22m), and marker coordinate', () => {
    const mask = reachableMask(grid, start);

    // Click on impassable cell (row 5, col 10)
    const rawClick = grid.rowColToLonLat(5, 10);
    const snap = snapToReachable(grid, mask, rawClick, 100);

    expect(snap).not.toBeNull();
    expect(snap!.movedM).toBeGreaterThan(0);

    // The snapped coordinate becomes the stop location
    const stop: PlanStop = {
      id: 's-1',
      name: 'Stop 1',
      lon: snap!.lon,
      lat: snap!.lat,
      dwell_s: 1200,
    };

    const plan = buildPlan({ grid, params, start, stops: [stop] });

    expect(plan.route.feasible).toBe(true);
    expect(plan.route.legs.length).toBe(2);

    // Leg 0 goes from start to the snapped stop (coordinates rounded to 7 decimal places in densified line)
    const leg0 = plan.route.legs[0];
    expect(leg0.from).toBe('start');
    expect(leg0.to).toBe('s-1');
    expect(leg0.line[0][0]).toBeCloseTo(start.lon, 6);
    expect(leg0.line[0][1]).toBeCloseTo(start.lat, 6);
    expect(leg0.line[leg0.line.length - 1][0]).toBeCloseTo(stop.lon, 6);
    expect(leg0.line[leg0.line.length - 1][1]).toBeCloseTo(stop.lat, 6);

    // Leg 1 is the expected shelter return leg
    const leg1 = plan.route.legs[1];
    expect(leg1.from).toBe('s-1');
    expect(leg1.to).toBe('start');
    expect(leg1.line[0][0]).toBeCloseTo(stop.lon, 6);
    expect(leg1.line[0][1]).toBeCloseTo(stop.lat, 6);
    expect(leg1.line[leg1.line.length - 1][0]).toBeCloseTo(start.lon, 6);
    expect(leg1.line[leg1.line.length - 1][1]).toBeCloseTo(start.lat, 6);
  });

  it('aligns polyline vertices with displayed stops across multiple ordered visits and reorders', () => {
    const pt1 = grid.rowColToLonLat(4, 5);
    const pt2 = grid.rowColToLonLat(10, 15);
    const pt3 = grid.rowColToLonLat(15, 5);

    const stops: PlanStop[] = [
      { id: 's-1', name: 'Stop 1', lon: pt1.lon, lat: pt1.lat, dwell_s: 1200 },
      { id: 's-2', name: 'Stop 2', lon: pt2.lon, lat: pt2.lat, dwell_s: 1200 },
      { id: 's-3', name: 'Stop 3', lon: pt3.lon, lat: pt3.lat, dwell_s: 1200 },
    ];

    const plan = buildPlan({ grid, params, start, stops });
    expect(plan.route.feasible).toBe(true);
    expect(plan.route.legs.length).toBe(4); // Start -> 1 -> 2 -> 3 -> Start

    // Verify chained alignment
    expect(plan.route.legs[0].to).toBe('s-1');
    expect(plan.route.legs[1].to).toBe('s-2');
    expect(plan.route.legs[2].to).toBe('s-3');
    expect(plan.route.legs[3].to).toBe('start');

    // Reorder: move s-2 to the front
    const reorderedStops = reorderStop(stops, 1, 0);
    expect(reorderedStops.map((s) => s.id)).toEqual(['s-2', 's-1', 's-3']);

    const reorderedPlan = buildPlan({ grid, params, start, stops: reorderedStops });
    expect(reorderedPlan.route.legs[0].to).toBe('s-2');
    expect(reorderedPlan.route.legs[1].to).toBe('s-1');
    expect(reorderedPlan.route.legs[2].to).toBe('s-3');
    expect(reorderedPlan.route.legs[3].to).toBe('start');
  });

  it('preserves start and stop endpoints even when both reside in the same grid cell', () => {
    // Two distinct points in the same grid cell (row 5, col 5)
    const cellCentre = grid.rowColToLocalMetres(5, 5);
    const p1 = grid.localMetresToLonLat(cellCentre.x_m - 1, cellCentre.y_m - 1);
    const p2 = grid.localMetresToLonLat(cellCentre.x_m + 1, cellCentre.y_m + 1);

    const intraStart: PlanStart = { lon: p1.lon, lat: p1.lat, kind: 'habitat', label: 'Shelter' };
    const intraStop: PlanStop = { id: 's-intra', name: 'Stop Intra', lon: p2.lon, lat: p2.lat };

    const plan = buildPlan({ grid, params, start: intraStart, stops: [intraStop] });
    expect(plan.route.legs.length).toBe(2);

    const outLeg = plan.route.legs[0];
    expect(outLeg.line.length).toBeGreaterThanOrEqual(2);
    expect(outLeg.line[0][0]).toBeCloseTo(intraStart.lon, 6);
    expect(outLeg.line[0][1]).toBeCloseTo(intraStart.lat, 6);
    expect(outLeg.line[outLeg.line.length - 1][0]).toBeCloseTo(intraStop.lon, 6);
    expect(outLeg.line[outLeg.line.length - 1][1]).toBeCloseTo(intraStop.lat, 6);

    const returnLeg = plan.route.legs[1];
    expect(returnLeg.line.length).toBeGreaterThanOrEqual(2);
    expect(returnLeg.line[0][0]).toBeCloseTo(intraStop.lon, 6);
    expect(returnLeg.line[0][1]).toBeCloseTo(intraStop.lat, 6);
    expect(returnLeg.line[returnLeg.line.length - 1][0]).toBeCloseTo(intraStart.lon, 6);
    expect(returnLeg.line[returnLeg.line.length - 1][1]).toBeCloseTo(intraStart.lat, 6);
  });

  it('rejects stale route requests so newer plan edits are never overwritten', () => {
    expect(isLatestPlanRequest(1, 3)).toBe(false);
    expect(isLatestPlanRequest(2, 3)).toBe(false);
    expect(isLatestPlanRequest(3, 3)).toBe(true);
  });

  it('correctly hands over planned route and track to Walk and Visor replay', () => {
    const pt1 = grid.rowColToLonLat(15, 5); // 10 cells away = 40 metres away
    const stops: PlanStop[] = [{ id: 's-1', name: 'Stop 1', lon: pt1.lon, lat: pt1.lat, dwell_s: 600 }];
    const plan = buildPlan({ grid, params, start, stops });

    const track = buildTrack(plan, origin);
    expect(track.legs.length).toBe(2);
    expect(track.durationS).toBeGreaterThan(0);
    expect(track.vertices.length).toBeGreaterThanOrEqual(10);
  });

  it('identifies unreachable stops, skips them in path generation while maintaining circuit to shelter', () => {
    const reachablePt = grid.rowColToLonLat(6, 5);
    const unreachablePt = grid.rowColToLonLat(5, 10); // inside the impassable wall

    const stops: PlanStop[] = [
      { id: 's-good', name: 'Reachable Stop', lon: reachablePt.lon, lat: reachablePt.lat },
      { id: 's-bad', name: 'Wall Stop', lon: unreachablePt.lon, lat: unreachablePt.lat },
    ];

    const plan = buildPlan({ grid, params, start, stops });
    expect(plan.route.feasible).toBe(false);
    expect(plan.route.warnings).toContain("Can't reach Wall Stop. Move or remove it.");

    // The route visits the reachable stop and returns to shelter, skipping the wall stop
    expect(plan.route.legs.length).toBe(2);
    expect(plan.route.legs[0].to).toBe('s-good');
    expect(plan.route.legs[1].from).toBe('s-good');
    expect(plan.route.legs[1].to).toBe('start');
  });

  it('disambiguates unreachable status by stop ID, avoiding name substring bugs and identical name collisions', () => {
    const reachablePt1 = grid.rowColToLonLat(6, 5);
    const reachablePt2 = grid.rowColToLonLat(7, 5);
    const unreachablePt = grid.rowColToLonLat(5, 10);

    // Case A: Stop 1 vs Stop 10 substring collision test
    const stopsCaseA: PlanStop[] = [
      { id: 's-1', name: 'Stop 1', lon: reachablePt1.lon, lat: reachablePt1.lat },
      { id: 's-10', name: 'Stop 10', lon: unreachablePt.lon, lat: unreachablePt.lat },
    ];
    const planA = buildPlan({ grid, params, start, stops: stopsCaseA });

    expect(planA.route.warnings).toContain("Can't reach Stop 10. Move or remove it.");
    expect(isStopUnreachable('s-1', planA, false)).toBe(false);
    expect(isStopUnreachable('s-10', planA, false)).toBe(true);
    // While computing, unreachable classification is suppressed
    expect(isStopUnreachable('s-10', planA, true)).toBe(false);

    // Case B: Two stops with identical names
    const stopsCaseB: PlanStop[] = [
      { id: 's-dup1', name: 'Waypoint', lon: reachablePt2.lon, lat: reachablePt2.lat },
      { id: 's-dup2', name: 'Waypoint', lon: unreachablePt.lon, lat: unreachablePt.lat },
    ];
    const planB = buildPlan({ grid, params, start, stops: stopsCaseB });

    expect(isStopUnreachable('s-dup1', planB, false)).toBe(false);
    expect(isStopUnreachable('s-dup2', planB, false)).toBe(true);
  });

  it('draws requested click/drop point and connecting dashed tether when snapped (e.g. Gale 66m shift)', () => {
    const dummyImage = { image: 'data:,', width: 1, height: 1 };
    const dummyImages = {
      stop: () => dummyImage,
      dropOff: () => dummyImage,
      finish: () => dummyImage,
      fork: () => dummyImage,
      chevron: () => dummyImage,
      cave: () => dummyImage,
      high: () => dummyImage,
      low: () => dummyImage,
      steepest: () => dummyImage,
      photo: () => dummyImage,
      walker: () => dummyImage,
    };
    const testToken = (name: string) => {
      if (name === '--map-route-casing-width') return '8px';
      if (name.endsWith('-width')) return '4px';
      if (name.endsWith('-opacity')) return '0.35';
      if (name === '--font-data') return 'sans-serif';
      return '#8ec1f5';
    };
    const host = { entities: new EntityCollection() };
    const overlays = new GlobeOverlays(host, { token: testToken, images: dummyImages });

    const snappedPt = grid.rowColToLonLat(6, 5);
    const requestedPt = grid.rowColToLonLat(5, 10); // shifted by >20m

    const stop: PlanStop = { id: 's-snap', name: 'Gale Stop', lon: snappedPt.lon, lat: snappedPt.lat };
    const plan = buildPlan({ grid, params, start, stops: [stop] });

    // Set requested point for snapped stop
    overlays.setRequestedPoints({ 's-snap': { lon: requestedPt.lon, lat: requestedPt.lat } });
    overlays.setPlan(plan, origin);

    // Verify entities: should have stop billboard, requested point entity, and tether polyline
    const allEntities = host.entities.values;
    const requestedPointEntity = allEntities.find((e) => e.point !== undefined);
    expect(requestedPointEntity).toBeDefined();

    const tetherPolyline = allEntities.find((e) => {
      const positions = e.polyline?.positions?.getValue(undefined as never);
      return positions && positions.length === 2;
    });
    expect(tetherPolyline).toBeDefined();

    const labels = allEntities.map((e) => overlays.hoverLabel({ id: e })).filter(Boolean);
    expect(labels.some((l) => l?.includes('Stop 1 requested position'))).toBe(true);
    expect(labels.some((l) => l?.includes('Moved') && l?.includes('m to walkable ground'))).toBe(true);
  });

  it('preserves saved schema v1 exactly for plans containing unreachable stops', () => {
    const reachablePt = grid.rowColToLonLat(6, 5);
    const unreachablePt = grid.rowColToLonLat(5, 10);
    const stops: PlanStop[] = [
      { id: 's-1', name: 'Stop 1', lon: reachablePt.lon, lat: reachablePt.lat },
      { id: 's-2', name: 'Stop 2', lon: unreachablePt.lon, lat: unreachablePt.lat },
    ];
    const plan = buildPlan({ grid, params, start, stops });
    const validation = validatePlan(plan);
    expect(validation.valid).toBe(true);
    expect(validation.errors).toHaveLength(0);
  });
});
