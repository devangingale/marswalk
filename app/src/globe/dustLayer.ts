// Written with AI assistance, directed and reviewed by the team.
//
// Dust optical-depth history layer for the globe. Daily frames are stored as
// uint8 grids ([sol][lat][lon], raw = byte * scale + offset, 255 = no data);
// the grid and palette come from the dust index.json. One frame is drawn to a
// canvas and shown as a translucent image shell just above the planet.

import {
  Cartesian3,
  EllipsoidGeometry,
  EllipsoidSurfaceAppearance,
  GeometryInstance,
  Material,
  Primitive,
  type Scene,
  VertexFormat,
} from 'cesium';

export interface DustSol {
  sol: number;
  ls: number;
  earth_date: string;
}

export interface DustYear {
  my: number;
  url: string;
  frames: number;
  sols: DustSol[];
}

/** RGBA colour stops keyed by decoded optical-depth value; alpha 00 is clear sky. */
export interface DustPalette {
  stops: [number, string][];
}

/** The lon/lat grid as published in index.json (top-left origin at west/north). */
export interface DustGridSpec {
  west: number;
  north: number;
  res_lon: number;
  res_lat: number;
  width: number;
  height: number;
}

export interface DustIndex {
  version: number;
  variable: string;
  units: string;
  grid: DustGridSpec;
  scale: number;
  offset: number;
  nodata: number;
  palette: DustPalette;
  years: DustYear[];
  source?: { citation?: string; licence?: string; [key: string]: unknown };
  sample?: string;
}

/** Everything decodeFrame needs: the grid shape plus the byte -> value transform. */
export type DustGrid = DustGridSpec & { scale: number; offset: number; nodata: number };

/** Builds the decode grid from a loaded index. */
export function dustGrid(index: DustIndex): DustGrid {
  return { ...index.grid, scale: index.scale, offset: index.offset, nodata: index.nodata };
}

/**
 * Frame index for a sol within one Mars Year's frame stack. Frames are one per
 * sol, contiguous from the year's first sol, so the index is the sol offset,
 * clamped to the available range.
 */
export function frameIndex(year: DustYear, sol: number): number {
  const first = year.sols.length > 0 ? year.sols[0].sol : 1;
  const idx = sol - first;
  if (idx < 0) return 0;
  if (idx > year.frames - 1) return year.frames - 1;
  return idx;
}

/**
 * Decodes one frame to physical values. Each byte is raw * scale + offset;
 * the nodata byte (255) becomes NaN so clear-sky and missing cells stay apart.
 */
export function decodeFrame(bytes: Uint8Array, grid: DustGrid, frame: number): Float32Array {
  const cells = grid.width * grid.height;
  const out = new Float32Array(cells);
  const base = frame * cells;
  for (let i = 0; i < cells; i++) {
    const raw = bytes[base + i];
    out[i] = raw === grid.nodata ? NaN : raw * grid.scale + grid.offset;
  }
  return out;
}

/** Parses "#rrggbbaa" (or "#rrggbb") to an [r, g, b, a] byte tuple. */
export function parseRgba(hex: string): [number, number, number, number] {
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  const a = h.length >= 8 ? parseInt(h.slice(6, 8), 16) : 255;
  return [r, g, b, a];
}

/**
 * Maps a decoded value to an RGBA byte tuple by linear interpolation between
 * the index palette stops. NaN (no data) and values below the first stop are
 * fully transparent; values above the last stop take the last colour.
 */
export function paletteColor(palette: DustPalette, value: number): [number, number, number, number] {
  const stops = palette.stops;
  if (Number.isNaN(value) || stops.length === 0) return [0, 0, 0, 0];
  if (value <= stops[0][0]) return parseRgba(stops[0][1]);
  const last = stops[stops.length - 1];
  if (value >= last[0]) return parseRgba(last[1]);
  for (let i = 1; i < stops.length; i++) {
    const [v1, c1] = stops[i];
    if (value <= v1) {
      const [v0, c0] = stops[i - 1];
      const t = v1 === v0 ? 0 : (value - v0) / (v1 - v0);
      const a = parseRgba(c0);
      const b = parseRgba(c1);
      return [
        Math.round(a[0] + (b[0] - a[0]) * t),
        Math.round(a[1] + (b[1] - a[1]) * t),
        Math.round(a[2] + (b[2] - a[2]) * t),
        Math.round(a[3] + (b[3] - a[3]) * t),
      ];
    }
  }
  return parseRgba(last[1]);
}

/**
 * Renders a decoded frame to a flat RGBA byte buffer (width * height * 4),
 * row 0 at the grid's north edge. Pure so it can be tested without a canvas.
 */
export function renderRgba(values: Float32Array, grid: DustGrid, palette: DustPalette): Uint8ClampedArray {
  const cells = grid.width * grid.height;
  const out = new Uint8ClampedArray(cells * 4);
  for (let i = 0; i < cells; i++) {
    const [r, g, b, a] = paletteColor(palette, values[i]);
    out[i * 4] = r;
    out[i * 4 + 1] = g;
    out[i * 4 + 2] = b;
    out[i * 4 + 3] = a;
  }
  return out;
}

/** Height of the dust shell above the planet surface, in metres. */
const SHELL_HEIGHT_M = 12_000;

/**
 * One dust frame drawn to a canvas and shown as a translucent image shell just
 * above the planet. A scene primitive (not a tileset imagery layer) is used so
 * the frame always renders and can be swapped while scrubbing: only the image
 * material is updated, the geometry stays. The canvas is flipped vertically so
 * row 0 (north) lands at the top of the texture and the image aligns with the
 * ellipsoid's longitude/latitude.
 */
export class DustLayer {
  private primitive: Primitive | null = null;
  private material: Material | null = null;
  private canvas: HTMLCanvasElement | null = null;
  private visible = true;

  constructor(private readonly scene: Scene) {}

  showFrame(values: Float32Array, grid: DustGrid, palette: DustPalette): void {
    const rgba = renderRgba(values, grid, palette);
    const canvas = this.canvas ?? (this.canvas = document.createElement('canvas'));
    canvas.width = grid.width;
    canvas.height = grid.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    // Draw the row-0-north frame to a scratch buffer, then flip it vertically so
    // north lands at the texture top once the globe samples the image bottom-up.
    const scratch = document.createElement('canvas');
    scratch.width = grid.width;
    scratch.height = grid.height;
    scratch.getContext('2d')?.putImageData(new ImageData(rgba, grid.width, grid.height), 0, 0);
    ctx.clearRect(0, 0, grid.width, grid.height);
    ctx.save();
    ctx.translate(0, grid.height);
    ctx.scale(1, -1);
    ctx.drawImage(scratch, 0, 0);
    ctx.restore();

    const url = canvas.toDataURL('image/png');
    if (this.material) {
      this.material.uniforms.image = url;
      return;
    }

    this.material = Material.fromType('Image', { image: url });
    const radii = Cartesian3.add(
      this.scene.ellipsoid.radii,
      new Cartesian3(SHELL_HEIGHT_M, SHELL_HEIGHT_M, SHELL_HEIGHT_M),
      new Cartesian3(),
    );
    this.primitive = new Primitive({
      geometryInstances: new GeometryInstance({
        geometry: new EllipsoidGeometry({ radii, vertexFormat: VertexFormat.POSITION_AND_ST }),
      }),
      appearance: new EllipsoidSurfaceAppearance({ material: this.material, translucent: true, flat: true }),
      asynchronous: false,
    });
    this.primitive.show = this.visible;
    this.scene.primitives.add(this.primitive);
  }

  setVisible(show: boolean): void {
    this.visible = show;
    if (this.primitive) this.primitive.show = show;
  }

  destroy(): void {
    if (this.primitive) {
      this.scene.primitives.remove(this.primitive);
      this.primitive = null;
    }
    this.material = null;
    this.canvas = null;
  }
}
