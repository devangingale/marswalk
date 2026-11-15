// Written with AI assistance, directed and reviewed by the team.
// Pure helpers for how a route, its hover state, slopes and coordinates read on the globe.
// Cesium-free so they can be tested exactly. Distances use the local-metre frame.
import { GridOrigin, lonlatToLocalMetres, localMetresToLonLat } from '../lib/grid';
import type { Plan } from '../lib/plan';
import { chevronPositions, type ChevronPosition, type Section, type SlopeStats } from '../lib/routeShape';
import { formatDistance, formatDuration } from '../walk/format';

const START_ID = 'start';

export function formatLat(lat: number): string {
  return `${Math.abs(lat).toFixed(4)}° ${lat < 0 ? 'S' : 'N'}`;
}

export function formatLon(lon: number): string {
  const wrapped = ((((lon + 180) % 360) + 360) % 360) - 180;
  return `${Math.abs(wrapped).toFixed(4)}° ${wrapped < 0 ? 'W' : 'E'}`;
}

export function formatLatLon(lon: number, lat: number): string {
  return `${formatLat(lat)}, ${formatLon(lon)}`;
}

function groupThousands(n: number): string {
  const sign = n < 0 ? '-' : '';
  return sign + String(Math.abs(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

export function formatElevation(m: number): string {
  return `${groupThousands(Math.round(m))} m`;
}

/** Drop-off for the start, else the stop's 1-based number in plan order. */
export function waypointLabel(id: string, plan: Plan): string {
  if (id === START_ID) return 'Drop-off';
  const index = plan.stops.findIndex((s) => s.id === id);
  return index >= 0 ? String(index + 1) : id;
}

function totals(plan: Plan, legIndices: number[]) {
  const legs = legIndices.map((i) => plan.route.legs[i]).filter(Boolean);
  return {
    distance: legs.reduce((sum, l) => sum + l.distance_m, 0),
    time: legs.reduce((sum, l) => sum + l.time_s, 0),
  };
}

/** For example: Drop-off → 3 via 2 · 2.4 km · 55 min. */
export function sectionLabel(section: Section, plan: Plan): string {
  const via = section.detourStopIds.length
    ? ` via ${section.detourStopIds.map((id) => waypointLabel(id, plan)).join(', ')}`
    : '';
  const { distance, time } = totals(plan, section.legIndices);
  return `${waypointLabel(section.fromStopId, plan)} → ${waypointLabel(section.toStopId, plan)}${via} · ${formatDistance(distance)} · ${formatDuration(time)}`;
}

/** The whole route as its chain of stops, with the plan totals. */
export function routeLabel(plan: Plan): string {
  const legs = plan.route.legs;
  if (!legs.length) return '';
  const chain = [legs[0].from, ...legs.map((l) => l.to)].map((id) => waypointLabel(id, plan)).join(' → ');
  const { distance, time } = totals(plan, legs.map((_, i) => i));
  return `${chain} · ${formatDistance(distance)} · ${formatDuration(time)}`;
}

/** Fork branch label from forkPoints' toLabel ('drop-off' or a stop id). */
export function branchLabel(toLabel: string, plan: Plan): string {
  if (toLabel === 'drop-off' || toLabel === START_ID) return 'back to drop-off';
  return `to Stop ${waypointLabel(toLabel, plan)}`;
}

export function needsFinish(plan: Plan): boolean {
  const last = plan.route.legs.at(-1);
  return !!last && last.to !== START_ID;
}

export type HoverMode = 'route' | 'section';

/** Pixel span under which the route is too small on screen to hover by section. */
export const SECTION_HOVER_MIN_PX = 400;
export const SUMMARY_LABEL_MIN_PX = 150;

export function showSummaryLabels(routeSpanPx: number): boolean {
  return routeSpanPx >= SUMMARY_LABEL_MIN_PX;
}

export function hoverMode(spanPx: number): HoverMode {
  return spanPx < SECTION_HOVER_MIN_PX ? 'route' : 'section';
}

/** Larger side of the screen bounding box of the points. */
export function screenSpan(points: { x: number; y: number }[]): number {
  if (!points.length) return 0;
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  return Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
}

export type StretchStyle = 'normal' | 'highlight' | 'dim';
export type RouteHover = { mode: 'route' } | { mode: 'section'; legIndices: number[] } | null;

/** Style of each stretch (given the legs that walk it) for the current hover. */
export function stretchStyles(stretchLegs: number[][], hover: RouteHover): StretchStyle[] {
  return stretchLegs.map((legs) => {
    if (!hover) return 'normal';
    if (hover.mode === 'route') return 'highlight';
    return legs.some((l) => hover.legIndices.includes(l)) ? 'highlight' : 'dim';
  });
}

/** The first section in walking order that walks any of the given legs. */
export function sectionForLegs(sections: Section[], legs: number[]): Section | null {
  return sections.find((s) => s.legIndices.some((l) => legs.includes(l))) ?? null;
}

/** Gradient bin 1 to 5: under 5, 10, 15 and 20 degrees, then 20 and over (the planner limit). */
export function gradeBin(deg: number): 1 | 2 | 3 | 4 | 5 {
  const a = Math.abs(deg);
  if (a < 5) return 1;
  if (a < 10) return 2;
  if (a < 15) return 3;
  if (a < 20) return 4;
  return 5;
}

/** Splits a line into runs of segments in one gradient bin; neighbouring runs share a vertex. */
export function gradeRuns(
  line: [number, number][],
  gradientDeg: number[],
): { bin: 1 | 2 | 3 | 4 | 5; line: [number, number][] }[] {
  const runs: { bin: 1 | 2 | 3 | 4 | 5; line: [number, number][] }[] = [];
  for (let i = 0; i < line.length - 1; i++) {
    const bin = gradeBin(gradientDeg[i] ?? 0);
    const last = runs.at(-1);
    if (last && last.bin === bin) last.line.push(line[i + 1]);
    else runs.push({ bin, line: [line[i], line[i + 1]] });
  }
  return runs;
}

export function slopeLabels(stats: SlopeStats, steepestAlongM: number) {
  return {
    high: stats.highM === null ? '' : `High ${formatElevation(stats.highM)}`,
    low: stats.lowM === null ? '' : `Low ${formatElevation(stats.lowM)}`,
    steepest:
      stats.steepestDeg === null
        ? ''
        : `Steepest ${Math.round(stats.steepestDeg)}° · ${formatDistance(steepestAlongM)} from drop-off`,
  };
}

/** All legs joined into one line, without repeating the vertex at each stop. */
export function routeLine(plan: Plan): [number, number][] {
  return plan.route.legs.flatMap((leg, i) => (i ? leg.line.slice(1) : leg.line));
}

function nearestVertex(line: [number, number][], point: [number, number], origin: GridOrigin): number {
  const p = lonlatToLocalMetres(point[0], point[1], origin);
  let best = 0;
  let bestD = Infinity;
  line.forEach(([lon, lat], i) => {
    const q = lonlatToLocalMetres(lon, lat, origin);
    const d = Math.hypot(q.x_m - p.x_m, q.y_m - p.y_m);
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  });
  return best;
}

/** Distance in metres along the line from its start to the vertex nearest the point. */
export function distanceAlong(line: [number, number][], point: [number, number], origin: GridOrigin): number {
  const end = nearestVertex(line, point, origin);
  let total = 0;
  for (let i = 0; i < end; i++) {
    const a = lonlatToLocalMetres(line[i][0], line[i][1], origin);
    const b = lonlatToLocalMetres(line[i + 1][0], line[i + 1][1], origin);
    total += Math.hypot(b.x_m - a.x_m, b.y_m - a.y_m);
  }
  return total;
}

/** The point distanceM along the line after the vertex nearest the fork (or the line's end). */
export function branchAnchor(
  line: [number, number][],
  fork: [number, number],
  distanceM: number,
  origin: GridOrigin,
): [number, number] {
  let i = nearestVertex(line, fork, origin);
  let left = distanceM;
  while (i < line.length - 1) {
    const a = lonlatToLocalMetres(line[i][0], line[i][1], origin);
    const b = lonlatToLocalMetres(line[i + 1][0], line[i + 1][1], origin);
    const d = Math.hypot(b.x_m - a.x_m, b.y_m - a.y_m);
    if (d >= left && d > 0) {
      const t = left / d;
      const p = localMetresToLonLat(a.x_m + t * (b.x_m - a.x_m), a.y_m + t * (b.y_m - a.y_m), origin);
      return [p.lon, p.lat];
    }
    left -= d;
    i++;
  }
  return line[line.length - 1];
}

/**
 * Direction (degrees clockwise from north) to offset each branch label from its branch:
 * perpendicular to the branch, on the side away from the fork's mean branch direction.
 */
export function branchLabelSides(bearingsDeg: number[]): number[] {
  const rad = (d: number) => (d * Math.PI) / 180;
  const x = bearingsDeg.reduce((sum, b) => sum + Math.sin(rad(b)), 0);
  const y = bearingsDeg.reduce((sum, b) => sum + Math.cos(rad(b)), 0);
  const mean = (Math.atan2(x, y) * 180) / Math.PI;
  return bearingsDeg.map((b) => {
    const d = ((((b - mean) % 360) + 540) % 360) - 180;
    const side = d < -1e-9 ? b - 90 : b + 90;
    return Math.round(((side % 360) + 360) % 360);
  });
}

/** Bearing in degrees clockwise from north from one point to another, in the local-metre frame. */
export function bearingDeg(from: [number, number], to: [number, number], origin: GridOrigin): number {
  const a = lonlatToLocalMetres(from[0], from[1], origin);
  const b = lonlatToLocalMetres(to[0], to[1], origin);
  return ((((Math.atan2(b.x_m - a.x_m, b.y_m - a.y_m) * 180) / Math.PI) % 360) + 360) % 360;
}

/** Spacing of direction chevrons along the route, in metres. */
export const CHEVRON_SPACING_M = 150;

/**
 * Chevrons for a stretch in every direction it is walked. One way: chevronPositions along the
 * walked direction. Both ways: forward chevrons, and backward ones offset by half the spacing
 * so the two sets interleave instead of stacking.
 */
export function chevronsFor(
  line: [number, number][],
  directions: ('fwd' | 'back')[],
  origin: GridOrigin,
  spacingM = CHEVRON_SPACING_M,
): ChevronPosition[] {
  const fwd = directions.includes('fwd');
  const back = directions.includes('back');
  if ((!fwd && !back) || line.length < 2) return [];
  const lengthM = line.slice(1).reduce((sum, point, index) => {
    const a = lonlatToLocalMetres(line[index][0], line[index][1], origin);
    const b = lonlatToLocalMetres(point[0], point[1], origin);
    return sum + Math.hypot(b.x_m - a.x_m, b.y_m - a.y_m);
  }, 0);
  if (lengthM <= 0) return [];
  if (lengthM < spacingM) {
    if (!fwd) return chevronPositions([...line].reverse(), origin, lengthM);
    if (!back) return chevronPositions(line, origin, lengthM);
    const shortSpacing = lengthM / 2;
    const out = chevronPositions(line, origin, shortSpacing);
    const offset = branchAnchor(line, line[0], shortSpacing / 2, origin);
    const startIndex = nearestVertex(line, offset, origin);
    const trimmed: [number, number][] = [offset, ...line.slice(startIndex + 1)];
    const backward = chevronPositions(trimmed, origin, shortSpacing).map((c) => ({
      ...c,
      bearingDeg: (c.bearingDeg + 180) % 360,
    }));
    return [...out, ...backward];
  }
  if (!fwd) return chevronPositions([...line].reverse(), origin, spacingM);
  const out = chevronPositions(line, origin, spacingM);
  if (!back) return out;
  const offset = branchAnchor(line, line[0], spacingM / 2, origin);
  const startIndex = nearestVertex(line, offset, origin);
  const trimmed: [number, number][] = [offset, ...line.slice(startIndex + 1)];
  const backward = chevronPositions(trimmed, origin, spacingM).map((c) => ({
    ...c,
    bearingDeg: (c.bearingDeg + 180) % 360,
  }));
  return [...out, ...backward];
}

/** Graticule spacing in degrees for a camera height above the surface. */
export function graticuleStep(cameraHeightM: number): number {
  if (cameraHeightM >= 3_000_000) return 10;
  if (cameraHeightM >= 300_000) return 1;
  if (cameraHeightM >= 30_000) return 0.1;
  if (cameraHeightM >= 3_000) return 0.01;
  return 0.001;
}

function decimals(step: number): number {
  return Math.max(0, -Math.floor(Math.log10(step) + 1e-9));
}

/** Multiples of step from min to max, rounded to the step's decimals. */
export function graticuleValues(min: number, max: number, step: number): number[] {
  const d = decimals(step);
  const values: number[] = [];
  for (let k = Math.ceil(min / step - 1e-9); k <= Math.floor(max / step + 1e-9); k++) {
    values.push(Number((k * step).toFixed(d)));
  }
  return values;
}

export function formatGraticule(value: number, axis: 'lat' | 'lon', step: number): string {
  const text = `${Math.abs(value).toFixed(decimals(step))}°`;
  if (value === 0 || (axis === 'lon' && Math.abs(value) === 180)) return text;
  if (axis === 'lat') return `${text} ${value < 0 ? 'S' : 'N'}`;
  return `${text} ${value < 0 ? 'W' : 'E'}`;
}
