// Written with AI assistance, directed and reviewed by the team.

/**
 * Route grid loader and coordinate transform utilities for Marswalk.
 * Implements Contracts Section 3 (Coordinates and Units) and Section 6 (Route grids).
 *
 * Geographic coordinates: lon/lat on Mars sphere with radius R = 3396190 m.
 * Local metres: south-west origin (lon0, lat0), center latitude lat_c.
 *   x_m = R * cos(lat_c) * radians(lon - lon0)  (east)
 *   y_m = R * radians(lat - lat0)               (north)
 *
 * Grids: row-major, row 0 is northern edge, col 0 is western edge.
 * Cell (row, col) centre:
 *   x_m = (col + 0.5) * cell_x_m
 *   y_m = height_m - (row + 0.5) * cell_y_m
 */

export const MARS_R = 3396190.0; // Metres

export interface GridOrigin {
  lon0: number;
  lat0: number;
  lat_c: number;
}

export interface ElevHeader {
  file: string;
  dtype: 'uint16';
  scale_m: number;
  offset_m: number;
  nodata: number;
}

export interface CostHeader {
  file: string;
  dtype: 'uint8';
  impassable: number;
  multiplier?: string;
}

export interface GridHeader {
  width: number;
  height: number;
  cell_x_m: number;
  cell_y_m: number;
  elev: ElevHeader;
  cost: CostHeader;
  limits?: { max_slope_deg?: number };
  cost_source?: string;
  origin?: GridOrigin;
}

export interface RouteGrid {
  header: GridHeader;
  origin: GridOrigin;
  elevData: Uint16Array;
  costData: Uint8Array;
  width: number;
  height: number;
  cell_x_m: number;
  cell_y_m: number;
  width_m: number;
  height_m: number;
  getElevation(row: number, col: number): number;
  getCost(row: number, col: number): number;
  getCostMultiplier(row: number, col: number): number;
  isPassable(row: number, col: number): boolean;
  isInside(row: number, col: number): boolean;
  lonlatToLocalMetres(lon: number, lat: number): { x_m: number; y_m: number };
  localMetresToLonLat(x_m: number, y_m: number): { lon: number; lat: number };
  localMetresToRowCol(x_m: number, y_m: number): { row: number; col: number };
  rowColToLocalMetres(row: number, col: number): { x_m: number; y_m: number };
  lonlatToRowCol(lon: number, lat: number): { row: number; col: number };
  rowColToLonLat(row: number, col: number): { lon: number; lat: number };
}

export function degToRad(deg: number): number {
  return (deg * Math.PI) / 180.0;
}

export function radToDeg(rad: number): number {
  return (rad * 180.0) / Math.PI;
}

export function normalizeLongitudeDelta(delta: number): number {
  const wrapped = delta % 360;
  return wrapped >= 180 ? wrapped - 360 : wrapped < -180 ? wrapped + 360 : wrapped;
}

export function lonlatToLocalMetres(
  lon: number,
  lat: number,
  origin: GridOrigin
): { x_m: number; y_m: number } {
  const x_m = MARS_R * Math.cos(degToRad(origin.lat_c)) * degToRad(normalizeLongitudeDelta(lon - origin.lon0));
  const y_m = MARS_R * degToRad(lat - origin.lat0);
  return { x_m, y_m };
}

export function localMetresToLonLat(
  x_m: number,
  y_m: number,
  origin: GridOrigin
): { lon: number; lat: number } {
  const lon = origin.lon0 + radToDeg(x_m / (MARS_R * Math.cos(degToRad(origin.lat_c))));
  const lat = origin.lat0 + radToDeg(y_m / MARS_R);
  return { lon, lat };
}

export function localMetresToRowCol(
  x_m: number,
  y_m: number,
  height_m: number,
  cell_x_m: number,
  cell_y_m: number,
  width_m = Infinity
): { row: number; col: number } {
  const col = x_m >= width_m && x_m <= width_m + cell_x_m ? Math.round(width_m / cell_x_m) - 1
    : x_m < 0 && x_m >= -cell_x_m ? 0 : Math.floor(x_m / cell_x_m);
  const row = y_m <= 0 && y_m >= -cell_y_m ? Math.round(height_m / cell_y_m) - 1
    : y_m > height_m && y_m <= height_m + cell_y_m ? 0 : Math.floor((height_m - y_m) / cell_y_m);
  return { row, col };
}

export function rowColToLocalMetres(
  row: number,
  col: number,
  height_m: number,
  cell_x_m: number,
  cell_y_m: number
): { x_m: number; y_m: number } {
  const x_m = (col + 0.5) * cell_x_m;
  const y_m = height_m - (row + 0.5) * cell_y_m;
  return { x_m, y_m };
}

/**
 * Creates a RouteGrid instance from in-memory typed arrays and headers.
 */
export function createGrid(
  header: GridHeader,
  elevData: Uint16Array,
  costData: Uint8Array,
  origin?: GridOrigin
): RouteGrid {
  const resolvedOrigin = origin || header.origin;
  if (!resolvedOrigin) {
    throw new Error('Grid origin (lon0, lat0, lat_c) must be provided in header or arguments.');
  }

  const width = header.width;
  const height = header.height;
  const cell_x_m = header.cell_x_m;
  const cell_y_m = header.cell_y_m;
  const width_m = width * cell_x_m;
  const height_m = height * cell_y_m;

  const expectedLength = width * height;
  if (elevData.length !== expectedLength) {
    throw new Error(`elevData length ${elevData.length} does not match width*height ${expectedLength}`);
  }
  if (costData.length !== expectedLength) {
    throw new Error(`costData length ${costData.length} does not match width*height ${expectedLength}`);
  }

  const elevOffset = header.elev.offset_m;
  const elevScale = header.elev.scale_m;
  const elevNodata = header.elev.nodata;
  const costImpassable = header.cost.impassable;

  return {
    header,
    origin: resolvedOrigin,
    elevData,
    costData,
    width,
    height,
    cell_x_m,
    cell_y_m,
    width_m,
    height_m,

    isInside(row: number, col: number): boolean {
      return row >= 0 && row < height && col >= 0 && col < width;
    },

    getElevation(row: number, col: number): number {
      if (row < 0 || row >= height || col < 0 || col >= width) return NaN;
      const raw = elevData[row * width + col];
      if (raw === elevNodata) return NaN;
      return elevOffset + raw * elevScale;
    },

    getCost(row: number, col: number): number {
      if (row < 0 || row >= height || col < 0 || col >= width) return costImpassable;
      return costData[row * width + col];
    },

    getCostMultiplier(row: number, col: number): number {
      const c = this.getCost(row, col);
      if (c >= costImpassable) return Infinity;
      return 1.0 + c / 50.0;
    },

    isPassable(row: number, col: number): boolean {
      if (row < 0 || row >= height || col < 0 || col >= width) return false;
      const idx = row * width + col;
      if (costData[idx] >= costImpassable) return false;
      if (elevData[idx] === elevNodata) return false;
      return true;
    },

    lonlatToLocalMetres(lon: number, lat: number) {
      return lonlatToLocalMetres(lon, lat, resolvedOrigin);
    },

    localMetresToLonLat(x_m: number, y_m: number) {
      return localMetresToLonLat(x_m, y_m, resolvedOrigin);
    },

    localMetresToRowCol(x_m: number, y_m: number) {
      return localMetresToRowCol(x_m, y_m, height_m, cell_x_m, cell_y_m, width_m);
    },

    rowColToLocalMetres(row: number, col: number) {
      return rowColToLocalMetres(row, col, height_m, cell_x_m, cell_y_m);
    },

    lonlatToRowCol(lon: number, lat: number) {
      const { x_m, y_m } = lonlatToLocalMetres(lon, lat, resolvedOrigin);
      return localMetresToRowCol(x_m, y_m, height_m, cell_x_m, cell_y_m, width_m);
    },

    rowColToLonLat(row: number, col: number) {
      const { x_m, y_m } = rowColToLocalMetres(row, col, height_m, cell_x_m, cell_y_m);
      return localMetresToLonLat(x_m, y_m, resolvedOrigin);
    },
  };
}

/**
 * Loads route grid files from a base URL:
 * - <baseUrl>/grid.json
 * - <baseUrl>/<header.elev.file> (elev.bin)
 * - <baseUrl>/<header.cost.file> (cost.bin)
 */
export async function loadGrid(baseUrl: string, origin?: GridOrigin): Promise<RouteGrid> {
  const cleanBase = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;

  const headerRes = await fetch(`${cleanBase}/grid.json`);
  if (!headerRes.ok) {
    throw new Error(`Failed to fetch ${cleanBase}/grid.json: ${headerRes.status} ${headerRes.statusText}`);
  }
  const header = (await headerRes.json()) as GridHeader;

  const elevFile = header.elev?.file || 'elev.bin';
  const costFile = header.cost?.file || 'cost.bin';

  const [elevRes, costRes] = await Promise.all([
    fetch(`${cleanBase}/${elevFile}`),
    fetch(`${cleanBase}/${costFile}`),
  ]);

  if (!elevRes.ok) {
    throw new Error(`Failed to fetch ${cleanBase}/${elevFile}: ${elevRes.status} ${elevRes.statusText}`);
  }
  if (!costRes.ok) {
    throw new Error(`Failed to fetch ${cleanBase}/${costFile}: ${costRes.status} ${costRes.statusText}`);
  }

  const elevBuffer = await elevRes.arrayBuffer();
  const costBuffer = await costRes.arrayBuffer();

  const elevData = new Uint16Array(elevBuffer);
  const costData = new Uint8Array(costBuffer);

  return createGrid(header, elevData, costData, origin);
}
