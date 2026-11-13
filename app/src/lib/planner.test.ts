// Written with AI assistance, directed and reviewed by the team.

import { describe, it, expect } from 'vitest';
import { createGrid, GridHeader, GridOrigin } from './grid';
import { findPath } from './planner';

describe('A* route planner on synthetic grids (Contracts Section 3, 6, 7)', () => {
  const origin: GridOrigin = { lon0: 137.0, lat0: -4.0, lat_c: -4.0 };

  it('navigates around an impassable wall (cost = 255)', () => {
    const width = 50;
    const height = 50;
    const elevData = new Uint16Array(width * height);
    const costData = new Uint8Array(width * height);

    // Wall at col = 25 from row = 10 to row = 40
    for (let r = 10; r <= 40; r++) {
      costData[r * width + 25] = 255;
    }

    const header: GridHeader = {
      width,
      height,
      cell_x_m: 2.0,
      cell_y_m: 2.0,
      elev: { file: 'elev.bin', dtype: 'uint16', scale_m: 1.0, offset_m: 0.0, nodata: 65535 },
      cost: { file: 'cost.bin', dtype: 'uint8', impassable: 255, multiplier: '1 + value / 50' },
      origin,
    };

    const grid = createGrid(header, elevData, costData);

    const start = { row: 25, col: 5 };
    const goal = { row: 25, col: 45 };

    const result = findPath(grid, start, goal);

    expect(result.feasible).toBe(true);
    expect(result.cells.length).toBeGreaterThan(0);

    // Ensure none of the cells entered are 255
    for (const cell of result.cells) {
      expect(grid.isPassable(cell.row, cell.col)).toBe(true);
      expect(grid.getCost(cell.row, cell.col)).toBeLessThan(255);
    }

    // Direct path would cross col 25 between row 10 and 40.
    // The planner must navigate around the wall (either row < 10 or row > 40 when col == 25)
    const wallColCrossing = result.cells.filter((c) => c.col === 25);
    expect(wallColCrossing.length).toBeGreaterThan(0);
    for (const cross of wallColCrossing) {
      const isAroundWall = cross.row < 10 || cross.row > 40;
      expect(isAroundWall).toBe(true);
    }

    // Path distance must be longer than straight line distance (40 cells * 2m = 80m)
    expect(result.distance_m).toBeGreaterThan(80.0);
  });

  it('differentiates uphill vs downhill cost on a ramp', () => {
    const width = 30;
    const height = 30;
    const elevData = new Uint16Array(width * height);
    const costData = new Uint8Array(width * height);

    // Ramp: elevation rises linearly from West (col 0) to East (col 29)
    // 0.3 m per 2m cell = 15% grade (~8.5 deg slope)
    for (let r = 0; r < height; r++) {
      for (let c = 0; c < width; c++) {
        // raw value with offset = 0, scale = 0.1 m
        // elevation = c * 0.3 m -> raw = c * 3
        elevData[r * width + c] = c * 3;
      }
    }

    const header: GridHeader = {
      width,
      height,
      cell_x_m: 2.0,
      cell_y_m: 2.0,
      elev: { file: 'elev.bin', dtype: 'uint16', scale_m: 0.1, offset_m: 0.0, nodata: 65535 },
      cost: { file: 'cost.bin', dtype: 'uint8', impassable: 255, multiplier: '1 + value / 50' },
      origin,
    };

    const grid = createGrid(header, elevData, costData);

    const westPoint = { row: 15, col: 2 };
    const eastPoint = { row: 15, col: 26 };

    // Uphill: West to East
    const uphillResult = findPath(grid, westPoint, eastPoint);
    // Downhill: East to West
    const downhillResult = findPath(grid, eastPoint, westPoint);

    expect(uphillResult.feasible).toBe(true);
    expect(downhillResult.feasible).toBe(true);

    // Elevations: east is higher than west
    expect(uphillResult.climb_m).toBeGreaterThan(0);
    expect(uphillResult.descent_m).toBeCloseTo(0, 2);

    expect(downhillResult.climb_m).toBeCloseTo(0, 2);
    expect(downhillResult.descent_m).toBeGreaterThan(0);

    // Uphill energy cost must be significantly greater than downhill energy cost
    expect(uphillResult.energy_kj).toBeGreaterThan(downhillResult.energy_kj * 1.2);

    // Uphill walking time is >= downhill walking time
    expect(uphillResult.time_s).toBeGreaterThanOrEqual(downhillResult.time_s * 0.8);
  });

  it('fails cleanly with feasible: false and no line for an unreachable stop', () => {
    const width = 30;
    const height = 30;
    const elevData = new Uint16Array(width * height);
    const costData = new Uint8Array(width * height);

    // Enclose goal (row 15, col 25) in a complete impassable box (col 23..27, row 13..17)
    for (let r = 13; r <= 17; r++) {
      costData[r * width + 23] = 255;
      costData[r * width + 27] = 255;
    }
    for (let c = 23; c <= 27; c++) {
      costData[13 * width + c] = 255;
      costData[17 * width + c] = 255;
    }

    const header: GridHeader = {
      width,
      height,
      cell_x_m: 2.0,
      cell_y_m: 2.0,
      elev: { file: 'elev.bin', dtype: 'uint16', scale_m: 1.0, offset_m: 0.0, nodata: 65535 },
      cost: { file: 'cost.bin', dtype: 'uint8', impassable: 255, multiplier: '1 + value / 50' },
      origin,
    };

    const grid = createGrid(header, elevData, costData);

    const start = { row: 15, col: 5 };
    const goal = { row: 15, col: 25 };

    const result = findPath(grid, start, goal);

    expect(result.feasible).toBe(false);
    expect(result.warning).toBe('No passable route found to destination.');
    expect(result.cells.length).toBe(0);
    expect(result.steps.length).toBe(0);
  });

  it('fails immediately when start or goal itself is on impassable ground', () => {
    const width = 10;
    const height = 10;
    const elevData = new Uint16Array(width * height);
    const costData = new Uint8Array(width * height);
    costData[5 * width + 5] = 255; // impassable

    const header: GridHeader = {
      width,
      height,
      cell_x_m: 2.0,
      cell_y_m: 2.0,
      elev: { file: 'elev.bin', dtype: 'uint16', scale_m: 1.0, offset_m: 0.0, nodata: 65535 },
      cost: { file: 'cost.bin', dtype: 'uint8', impassable: 255, multiplier: '1 + value / 50' },
      origin,
    };

    const grid = createGrid(header, elevData, costData);

    const result = findPath(grid, { row: 0, col: 0 }, { row: 5, col: 5 });
    expect(result.feasible).toBe(false);
    expect(result.warning).toBe('Destination is on impassable terrain.');
  });
});
