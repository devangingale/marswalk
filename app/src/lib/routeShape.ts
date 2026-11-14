// Written with AI assistance, directed and reviewed by the team.

/**
 * Route shape and topological analysis for Marswalk.
 * Implements route line splitting, fork detection, sectioning with out-and-back detours,
 * directional chevrons, and elevation/slope statistics.
 *
 * All distances, slopes and areas use the local-metre frame from grid.ts
 * (Mars spherical radius 3396190 m).
 */

import {
  GridOrigin,
  localMetresToLonLat,
  lonlatToLocalMetres,
  radToDeg,
  RouteGrid,
} from './grid';
import { Plan, PlanLeg } from './plan';

export interface SharedSegment {
  line: [number, number][];
  legs: number[];
  directions: ('fwd' | 'back')[];
}

export interface ForkBranch {
  legIndex: number;
  toLabel: string;
}

export interface ForkPoint {
  lon: number;
  lat: number;
  branches: ForkBranch[];
}

export interface Section {
  id: string;
  fromStopId: string;
  toStopId: string;
  detourStopIds: string[];
  legIndices: number[];
}

export interface ChevronPosition {
  lon: number;
  lat: number;
  bearingDeg: number;
}

export interface SlopeStats {
  highM: number | null;
  highAt: [number, number] | null;
  lowM: number | null;
  lowAt: [number, number] | null;
  steepestDeg: number | null;
  steepestAt: [number, number] | null;
  climbM: number;
  descentM: number;
  gradientDeg: number[];
}

interface LocalPoint {
  lon: number;
  lat: number;
  x_m: number;
  y_m: number;
}

function toLocalPoints(line: [number, number][], origin: GridOrigin): LocalPoint[] {
  return line.map(([lon, lat]) => {
    const { x_m, y_m } = lonlatToLocalMetres(lon, lat, origin);
    return { lon, lat, x_m, y_m };
  });
}

function distLocal(p1: LocalPoint, p2: LocalPoint): number {
  return Math.hypot(p2.x_m - p1.x_m, p2.y_m - p1.y_m);
}

function polylineLengthM(line: [number, number][], origin: GridOrigin): number {
  if (line.length < 2) return 0;
  let len = 0;
  for (let i = 0; i < line.length - 1; i++) {
    const m1 = lonlatToLocalMetres(line[i][0], line[i][1], origin);
    const m2 = lonlatToLocalMetres(line[i + 1][0], line[i + 1][1], origin);
    len += Math.hypot(m2.x_m - m1.x_m, m2.y_m - m1.y_m);
  }
  return len;
}

function getToLabel(to: string): string {
  if (to.toLowerCase() === 'start') {
    return 'drop-off';
  }
  return to;
}

/**
 * Splits the union of all leg lines into stretches; each stretch lists every
 * leg index that walks it and whether that leg walks it in the stretch's own
 * direction ('fwd') or reversed ('back'). Points of different legs within
 * toleranceM (local metres) count as the same ground.
 */
export function sharedSegments(
  legs: PlanLeg[],
  origin: GridOrigin,
  toleranceM = 3
): SharedSegment[] {
  if (legs.length === 0) return [];

  // Convert all legs to local points
  const rawLegs = legs.map((leg) => toLocalPoints(leg.line, origin));

  // Step 1: Project vertices onto segments of other legs to detect T-junctions or partial overlaps
  const splitLegs: LocalPoint[][] = rawLegs.map((pts) => pts.map((p) => ({ ...p })));

  for (let l1 = 0; l1 < rawLegs.length; l1++) {
    for (const v of rawLegs[l1]) {
      for (let l2 = 0; l2 < splitLegs.length; l2++) {
        const line = splitLegs[l2];
        for (let s = 0; s < line.length - 1; s++) {
          const a = line[s];
          const b = line[s + 1];
          const dx = b.x_m - a.x_m;
          const dy = b.y_m - a.y_m;
          const segLenSq = dx * dx + dy * dy;
          if (segLenSq === 0) continue;

          const t = ((v.x_m - a.x_m) * dx + (v.y_m - a.y_m) * dy) / segLenSq;
          if (t > 1e-4 && t < 1 - 1e-4) {
            const projX = a.x_m + t * dx;
            const projY = a.y_m + t * dy;
            const dist = Math.hypot(v.x_m - projX, v.y_m - projY);
            if (dist <= toleranceM) {
              const { lon, lat } = localMetresToLonLat(projX, projY, origin);
              line.splice(s + 1, 0, { lon, lat, x_m: projX, y_m: projY });
              break;
            }
          }
        }
      }
    }
  }

  // Step 2: Cluster vertices within toleranceM
  const allVertices: LocalPoint[] = [];
  for (const pts of splitLegs) {
    for (const p of pts) {
      allVertices.push(p);
    }
  }

  // Connected components / disjoint-set
  const parent = allVertices.map((_, i) => i);
  function find(i: number): number {
    if (parent[i] === i) return i;
    parent[i] = find(parent[i]);
    return parent[i];
  }
  function union(i: number, j: number) {
    const rootI = find(i);
    const rootJ = find(j);
    if (rootI !== rootJ) {
      parent[rootJ] = rootI;
    }
  }

  for (let i = 0; i < allVertices.length; i++) {
    for (let j = i + 1; j < allVertices.length; j++) {
      if (distLocal(allVertices[i], allVertices[j]) <= toleranceM) {
        union(i, j);
      }
    }
  }

  // Assign cluster centroids
  const clusterMembers = new Map<number, LocalPoint[]>();
  let vertexIdx = 0;
  const vertexToCluster = new Map<LocalPoint, number>();

  for (const pts of splitLegs) {
    for (const p of pts) {
      const root = find(vertexIdx);
      if (!clusterMembers.has(root)) {
        clusterMembers.set(root, []);
      }
      clusterMembers.get(root)!.push(p);
      vertexToCluster.set(p, root);
      vertexIdx++;
    }
  }

  const clusterCentroid = new Map<number, [number, number]>();
  for (const [root, members] of clusterMembers.entries()) {
    let sumX = 0;
    let sumY = 0;
    for (const m of members) {
      sumX += m.x_m;
      sumY += m.y_m;
    }
    const avgX = sumX / members.length;
    const avgY = sumY / members.length;
    const { lon, lat } = localMetresToLonLat(avgX, avgY, origin);
    clusterCentroid.set(root, [lon, lat]);
  }

  // Step 3: Convert each leg into a sequence of cluster IDs, removing consecutive duplicates
  const legClusterSequences: number[][] = splitLegs.map((pts) => {
    const seq: number[] = [];
    for (const p of pts) {
      const c = vertexToCluster.get(p)!;
      if (seq.length === 0 || seq[seq.length - 1] !== c) {
        seq.push(c);
      }
    }
    return seq;
  });

  // Step 4: Map elementary edges between clusters
  interface UndirectedEdge {
    c1: number; // min(u, v)
    c2: number; // max(u, v)
    legs: number[];
    directions: ('fwd' | 'back')[];
  }

  const undirectedEdges = new Map<string, UndirectedEdge>();

  for (let l = 0; l < legClusterSequences.length; l++) {
    const seq = legClusterSequences[l];
    for (let i = 0; i < seq.length - 1; i++) {
      const from = seq[i];
      const to = seq[i + 1];
      if (from === to) continue;

      const c1 = Math.min(from, to);
      const c2 = Math.max(from, to);
      const key = `${c1}_${c2}`;

      const dir: 'fwd' | 'back' = from < to ? 'fwd' : 'back';

      let edge = undirectedEdges.get(key);
      if (!edge) {
        edge = { c1, c2, legs: [], directions: [] };
        undirectedEdges.set(key, edge);
      }
      edge.legs.push(l);
      edge.directions.push(dir);
    }
  }

  // Step 5: Merge elementary edges into maximal stretches
  interface Stretch {
    nodes: number[];
    legs: number[];
    directions: ('fwd' | 'back')[];
  }

  const activeStretches: Stretch[] = [];
  for (const edge of undirectedEdges.values()) {
    activeStretches.push({
      nodes: [edge.c1, edge.c2],
      legs: [...edge.legs],
      directions: [...edge.directions],
    });
  }

  let merged = true;
  while (merged) {
    merged = false;

    outer: for (let i = 0; i < activeStretches.length; i++) {
      for (let j = i + 1; j < activeStretches.length; j++) {
        const s1 = activeStretches[i];
        const s2 = activeStretches[j];

        // Must have the exact same set of legs and directions (up to stretch reversal)
        const s1Nodes = s1.nodes;
        const s2Nodes = s2.nodes;

        // Find potential shared endpoint
        const s1Start = s1Nodes[0];
        const s1End = s1Nodes[s1Nodes.length - 1];
        const s2Start = s2Nodes[0];
        const s2End = s2Nodes[s2Nodes.length - 1];

        let junction: number | null = null;
        let orientS1Forward = true;
        let orientS2Forward = true;

        if (s1End === s2Start) {
          junction = s1End;
          orientS1Forward = true;
          orientS2Forward = true;
        } else if (s1End === s2End) {
          junction = s1End;
          orientS1Forward = true;
          orientS2Forward = false;
        } else if (s1Start === s2Start) {
          junction = s1Start;
          orientS1Forward = false;
          orientS2Forward = true;
        } else if (s1Start === s2End) {
          junction = s1Start;
          orientS1Forward = false;
          orientS2Forward = false;
        }

        if (junction === null) continue;

        // Check if junction has any other incident stretches
        let junctionIncidentCount = 0;
        for (const s of activeStretches) {
          if (s.nodes[0] === junction) junctionIncidentCount++;
          if (s.nodes[s.nodes.length - 1] === junction) junctionIncidentCount++;
        }
        if (junctionIncidentCount !== 2) {
          // Junction has branching or degree != 2
          continue;
        }

        // Align S1 such that it ends at junction
        const alignedS1Nodes = orientS1Forward ? [...s1.nodes] : [...s1.nodes].reverse();
        const alignedS1Dirs = orientS1Forward
          ? [...s1.directions]
          : s1.directions.map((d) => (d === 'fwd' ? 'back' : 'fwd'));

        // Align S2 such that it starts at junction
        const alignedS2Nodes = orientS2Forward ? [...s2.nodes] : [...s2.nodes].reverse();
        const alignedS2Dirs = orientS2Forward
          ? [...s2.directions]
          : s2.directions.map((d) => (d === 'fwd' ? 'back' : 'fwd'));

        // Verify legs match exactly
        if (s1.legs.length !== s2.legs.length) continue;

        let legsCompatible = true;
        for (let idx = 0; idx < s1.legs.length; idx++) {
          const leg = s1.legs[idx];
          const dir1 = alignedS1Dirs[idx];
          const s2Idx = s2.legs.indexOf(leg);
          if (s2Idx === -1) {
            legsCompatible = false;
            break;
          }
          const dir2 = alignedS2Dirs[s2Idx];
          if (dir1 !== dir2) {
            legsCompatible = false;
            break;
          }
        }

        if (!legsCompatible) continue;

        // Merge s1 and s2
        const mergedNodes = [...alignedS1Nodes, ...alignedS2Nodes.slice(1)];
        const newStretch: Stretch = {
          nodes: mergedNodes,
          legs: [...s1.legs],
          directions: alignedS1Dirs,
        };

        activeStretches.splice(j, 1);
        activeStretches.splice(i, 1);
        activeStretches.push(newStretch);
        merged = true;
        break outer;
      }
    }
  }

  // Canonicalize stretch direction: first leg (lowest index) is always 'fwd'
  const result: SharedSegment[] = activeStretches.map((s) => {
    // Sort legs
    const legIndices = s.legs.map((_, i) => i);
    legIndices.sort((a, b) => s.legs[a] - s.legs[b]);

    const sortedLegs = legIndices.map((i) => s.legs[i]);
    let sortedDirs = legIndices.map((i) => s.directions[i]);
    let nodes = [...s.nodes];

    if (sortedDirs[0] === 'back') {
      nodes.reverse();
      sortedDirs = sortedDirs.map((d) => (d === 'fwd' ? 'back' : 'fwd'));
    }

    const line = nodes.map((c) => clusterCentroid.get(c)!);
    return {
      line,
      legs: sortedLegs,
      directions: sortedDirs,
    };
  });

  return result;
}

/**
 * A fork is where a shared stretch (2+ legs) ends and those legs continue
 * on different ground (split), or where separate legs join onto shared ground (merge).
 * Legs that merely cross at one point create NO fork.
 */
export function forkPoints(
  legs: PlanLeg[],
  origin: GridOrigin,
  toleranceM = 3
): ForkPoint[] {
  if (legs.length === 0) return [];

  const segments = sharedSegments(legs, origin, toleranceM);
  const shared = segments.filter((s) => s.legs.length >= 2);
  if (shared.length === 0) return [];

  // Identify all endpoints of shared stretches
  const candidateEndpoints: [number, number][] = [];
  for (const s of shared) {
    candidateEndpoints.push(s.line[0]);
    candidateEndpoints.push(s.line[s.line.length - 1]);
  }

  // Deduplicate endpoints within toleranceM
  const uniqueEndpoints: [number, number][] = [];
  for (const pt of candidateEndpoints) {
    const ptM = lonlatToLocalMetres(pt[0], pt[1], origin);
    const existing = uniqueEndpoints.find((u) => {
      const uM = lonlatToLocalMetres(u[0], u[1], origin);
      return Math.hypot(ptM.x_m - uM.x_m, ptM.y_m - uM.y_m) <= toleranceM;
    });
    if (!existing) {
      uniqueEndpoints.push(pt);
    }
  }

  const forks: ForkPoint[] = [];

  for (const ep of uniqueEndpoints) {
    const epM = lonlatToLocalMetres(ep[0], ep[1], origin);

    // Find all outgoing branches departing from ep across all legs
    const departingBranches: { legIndex: number; toLabel: string; nextLocal: { x: number; y: number } }[] = [];

    for (let l = 0; l < legs.length; l++) {
      const line = legs[l].line;
      for (let i = 0; i < line.length - 1; i++) {
        const vM = lonlatToLocalMetres(line[i][0], line[i][1], origin);
        if (Math.hypot(vM.x_m - epM.x_m, vM.y_m - epM.y_m) <= toleranceM) {
          const nextM = lonlatToLocalMetres(line[i + 1][0], line[i + 1][1], origin);
          if (Math.hypot(nextM.x_m - epM.x_m, nextM.y_m - epM.y_m) > toleranceM) {
            departingBranches.push({
              legIndex: l,
              toLabel: getToLabel(legs[l].to),
              nextLocal: { x: nextM.x_m, y: nextM.y_m },
            });
          }
        }
      }
    }

    // Check if departing branches diverge into different directions / ground
    const distinctDirectionBranches: { legIndex: number; toLabel: string }[] = [];
    const usedAngles: number[] = [];

    for (const br of departingBranches) {
      const dx = br.nextLocal.x - epM.x_m;
      const dy = br.nextLocal.y - epM.y_m;
      const angle = Math.atan2(dy, dx);

      const isSameGround = usedAngles.some((a) => Math.abs(a - angle) < 0.1);
      if (!isSameGround) {
        usedAngles.push(angle);
        distinctDirectionBranches.push({
          legIndex: br.legIndex,
          toLabel: br.toLabel,
        });
      }
    }

    if (distinctDirectionBranches.length >= 2) {
      distinctDirectionBranches.sort((a, b) => a.legIndex - b.legIndex);
      forks.push({
        lon: ep[0],
        lat: ep[1],
        branches: distinctDirectionBranches,
      });
    }
  }

  return forks;
}

/**
 * A section runs from one main stop (or the start) to the next main stop.
 * A stop is a detour when the leg into it and the leg out of it share ground
 * for at least 80 % of the shorter of the two legs (an out-and-back spur);
 * its two legs belong to the surrounding section.
 */
export function sections(
  plan: Plan,
  origin: GridOrigin
): Section[] {
  const legs = plan.route.legs;
  if (legs.length === 0) return [];

  const detourStopIdsSet = new Set<string>();

  for (const stop of plan.stops) {
    const intoLeg = legs.find((l) => l.to === stop.id);
    const outLeg = legs.find((l) => l.from === stop.id);

    if (intoLeg && outLeg) {
      const lenInto = polylineLengthM(intoLeg.line, origin);
      const lenOut = polylineLengthM(outLeg.line, origin);
      const shorter = Math.min(lenInto, lenOut);

      if (shorter > 0) {
        const segs = sharedSegments([intoLeg, outLeg], origin, 3);
        let sharedGroundM = 0;
        for (const s of segs) {
          if (s.legs.length === 2) {
            sharedGroundM += polylineLengthM(s.line, origin);
          }
        }

        const ratio = sharedGroundM / shorter;
        if (ratio >= 0.8) {
          detourStopIdsSet.add(stop.id);
        }
      }
    }
  }

  const mainStops = new Set(plan.stops.filter((s) => !detourStopIdsSet.has(s.id)).map((s) => s.id));

  const result: Section[] = [];
  let currentFrom = 'start';
  let currentLegs: number[] = [];
  let currentDetours: string[] = [];

  for (let i = 0; i < legs.length; i++) {
    const leg = legs[i];
    currentLegs.push(i);

    if (detourStopIdsSet.has(leg.to)) {
      if (!currentDetours.includes(leg.to)) {
        currentDetours.push(leg.to);
      }
    } else if (mainStops.has(leg.to) || leg.to.toLowerCase() === 'start') {
      result.push({
        id: `section-${result.length}`,
        fromStopId: currentFrom,
        toStopId: leg.to,
        detourStopIds: [...currentDetours],
        legIndices: [...currentLegs],
      });
      currentFrom = leg.to;
      currentLegs = [];
      currentDetours = [];
    }
  }

  if (currentLegs.length > 0) {
    result.push({
      id: `section-${result.length}`,
      fromStopId: currentFrom,
      toStopId: legs[legs.length - 1].to,
      detourStopIds: [...currentDetours],
      legIndices: [...currentLegs],
    });
  }

  return result;
}

/**
 * Points every spacingM along the line measured in local metres,
 * starting at spacingM/2; bearing clockwise from north in degrees.
 */
export function chevronPositions(
  line: [number, number][],
  origin: GridOrigin,
  spacingM = 150
): ChevronPosition[] {
  if (line.length < 2) return [];

  const pts = toLocalPoints(line, origin);
  const segDists: number[] = [];
  let totalLength = 0;

  for (let i = 0; i < pts.length - 1; i++) {
    const d = distLocal(pts[i], pts[i + 1]);
    segDists.push(d);
    totalLength += d;
  }

  if (totalLength < spacingM / 2) return [];

  const chevrons: ChevronPosition[] = [];
  let currentSegIdx = 0;
  let cumDist = 0;

  for (let targetD = spacingM / 2; targetD <= totalLength - spacingM / 2 + 1e-6; targetD += spacingM) {
    while (
      currentSegIdx < segDists.length - 1 &&
      cumDist + segDists[currentSegIdx] < targetD
    ) {
      cumDist += segDists[currentSegIdx];
      currentSegIdx++;
    }

    const segLen = segDists[currentSegIdx];
    const rem = targetD - cumDist;
    const frac = segLen > 0 ? rem / segLen : 0;

    const p1 = pts[currentSegIdx];
    const p2 = pts[currentSegIdx + 1];

    const x_m = p1.x_m + frac * (p2.x_m - p1.x_m);
    const y_m = p1.y_m + frac * (p2.y_m - p1.y_m);

    const { lon, lat } = localMetresToLonLat(x_m, y_m, origin);

    const dx = p2.x_m - p1.x_m;
    const dy = p2.y_m - p1.y_m;
    const bearingDeg = ((radToDeg(Math.atan2(dx, dy)) % 360) + 360) % 360;

    chevrons.push({
      lon,
      lat,
      bearingDeg,
    });
  }

  return chevrons;
}

/**
 * Elevations from grid.getElevation at each vertex's cell;
 * gradient per segment = atan(dz / horizontal local-metre distance);
 * steepestAt is the midpoint of the steepest segment.
 */
export function slopeStats(
  line: [number, number][],
  grid: RouteGrid
): SlopeStats {
  if (line.length === 0) {
    return {
      highM: null,
      highAt: null,
      lowM: null,
      lowAt: null,
      steepestDeg: null,
      steepestAt: null,
      climbM: 0,
      descentM: 0,
      gradientDeg: [],
    };
  }

  const elevations: number[] = [];
  for (const pt of line) {
    const rc = grid.lonlatToRowCol(pt[0], pt[1]);
    const elev = grid.getElevation(rc.row, rc.col);
    elevations.push(elev);
  }

  const finiteIndices = elevations.map((e, i) => Number.isFinite(e) ? i : -1).filter(i => i >= 0);
  let highM: number | null = finiteIndices.length ? elevations[finiteIndices[0]] : null;
  let highAt: [number, number] | null = finiteIndices.length ? line[finiteIndices[0]] : null;
  let lowM: number | null = highM;
  let lowAt: [number, number] | null = highAt;

  for (let i = 1; i < line.length; i++) {
    if (!Number.isFinite(elevations[i])) continue;
    if (highM === null || elevations[i] > highM) {
      highM = elevations[i];
      highAt = line[i];
    }
    if (lowM === null || elevations[i] < lowM) {
      lowM = elevations[i];
      lowAt = line[i];
    }
  }

  let climbM = 0;
  let descentM = 0;
  const gradientDeg: number[] = [];
  let steepestDeg: number | null = null;
  let steepestAt: [number, number] | null = null;

  for (let i = 0; i < line.length - 1; i++) {
    const p1_m = grid.lonlatToLocalMetres(line[i][0], line[i][1]);
    const p2_m = grid.lonlatToLocalMetres(line[i + 1][0], line[i + 1][1]);
    const hDist = Math.hypot(p2_m.x_m - p1_m.x_m, p2_m.y_m - p1_m.y_m);
    const dz = elevations[i + 1] - elevations[i];
    if (!Number.isFinite(dz)) { gradientDeg.push(NaN); continue; }

    if (dz > 0) {
      climbM += dz;
    } else if (dz < 0) {
      descentM += Math.abs(dz);
    }

    const grad = hDist > 0 ? radToDeg(Math.atan(dz / hDist)) : 0;
    gradientDeg.push(grad);

    const absGrad = Math.abs(grad);
    if (steepestDeg === null || absGrad > steepestDeg) {
      steepestDeg = absGrad;
      const mid = grid.localMetresToLonLat((p1_m.x_m + p2_m.x_m) / 2, (p1_m.y_m + p2_m.y_m) / 2);
      steepestAt = [mid.lon, mid.lat];
    }
  }

  return {
    highM,
    highAt,
    lowM,
    lowAt,
    steepestDeg,
    steepestAt,
    climbM,
    descentM,
    gradientDeg,
  };
}
