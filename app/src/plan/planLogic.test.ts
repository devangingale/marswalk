import { describe, expect, it } from 'vitest';
import { createGrid, type GridHeader } from '../lib/grid';
import type { PlanParams, PlanStop } from '../lib/plan';
import { budgetFractions, isLatestPlanRequest, nextStopName, reorderStop, removeStop, sampleProfile, updateStop } from './planLogic';

const stops: PlanStop[] = [
  { id: 'a', name: 'Stop 1', lon: 0, lat: 0 },
  { id: 'b', name: 'Ridge', lon: 0, lat: 0 },
  { id: 'c', name: 'Stop 3', lon: 0, lat: 0 },
];
const params: PlanParams = { crew: 2, time_limit_s: 10_000, suit_mass_kg: 120, body_mass_kg: 80, stop_time_s: 1200, solar_event: false };

describe('plan list and profile logic', () => {
  it('accepts only the newest route request result', () => {
    expect([isLatestPlanRequest(1, 2), isLatestPlanRequest(2, 2)]).toEqual([false, true]);
  });
  it('names the first unused sequential stop', () => expect(nextStopName(stops)).toBe('Stop 2'));
  it('reorders, edits, and removes stops without mutating the source list', () => {
    expect(reorderStop(stops, 2, 0).map((stop) => stop.id)).toEqual(['c', 'a', 'b']);
    expect(updateStop(stops, 'b', { name: 'Ridge west' })[1].name).toBe('Ridge west');
    expect(removeStop(stops, 'a').map((stop) => stop.id)).toEqual(['b', 'c']);
    expect(stops.map((stop) => stop.id)).toEqual(['a', 'b', 'c']);
  });
  it('calculates budget fractions exactly', () => {
    expect(budgetFractions({ distance_m: 0, time_s: 2500, climb_m: 0, descent_m: 0, energy_kj: 750, dose_mgy: 0 }, { ...params, energy_limit_kj: 1000 })).toEqual({ time: 0.25, energy: 0.75 });
  });
  it('samples elevation by local-metre distance and retains the endpoint', () => {
    const header: GridHeader = { width: 3, height: 1, cell_x_m: 2, cell_y_m: 2, elev: { file: 'e', dtype: 'uint16', scale_m: 1, offset_m: 0, nodata: 65535 }, cost: { file: 'c', dtype: 'uint8', impassable: 255 } };
    const grid = createGrid(header, new Uint16Array([10, 20, 30]), new Uint8Array([0, 0, 0]), { lon0: 0, lat0: 0, lat_c: 0 });
    const line: [number, number][] = [[...Object.values(grid.rowColToLonLat(0, 0))] as [number, number], [...Object.values(grid.rowColToLonLat(0, 2))] as [number, number]];
    const profile = sampleProfile(grid, line, 2);
    expect(profile.map((sample) => [sample.distanceM, sample.elevationM])).toEqual([[0, 10], [4, 30]]);
  });
});
