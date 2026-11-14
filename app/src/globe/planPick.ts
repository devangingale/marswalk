import type { RouteGrid } from '../lib/grid';

/** Test the local Mars metre rectangle; the north-east boundary includes its edge cell. */
export function isInsideSite(grid: RouteGrid, lon: number, lat: number): boolean {
  const { x_m, y_m } = grid.lonlatToLocalMetres(lon, lat);
  const edgeToleranceM = 1e-6;
  return x_m >= -edgeToleranceM && x_m <= grid.width_m + edgeToleranceM
    && y_m >= -edgeToleranceM && y_m <= grid.height_m + edgeToleranceM;
}
