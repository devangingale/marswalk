// Written with AI assistance, directed and reviewed by the team.
// Latitude and longitude lines: every 10 degrees on the globe, finer when zoomed into a site.
import { ArcType, ClassificationType, Color, type Entity } from 'cesium';
import { lonLatToCartesian } from './frame';
import type { OverlayHost } from './overlays';
import { formatGraticule, graticuleValues } from './routeLook';

export interface ViewBounds {
  west: number;
  south: number;
  east: number;
  north: number;
}

export interface GraticuleLine {
  axis: 'lat' | 'lon';
  value: number;
  label: string;
  points: [number, number][];
}

/** Parallels stop short of the poles, where meridians converge. */
const POLAR_LIMIT = 80;
/** More lines than this on one axis means the view is too wide for the step. */
const MAX_LINES = 60;

/**
 * Meridians and parallels at step degrees across the view (the whole planet at 10 degrees).
 * A view across 180 degrees has east < west; meridian values beyond 180 wrap for labels.
 */
export function graticuleLines(view: ViewBounds | null, step: number): GraticuleLine[] {
  const whole = step >= 10 || !view;
  const west = whole ? -180 : view.west;
  const east = whole ? 180 : view.east < view.west ? view.east + 360 : view.east;
  const south = Math.max(whole ? -POLAR_LIMIT : view.south, -POLAR_LIMIT);
  const north = Math.min(whole ? POLAR_LIMIT : view.north, POLAR_LIMIT);
  const lons = graticuleValues(west, whole ? 170 : east, step);
  const lats = graticuleValues(south, north, step);
  if (lons.length > MAX_LINES || lats.length > MAX_LINES) return [];

  const samples = (from: number, to: number) => {
    const n = Math.max(2, Math.min(37, Math.ceil((to - from) / step) + 1));
    return Array.from({ length: n }, (_, i) => from + ((to - from) * i) / (n - 1));
  };
  const wrap = (lon: number) => (lon > 180 ? lon - 360 : lon);
  return [
    ...lons.map((lon) => ({
      axis: 'lon' as const,
      value: wrap(lon),
      label: formatGraticule(wrap(lon), 'lon', step),
      points: samples(south, north).map((lat): [number, number] => [wrap(lon), lat]),
    })),
    ...lats.map((lat) => ({
      axis: 'lat' as const,
      value: lat,
      label: formatGraticule(lat, 'lat', step),
      points: samples(west, east).map((lon): [number, number] => [wrap(lon), lat]),
    })),
  ];
}

export interface PlacedLabel {
  text: string;
  x: number;
  y: number;
  axis: 'lat' | 'lon';
}

/** Approximate size of a label in the extra-small map label style, in pixels. */
const CHAR_PX = 6.5;
const LABEL_H_PX = 14;
const LABEL_GAP_PX = 4;

export type Box = [left: number, top: number, right: number, bottom: number];

export interface ScreenLabelBox {
  id: string;
  box: Box;
  priority: number;
}

/** Keep the highest priority screen labels whose measured boxes do not collide. */
export function cullScreenLabels(labels: ScreenLabelBox[], blocked: Box[] = []): string[] {
  const ordered = labels.map((label, index) => ({ ...label, index })).sort((a, b) => a.priority - b.priority || a.index - b.index);
  const kept: Box[] = [...blocked];
  const visible: string[] = [];
  for (const label of ordered) {
    const [left, top, right, bottom] = label.box;
    const overlaps = (box: Box) => left < box[2] && box[0] < right && top < box[3] && box[1] < bottom;
    if (kept.some(overlaps)) continue;
    kept.push(label.box);
    visible.push(label.id);
  }
  return visible;
}

/**
 * Drops labels that would overlap a blocked box (a panel over the map) or a label already kept,
 * in order. Meridian labels are centred on x, parallel labels start at x; both are centred on y.
 */
export function cullLabels<T extends PlacedLabel>(labels: T[], blocked: Box[] = []): T[] {
  const kept: { box: Box; label: T }[] = [];
  for (const label of labels) {
    const w = label.text.length * CHAR_PX + LABEL_GAP_PX;
    const left = label.axis === 'lon' ? label.x - w / 2 : label.x;
    const top = label.axis === 'lon' ? label.y : label.y - LABEL_H_PX / 2;
    const box: Box = [left, top, left + w, top + LABEL_H_PX];
    const overlaps = (b: Box) => box[0] < b[2] && b[0] < box[2] && box[1] < b[3] && b[1] < box[3];
    const hit = blocked.some(overlaps) || kept.some(({ box: b }) => overlaps(b));
    if (!hit) kept.push({ box, label });
  }
  return kept.map((k) => k.label);
}

/** Draws graticule lines as thin ground lines in the --map-graticule colour. */
export class GlobeGraticule {
  private drawn: Entity[] = [];
  private key = '';

  constructor(
    private readonly host: OverlayHost,
    private readonly colour: Color,
    private readonly classification: ClassificationType = ClassificationType.CESIUM_3D_TILE,
  ) {}

  /** Redraws only when the set of lines changes. */
  update(lines: GraticuleLine[]): void {
    const key = lines.map((l) => `${l.axis}${l.value}:${l.points[0]}:${l.points.at(-1)}`).join('|');
    if (key === this.key) return;
    this.clear();
    this.key = key;
    for (const line of lines) {
      this.drawn.push(
        this.host.entities.add({
          polyline: {
            positions: line.points.map(([lon, lat]) => lonLatToCartesian(lon, lat, 0)),
            width: 1,
            clampToGround: true,
            arcType: ArcType.RHUMB,
            classificationType: this.classification,
            material: this.colour,
          },
        }),
      );
    }
  }

  clear(): void {
    for (const entity of this.drawn) this.host.entities.remove(entity);
    this.drawn = [];
    this.key = '';
  }
}
