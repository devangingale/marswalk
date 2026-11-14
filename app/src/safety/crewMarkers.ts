// Written with AI assistance, directed and reviewed by the team.

/**
 * What the globe draws for the crew and the rover (design: "Hardware links":
 * both astronauts on screen with an uncertainty circle, the rover with its
 * arrival time). Pure data and geometry; GlobeOverlays.setCrew draws it.
 */

import { MARS_R, degToRad, radToDeg } from '../lib/grid';
import { formatDuration, NBSP } from './format';
import type { LonLat } from './navigate';

export interface CrewMarker {
  id: string;
  lon: number;
  lat: number;
  /** Uncertainty circle radius, metres (from the telemetry adapter). */
  uncertaintyM: number;
}

export interface CrewMarkerModel {
  crew: CrewMarker[];
  /** True while the pair is past the separation limit. */
  separated: boolean;
  rover: { lon: number; lat: number; label: string } | null;
  /** The night way back, drawn as a corridor; null outside the night contingency. */
  returnLine: LonLat[] | null;
}

/** Point `metres` from `c` on `bearingDeg`, in the local equirectangular frame. */
export function offsetLonLat(c: LonLat, metres: number, bearingDeg: number): LonLat {
  const b = degToRad(bearingDeg);
  const north = metres * Math.cos(b);
  const east = metres * Math.sin(b);
  const lat = c.lat + radToDeg(north / MARS_R);
  const latMid = degToRad((c.lat + lat) / 2);
  return { lon: c.lon + radToDeg(east / (MARS_R * Math.cos(latMid))), lat };
}

/** A closed ring of `segments + 1` points at `radiusM` around `c`, clockwise from north. */
export function circleRing(c: LonLat, radiusM: number, segments = 48): LonLat[] {
  const ring: LonLat[] = [];
  for (let i = 0; i < segments; i++) ring.push(offsetLonLat(c, radiusM, (360 * i) / segments));
  ring.push(ring[0]);
  return ring;
}

/** Map label for an astronaut: id and the uncertainty radius. */
export function crewLabel(c: { id: string; uncertaintyM: number }): string {
  return `${c.id} ±${NBSP}${Math.round(c.uncertaintyM)}${NBSP}m`;
}

/** Map label for the rover: drive time to the crew, or the arrival clock once called. */
export function roverLabel(etaToCrewS: number | null, calledArrivalHhmm: string | null): string {
  if (calledArrivalHhmm) return `Rover · arrives ${calledArrivalHhmm}`;
  if (etaToCrewS === null) return 'Rover';
  return `Rover · ${formatDuration(etaToCrewS * 1000)} to crew`;
}

/**
 * Dev scenario only: moves every crew member after the lead `spreadM` east of
 * the lead, so the pair warning can be shown without walking apart.
 */
export function applyCrewSpread<T extends CrewMarker>(crew: T[], spreadM: number | null): T[] {
  if (spreadM === null || crew.length < 2) return crew;
  const lead = crew[0];
  return crew.map((c, i) => (i === 0 ? c : { ...c, ...offsetLonLat(lead, spreadM * i, 90) }));
}

/**
 * Which side each astronaut's map label sits on: away from the crew's mean longitude,
 * so a separated pair's labels never meet between them. Crew on the same meridian
 * alternate right, left. True means the label sits left of the ring.
 */
export function labelOnLeft(crew: LonLat[]): boolean[] {
  if (crew.length === 0) return [];
  const meanLon = crew.reduce((sum, c) => sum + c.lon, 0) / crew.length;
  return crew.map((c, i) => {
    const d = c.lon - meanLon;
    return Math.abs(d) < 1e-9 ? i % 2 === 1 : d < 0;
  });
}
