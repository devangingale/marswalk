// Written with AI assistance, directed and reviewed by the team.

import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { createGrid, type GridHeader, type GridOrigin } from './grid';
import { reachableMask, snapToReachable, snapToPassable, clearMaskCache } from './snap';

/** Fastest of three runs: background load on a shared machine slows single runs. */
function fastestMs<T>(run: () => T): { value: T; ms: number } {
  let best = Infinity;
  let value!: T;
  for (let i = 0; i < 3; i++) {
    const t0 = performance.now();
    value = run();
    best = Math.min(best, performance.now() - t0);
  }
  return { value, ms: best };
}

describe('Snap module (reachableMask and stop snapping)', () => {
  const origin: GridOrigin = {
    lon0: 137.36,
    lat0: -4.82,
    lat_c: -4.82,
  };

  /**
   * Helper to build a simple synthetic grid.
   * costData: 0 = passable, 255 = impassable
   */
  function makeGrid(
    width: number,
    height: number,
    costs: number[],
    cell_x_m = 2.0,
    cell_y_m = 2.0
  ) {
    const elevData = new Uint16Array(width * height);
    const costData = new Uint8Array(costs);
    const header: GridHeader = {
      width,
      height,
      cell_x_m,
      cell_y_m,
      elev: { file: 'elev.bin', dtype: 'uint16', scale_m: 0.1, offset_m: 0, nodata: 65535 },
      cost: { file: 'cost.bin', dtype: 'uint8', impassable: 255 },
      origin,
    };
    return createGrid(header, elevData, costData, origin);
  }

  it('reachableMask marks 8-neighbour connected component on synthetic grid', () => {
    // 5x5 grid with a vertical wall at col 2 except a diagonal hole at (1, 2)
    // Row 0: 0   0 255   0   0
    // Row 1: 0   0 255   0   0
    // Row 2: 0   0 255   0   0
    // Row 3: 0   0 255   0   0
    // Row 4: 0   0 255   0   0
    // A complete wall at col 2!
    const width = 5;
    const height = 5;
    const costs = new Array(25).fill(0);
    for (let r = 0; r < 5; r++) {
      costs[r * 5 + 2] = 255;
    }
    const grid = makeGrid(width, height, costs);

    // Start at (0, 0)
    const start = grid.rowColToLonLat(0, 0);
    const mask = reachableMask(grid, start);

    // cols 0 and 1 should be 1
    for (let r = 0; r < 5; r++) {
      for (let c = 0; c < 2; c++) {
        expect(mask[r * 5 + c]).toBe(1);
      }
      // wall at col 2 should be 0
      expect(mask[r * 5 + 2]).toBe(0);
      // cols 3 and 4 should be 0 (unreachable across wall)
      for (let c = 3; c < 5; c++) {
        expect(mask[r * 5 + c]).toBe(0);
      }
    }
  });

  it('reachableMask caches result per grid and start cell', () => {
    const grid = makeGrid(3, 3, new Array(9).fill(0));
    const start = grid.rowColToLonLat(1, 1);

    const mask1 = reachableMask(grid, start);
    const mask2 = reachableMask(grid, start);
    expect(mask1).toBe(mask2); // exact same object reference from cache
  });

  it('reachableMask returns all zeros when start itself is impassable', () => {
    const costs = [
      255, 0, 0,
      0, 0, 0,
      0, 0, 0,
    ];
    const grid = makeGrid(3, 3, costs);
    const start = grid.rowColToLonLat(0, 0);
    const mask = reachableMask(grid, start);
    expect(mask.every((val) => val === 0)).toBe(true);
  });

  it('snapToReachable returns movedM = 0 when point is already reachable', () => {
    const grid = makeGrid(3, 3, new Array(9).fill(0));
    const start = grid.rowColToLonLat(0, 0);
    const mask = reachableMask(grid, start);

    const point = grid.rowColToLonLat(1, 1);
    const res = snapToReachable(grid, mask, point);
    expect(res).not.toBeNull();
    expect(res!.movedM).toBe(0);
    expect(res!.lon).toBe(point.lon);
    expect(res!.lat).toBe(point.lat);
  });

  it('snapToReachable finds exact nearest reachable cell centre and movedM', () => {
    // 3x3 grid:
    // (0,0)=0,   (0,1)=255, (0,2)=255
    // (1,0)=255, (1,1)=255, (1,2)=255
    // (2,0)=255, (2,1)=255, (2,2)=255
    // Only (0, 0) is passable and reachable!
    const costs = new Array(9).fill(255);
    costs[0] = 0; // row 0, col 0
    const cell_x_m = 2.0;
    const cell_y_m = 2.0;
    const grid = makeGrid(3, 3, costs, cell_x_m, cell_y_m);
    const start = grid.rowColToLonLat(0, 0);
    const mask = reachableMask(grid, start);

    // Point at row 0, col 1 cell centre
    const targetPt = grid.rowColToLonLat(0, 1);
    const res = snapToReachable(grid, mask, targetPt, 10);
    expect(res).not.toBeNull();
    // Nearest reachable cell is (0, 0)
    const cell00Centre = grid.rowColToLonLat(0, 0);
    expect(res!.lon).toBeCloseTo(cell00Centre.lon, 8);
    expect(res!.lat).toBeCloseTo(cell00Centre.lat, 8);
    // Distance from (0, 1) cell centre to (0, 0) cell centre is exactly cell_x_m = 2.0 m
    expect(res!.movedM).toBeCloseTo(2.0, 4);
  });

  it('snapToReachable returns null when nothing reachable is within maxM', () => {
    // 10x10 grid with cell_x_m = 10m
    const costs = new Array(100).fill(255);
    costs[0] = 0; // only (0, 0) is reachable
    const grid = makeGrid(10, 10, costs, 10.0, 10.0);
    const start = grid.rowColToLonLat(0, 0);
    const mask = reachableMask(grid, start);

    // Point at (9, 9) cell centre is ~127 m away
    const farPt = grid.rowColToLonLat(9, 9);
    // maxM = 50 m -> should return null
    const res = snapToReachable(grid, mask, farPt, 50);
    expect(res).toBeNull();

    // maxM = 150 m -> should find (0, 0)
    const res2 = snapToReachable(grid, mask, farPt, 150);
    expect(res2).not.toBeNull();
    const cell00 = grid.rowColToLonLat(0, 0);
    expect(res2!.lon).toBeCloseTo(cell00.lon, 7);
    expect(res2!.lat).toBeCloseTo(cell00.lat, 7);
  });

  it('snapToPassable snaps point to nearest passable cell on impassable start', () => {
    // 3x3 grid: center (1, 1) is impassable, (1, 0) is passable
    const costs = new Array(9).fill(255);
    costs[1 * 3 + 0] = 0; // row 1, col 0 is passable
    const grid = makeGrid(3, 3, costs, 2.0, 2.0);

    const pt = grid.rowColToLonLat(1, 1);
    const res = snapToPassable(grid, pt, 10);
    expect(res).not.toBeNull();
    const expected = grid.rowColToLonLat(1, 0);
    expect(res!.lon).toBeCloseTo(expected.lon, 8);
    expect(res!.lat).toBeCloseTo(expected.lat, 8);
    expect(res!.movedM).toBeCloseTo(2.0, 4);
  });

  it('builds the mask and snaps quickly on a 2000x2000 grid', () => {
    const width = 2000;
    const height = 2000;
    const costData = new Uint8Array(width * height);
    // Fill ~25% with 255 (simulating Gale terrain)
    for (let i = 0; i < costData.length; i++) {
      if ((i % 4) === 0) costData[i] = 255;
      else costData[i] = 20;
    }
    const elevData = new Uint16Array(width * height);
    const header: GridHeader = {
      width,
      height,
      cell_x_m: 2.0,
      cell_y_m: 2.0,
      elev: { file: 'elev.bin', dtype: 'uint16', scale_m: 0.1, offset_m: 0, nodata: 65535 },
      cost: { file: 'cost.bin', dtype: 'uint8', impassable: 255 },
      origin,
    };
    const grid = createGrid(header, elevData, costData, origin);

    const startPt = grid.rowColToLonLat(1000, 1001); // cost is 20 (passable)

    // Measured about 80-170 ms on an idle laptop; the bounds catch a real regression, not load.
    const { value: mask, ms: maskDuration } = fastestMs(() => { clearMaskCache(); return reachableMask(grid, startPt); });

    expect(maskDuration).toBeLessThan(1000);

    // Pick an impassable cell right next to start
    const testPt = grid.rowColToLonLat(1000, 1000); // cost is 255 because index % 4 == 0
    const { value: snap, ms: snapDuration } = fastestMs(() => snapToReachable(grid, mask, testPt, 100));

    expect(snapDuration).toBeLessThan(100);
    expect(snap).not.toBeNull();
    expect(snap!.movedM).toBeCloseTo(2.0, 4);
  });

  it('runs on full Gale dataset (1993x2000) within performance limits and snaps Boxwork ridge', () => {
    const galeDir = path.resolve(__dirname, '../../../data/sites/gale/bundle');
    if (!fs.existsSync(path.join(galeDir, 'grid.json'))) {
      return; // Skip if gale data not mounted
    }
    const header = JSON.parse(fs.readFileSync(path.join(galeDir, 'grid.json'), 'utf8')) as GridHeader;
    const site = JSON.parse(fs.readFileSync(path.join(galeDir, 'site.json'), 'utf8')) as { origin: GridOrigin };
    const elevBuf = fs.readFileSync(path.join(galeDir, 'elev.bin'));
    const costBuf = fs.readFileSync(path.join(galeDir, 'cost.bin'));
    const elevData = new Uint16Array(elevBuf.buffer, elevBuf.byteOffset, elevBuf.byteLength / 2);
    const costData = new Uint8Array(costBuf.buffer, costBuf.byteOffset, costBuf.byteLength);

    const grid = createGrid(header, elevData, costData, site.origin);
    const startPt = { lon: 137.36390043472582, lat: -4.823903410684223 };

    const { value: mask, ms: maskMs } = fastestMs(() => { clearMaskCache(); return reachableMask(grid, startPt); });
    expect(maskMs).toBeLessThan(1000);

    const boxworkRidge = { lon: 137.3697412, lat: -4.8177456 };
    const { value: snap, ms: snapMs } = fastestMs(() => snapToReachable(grid, mask, boxworkRidge, 100));
    expect(snapMs).toBeLessThan(100);
    expect(snap).not.toBeNull();
    // Nearest reachable cell is ~36 m away (rounded to 36 or 37 m)
    expect(Math.round(snap!.movedM)).toBe(36);
  });
});
