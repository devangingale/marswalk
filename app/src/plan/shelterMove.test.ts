import { describe, expect, it } from 'vitest';
import { createGrid, type GridHeader } from '../lib/grid';
import { findWalkableCentre, makeInitialPlan, mapClickAction, SHELTER_MOVE_IDLE, shelterMoveReducer, snapNotice } from './planLogic';

describe('Move shelter', () => {
  it('toggles on and off from the button', () => {
    const on = shelterMoveReducer(SHELTER_MOVE_IDLE, { type: 'toggle' });
    expect(on.active).toBe(true);
    expect(mapClickAction(on)).toBe('place-shelter');
    expect(shelterMoveReducer(on, { type: 'toggle' }).active).toBe(false);
  });

  it('a map click adds a stop unless move mode is on', () => {
    expect(mapClickAction(SHELTER_MOVE_IDLE)).toBe('add-stop');
  });

  it('Esc cancels, and cancelling when idle changes nothing', () => {
    const on = shelterMoveReducer(SHELTER_MOVE_IDLE, { type: 'toggle' });
    expect(shelterMoveReducer(on, { type: 'cancel' })).toEqual(SHELTER_MOVE_IDLE);
    expect(shelterMoveReducer(SHELTER_MOVE_IDLE, { type: 'cancel' })).toBe(SHELTER_MOVE_IDLE);
  });

  it('placing ends move mode and keeps the snap notice', () => {
    const on = shelterMoveReducer(SHELTER_MOVE_IDLE, { type: 'toggle' });
    const placed = shelterMoveReducer(on, { type: 'placed', movedM: 12.4 });
    expect(placed).toEqual({ active: false, notice: 'Moved 12 m to walkable ground' });
    expect(shelterMoveReducer(placed, { type: 'placed', movedM: 0 })).toEqual(SHELTER_MOVE_IDLE);
    expect(snapNotice(0)).toBeNull();
  });
});

describe('new plan shelter', () => {
  it('starts as Shelter · Habitat at walkable ground', () => {
    const width = 5;
    const height = 5;
    const header: GridHeader = { width, height, cell_x_m: 10, cell_y_m: 10, elev: { file: 'e', dtype: 'uint16', scale_m: 1, offset_m: 0, nodata: 65535 }, cost: { file: 'c', dtype: 'uint8', impassable: 255 } };
    const grid = createGrid(header, new Uint16Array(width * height), new Uint8Array(width * height), { lon0: 0, lat0: 0, lat_c: 0 });
    const start = findWalkableCentre(grid);
    expect(start.kind).toBe('habitat');
    expect(start.label).toBe('Shelter · Habitat');
    const plan = makeInitialPlan('gale', { lon: 0, lat: 0, label: 'Rover drop-off' });
    expect(plan.start).toMatchObject({ kind: 'rover', label: 'Shelter · Pressurised rover' });
    expect(plan.route.returns_to_start).toBe(true);
  });
});
