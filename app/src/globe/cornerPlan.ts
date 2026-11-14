// Written with AI assistance, directed and reviewed by the team.
// A synthetic plan inside the 500 m Gale sample corner, drawn by hand so that the route has
// shared ground walked both ways, two forks and a detour stop. For trying the route look only.
import { GridOrigin, localMetresToLonLat, lonlatToLocalMetres } from '../lib/grid';
import { densifyLine, type Plan, type PlanLeg } from '../lib/plan';

type XY = [number, number];

/** Waypoints in local metres from the corner origin (x east, y north). */
const D: XY = [250, 250]; // drop-off, the sample's default start
const E: XY = [250, 330]; // where the way out and the way home meet
const S1: XY = [330, 440];
const J: XY = [360, 420]; // spur junction
const S2: XY = [470, 170]; // out-and-back spur end
const S3: XY = [200, 120];

const LEGS: { from: string; to: string; path: XY[] }[] = [
  { from: 'start', to: 'c1', path: [D, E, S1] },
  { from: 'c1', to: 'c2', path: [S1, J, S2] },
  { from: 'c2', to: 'c3', path: [S2, J, S3] },
  { from: 'c3', to: 'start', path: [S3, [100, 90], [100, 330], E, D] },
];

/** Walking speed for the synthetic leg times, in metres per second. */
const PACE_M_S = 0.45;

export function buildCornerPlan(origin: GridOrigin, elevationAt?: (lon: number, lat: number) => number): Plan {
  const toLonLat = ([x, y]: XY): [number, number] => {
    const p = localMetresToLonLat(x, y, origin);
    return [Number(p.lon.toFixed(7)), Number(p.lat.toFixed(7))];
  };
  const legs: PlanLeg[] = LEGS.map(({ from, to, path }) => {
    const line = densifyLine(path.map(toLonLat), origin);
    let distance = 0;
    let climb = 0;
    let descent = 0;
    for (let i = 0; i < line.length - 1; i++) {
      const a = lonlatToLocalMetres(line[i][0], line[i][1], origin);
      const b = lonlatToLocalMetres(line[i + 1][0], line[i + 1][1], origin);
      distance += Math.hypot(b.x_m - a.x_m, b.y_m - a.y_m);
      const dz = elevationAt ? elevationAt(line[i + 1][0], line[i + 1][1]) - elevationAt(line[i][0], line[i][1]) : 0;
      if (dz > 0) climb += dz;
      else if (dz < 0) descent -= dz;
    }
    return {
      from,
      to,
      line,
      distance_m: Math.round(distance),
      time_s: Math.round(distance / PACE_M_S),
      climb_m: Math.round(climb || 0),
      descent_m: Math.round(descent || 0),
      energy_kj: 0,
      max_slope_deg: 0,
    };
  });
  const sum = (key: 'distance_m' | 'time_s' | 'climb_m' | 'descent_m') => legs.reduce((s, l) => s + l[key], 0);
  const [startLon, startLat] = toLonLat(D);
  const stop = (id: string, name: string, at: XY) => {
    const [lon, lat] = toLonLat(at);
    return { id, name, lon, lat };
  };
  return {
    version: 1,
    site: 'gale',
    params: {
      crew: 2,
      time_limit_s: 14400,
      suit_mass_kg: 60,
      body_mass_kg: 75,
      stop_time_s: 600,
      solar_event: false,
    },
    start: { lon: startLon, lat: startLat, label: 'Rover drop-off' },
    stops: [stop('c1', 'North outcrop', S1), stop('c2', 'East spur', S2), stop('c3', 'South bench', S3)],
    route: {
      legs,
      returns_to_start: true,
      totals: {
        distance_m: sum('distance_m'),
        time_s: sum('time_s'),
        climb_m: sum('climb_m'),
        descent_m: sum('descent_m'),
        energy_kj: 0,
        dose_mgy: 0,
      },
      turn_back: null,
      feasible: true,
      warnings: [],
    },
  };
}
