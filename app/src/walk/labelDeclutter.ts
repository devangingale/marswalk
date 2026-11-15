// Written with AI assistance, directed and reviewed by the team.
import { MARS_R, degToRad } from '../lib/grid';
import type { CrewMarkerModel } from '../safety/crewMarkers';

/**
 * Walk's chase camera sits about 220 m from the walker, so a map label spans roughly
 * this many metres of ground. Two labels anchored closer than this overlap.
 */
export const LABEL_CLEAR_M = 60;

interface LonLat {
  lon: number;
  lat: number;
}

/** Ground distance in metres between two nearby points (local equirectangular). */
export function groundDistanceM(a: LonLat, b: LonLat): number {
  const latMid = degToRad((a.lat + b.lat) / 2);
  const east = degToRad(b.lon - a.lon) * MARS_R * Math.cos(latMid);
  const north = degToRad(b.lat - a.lat) * MARS_R;
  return Math.hypot(east, north);
}

/**
 * Walk map labels, lowest priority first out: the rover's label (its drive time to the
 * crew) is dropped while the rover is parked at the drop-off and the crew is within a
 * label's width of it. The drop-off label already names that point, the crew labels win
 * over both, and the rover's call and arrival stay in the Safety panel.
 */
export function declutterCrewLabels(model: CrewMarkerModel | null, dropOff: LonLat): CrewMarkerModel | null {
  if (!model?.rover || model.rover.label === '') return model;
  const rover = model.rover;
  const parked = groundDistanceM(rover, dropOff) < LABEL_CLEAR_M;
  const crewNear = model.crew.some((c) => groundDistanceM(c, rover) < LABEL_CLEAR_M);
  if (!parked && !crewNear) return model;
  return { ...model, rover: { ...rover, label: '' } };
}
