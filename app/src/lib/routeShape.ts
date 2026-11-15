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

/** Fork candidates within this distance are one junction; branches are combined. */
const FORK_MERGE_TOLERANCE_M = 10;
/** Ignore shorter baselines when reporting the steepest grade, to damp grid noise. */
const STEEPEST_MIN_RUN_M = 10;
/** Minimum stretch length in metres; runs shorter than this are absorbed into neighbours (hysteresis). */
export const MIN_STRETCH_M = 15;

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

function segmentDistanceSq(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number
): number {
  const dx = bx - ax;
  const dy = by - ay;
  const l2 = dx * dx + dy * dy;
  if (l2 === 0) return (px - ax) ** 2 + (py - ay) ** 2;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l2));
  const projX = ax + t * dx;
  const projY = ay + t * dy;
  return (px - projX) ** 2 + (py - projY) ** 2;
}

interface Run {
  state: boolean;
  startSeg: number;
  endSeg: number; // exclusive
  lenM: number;
}

/**
 * Splits the union of all leg lines into stretches; each stretch lists every
 * leg index that walks it and whether that leg walks it in the stretch's own
 * direction ('fwd') or reversed ('back'). Points of different legs within
 * `matchToleranceM` (default `toleranceM`) count as the same ground.
 * Vertices of the same leg are only matched if separated by > 3 * toleranceM
 * along the path (genuine revisits).
 *
 * Runs of shared/unshared ground shorter than MIN_STRETCH_M (15 m) whose state
 * differs from both neighbours are absorbed (hysteresis) to prevent fragmentation
 * of near-parallel out-and-back paths into micro-stretches.
 */
export function sharedSegments(
  legs: PlanLeg[],
  origin: GridOrigin,
  toleranceM = 3,
  matchToleranceM = toleranceM
): SharedSegment[] {
  if (legs.length === 0) return [];
  if (legs.length === 1) {
    return [
      {
        line: [...legs[0].line],
        legs: [0],
        directions: ['fwd'],
      },
    ];
  }

  const effectiveToleranceM = Math.max(toleranceM, matchToleranceM);
  const localLegs = legs.map((l) => toLocalPoints(l.line, origin));
  const tolSq = effectiveToleranceM * effectiveToleranceM;
  const revisitThresholdM = 3 * effectiveToleranceM;

  // Spatial hash grid for vertices to accelerate proximity queries
  let totalV = 0;
  for (const l of localLegs) totalV += l.length;
  const cellSize = Math.max(effectiveToleranceM * 2, 10);
  const HASH_SIZE = Math.max(1024, 1 << Math.ceil(Math.log2(totalV * 2 + 1)));
  const HASH_MASK = HASH_SIZE - 1;
  const head = new Int32Array(HASH_SIZE).fill(-1);
  const next = new Int32Array(totalV);
  const vX = new Float64Array(totalV);
  const vY = new Float64Array(totalV);
  const vLeg = new Int32Array(totalV);
  const vIdx = new Int32Array(totalV);

  // Cumulative distance along legs for genuine revisit threshold
  const legCumDists = localLegs.map((pts) => {
    const cd = [0];
    for (let i = 1; i < pts.length; i++) {
      cd.push(cd[i - 1] + distLocal(pts[i - 1], pts[i]));
    }
    return cd;
  });

  let vCounter = 0;
  for (let l = 0; l < localLegs.length; l++) {
    const pts = localLegs[l];
    for (let i = 0; i < pts.length; i++) {
      const vid = vCounter++;
      vX[vid] = pts[i].x_m;
      vY[vid] = pts[i].y_m;
      vLeg[vid] = l;
      vIdx[vid] = i;
      const cx = Math.floor(pts[i].x_m / cellSize);
      const cy = Math.floor(pts[i].y_m / cellSize);
      const h = ((cx * 73856093) ^ (cy * 19349663)) & HASH_MASK;
      next[vid] = head[h];
      head[h] = vid;
    }
  }

  // Classify each segment of each leg as shared or unshared
  const legRuns: Run[][] = [];

  for (let l = 0; l < localLegs.length; l++) {
    const pts = localLegs[l];
    const nSegs = pts.length - 1;
    if (nSegs <= 0) {
      legRuns.push([]);
      continue;
    }

    const segShared = new Uint8Array(nSegs);
    const segLens = new Float64Array(nSegs);
    let totalLegLen = 0;

    for (let s = 0; s < nSegs; s++) {
      const a = pts[s];
      const b = pts[s + 1];
      const midX = (a.x_m + b.x_m) / 2;
      const midY = (a.y_m + b.y_m) / 2;
      const len = Math.hypot(b.x_m - a.x_m, b.y_m - a.y_m);
      segLens[s] = len;
      totalLegLen += len;

      const minCX = Math.floor((Math.min(a.x_m, b.x_m) - effectiveToleranceM) / cellSize);
      const maxCX = Math.floor((Math.max(a.x_m, b.x_m) + effectiveToleranceM) / cellSize);
      const minCY = Math.floor((Math.min(a.y_m, b.y_m) - effectiveToleranceM) / cellSize);
      const maxCY = Math.floor((Math.max(a.y_m, b.y_m) + effectiveToleranceM) / cellSize);

      let isSh = false;
      for (let cx = minCX; cx <= maxCX && !isSh; cx++) {
        for (let cy = minCY; cy <= maxCY && !isSh; cy++) {
          const h = ((cx * 73856093) ^ (cy * 19349663)) & HASH_MASK;
          for (let vid = head[h]; vid !== -1; vid = next[vid]) {
            const oLeg = vLeg[vid];
            const oIdx = vIdx[vid];

            if (oLeg === l) {
              // Revisit check along same leg
              const sPath = legCumDists[l][s];
              const oPath = legCumDists[l][oIdx];
              if (Math.abs(sPath - oPath) <= revisitThresholdM) continue;
            }

            // Check distance from mid of segment to vertex vid
            const dx = midX - vX[vid];
            const dy = midY - vY[vid];
            if (dx * dx + dy * dy <= tolSq) {
              isSh = true;
              break;
            }

            // Also check segment-to-segment distance if adjacent vertex exists
            const oPts = localLegs[oLeg];
            if (oIdx < oPts.length - 1) {
              const d2 = segmentDistanceSq(
                midX,
                midY,
                oPts[oIdx].x_m,
                oPts[oIdx].y_m,
                oPts[oIdx + 1].x_m,
                oPts[oIdx + 1].y_m
              );
              if (d2 <= tolSq) {
                isSh = true;
                break;
              }
            }
          }
        }
      }

      if (isSh) segShared[s] = 1;
    }

    // Helper to get runs
    function getRuns(): Run[] {
      const runs: Run[] = [];
      for (let i = 0; i < nSegs; i++) {
        const state = segShared[i] === 1;
        const len = segLens[i];
        if (runs.length === 0 || runs.at(-1)!.state !== state) {
          runs.push({ state, startSeg: i, endSeg: i + 1, lenM: len });
        } else {
          runs.at(-1)!.endSeg = i + 1;
          runs.at(-1)!.lenM += len;
        }
      }
      return runs;
    }

    // Apply hysteresis if total leg length >= MIN_STRETCH_M
    if (totalLegLen >= MIN_STRETCH_M) {
      let changed = true;
      while (changed) {
        changed = false;
        const runs = getRuns();
        if (runs.length <= 1) break;

        // 1. Internal short runs (< MIN_STRETCH_M) whose state differs from both neighbours
        let flipped = false;
        for (let r = 1; r < runs.length - 1; r++) {
          const run = runs[r];
          if (run.lenM < MIN_STRETCH_M) {
            const prev = runs[r - 1];
            const next = runs[r + 1];
            if (prev.state === next.state && prev.state !== run.state) {
              const newState = prev.state ? 1 : 0;
              for (let s = run.startSeg; s < run.endSeg; s++) segShared[s] = newState;
              changed = true;
              flipped = true;
              break;
            }
          }
        }
        if (flipped) continue;

        // 2. End short runs
        const first = runs[0];
        if (first.lenM < MIN_STRETCH_M && runs.length > 1) {
          const newState = runs[1].state ? 1 : 0;
          for (let s = first.startSeg; s < first.endSeg; s++) segShared[s] = newState;
          changed = true;
          continue;
        }
        const last = runs.at(-1)!;
        if (last.lenM < MIN_STRETCH_M && runs.length > 1) {
          const newState = runs[runs.length - 2].state ? 1 : 0;
          for (let s = last.startSeg; s < last.endSeg; s++) segShared[s] = newState;
          changed = true;
          continue;
        }
      }
    }

    legRuns.push(getRuns());
  }

  // Build stretches from smoothed runs
  interface StretchDraft {
    line: [number, number][];
    legs: number[];
    directions: ('fwd' | 'back')[];
  }
  const result: StretchDraft[] = [];

  interface SharedCandidate {
    legIdx: number;
    startSeg: number;
    endSeg: number;
    pts: LocalPoint[];
    matched: boolean;
  }

  const sharedCandidates: SharedCandidate[] = [];
  const legSharedMap = new Map<number, SharedCandidate[]>();

  for (let l = 0; l < legs.length; l++) {
    const list: SharedCandidate[] = [];
    const runs = legRuns[l];
    for (const r of runs) {
      if (r.state) {
        const cand: SharedCandidate = {
          legIdx: l,
          startSeg: r.startSeg,
          endSeg: r.endSeg,
          pts: localLegs[l].slice(r.startSeg, r.endSeg + 1),
          matched: false,
        };
        sharedCandidates.push(cand);
        list.push(cand);
      }
    }
    legSharedMap.set(l, list);
  }

  // Emit stretches in order of route traversal across legs
  for (let l = 0; l < legs.length; l++) {
    let candIdx = 0;
    const legCands = legSharedMap.get(l) ?? [];
    const runs = legRuns[l];

    for (const r of runs) {
      if (!r.state) {
        // Unshared stretch
        const line = legs[l].line.slice(r.startSeg, r.endSeg + 1);
        if (line.length >= 2) {
          result.push({
            line,
            legs: [l],
            directions: ['fwd'],
          });
        }
      } else {
        const c1 = legCands[candIdx++];
        if (!c1 || c1.matched) continue;
        c1.matched = true;

        const matchedLegs = new Set<number>([c1.legIdx]);
        const dirSet = new Set<'fwd' | 'back'>(['fwd']);
        const c1Start = c1.pts[0];
        const c1End = c1.pts.at(-1)!;

        for (let j = 0; j < sharedCandidates.length; j++) {
          const c2 = sharedCandidates[j];
          if (c2.matched) continue;

          const c2Start = c2.pts[0];
          const c2End = c2.pts.at(-1)!;

          const matchDistLimit = Math.max(effectiveToleranceM * 4, MIN_STRETCH_M);
          const dStartStart = Math.hypot(c2Start.x_m - c1Start.x_m, c2Start.y_m - c1Start.y_m);
          const dEndEnd = Math.hypot(c2End.x_m - c1End.x_m, c2End.y_m - c1End.y_m);
          const isFwdMatch = dStartStart <= matchDistLimit && dEndEnd <= matchDistLimit;

          const dStartEnd = Math.hypot(c2Start.x_m - c1End.x_m, c2Start.y_m - c1End.y_m);
          const dEndStart = Math.hypot(c2End.x_m - c1Start.x_m, c2End.y_m - c1Start.y_m);
          const isBackMatch = dStartEnd <= matchDistLimit && dEndStart <= matchDistLimit;

          if (isFwdMatch || isBackMatch) {
            c2.matched = true;
            matchedLegs.add(c2.legIdx);
            if (isFwdMatch) dirSet.add('fwd');
            if (isBackMatch) dirSet.add('back');
          }
        }

        const line = legs[c1.legIdx].line.slice(c1.startSeg, c1.endSeg + 1);
        if (line.length >= 2) {
          result.push({
            line,
            legs: Array.from(matchedLegs).sort((a, b) => a - b),
            directions: Array.from(dirSet),
          });
        }
      }
    }
  }

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

  // Deduplicate endpoint observations within 10 m, independent of the much smaller
  // vertex tolerance used by callers such as the globe overlay.
  const uniqueEndpoints: [number, number][] = [];
  for (const pt of candidateEndpoints) {
    const ptM = lonlatToLocalMetres(pt[0], pt[1], origin);
    const existing = uniqueEndpoints.find((u) => {
      const uM = lonlatToLocalMetres(u[0], u[1], origin);
      return Math.hypot(ptM.x_m - uM.x_m, ptM.y_m - uM.y_m) <= FORK_MERGE_TOLERANCE_M;
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

    const branchTol = Math.max(toleranceM, FORK_MERGE_TOLERANCE_M);
    for (let l = 0; l < legs.length; l++) {
      const line = legs[l].line;
      for (let i = 0; i < line.length - 1; i++) {
        const vM = lonlatToLocalMetres(line[i][0], line[i][1], origin);
        if (Math.hypot(vM.x_m - epM.x_m, vM.y_m - epM.y_m) <= branchTol) {
          const nextM = lonlatToLocalMetres(line[i + 1][0], line[i + 1][1], origin);
          if (Math.hypot(nextM.x_m - epM.x_m, nextM.y_m - epM.y_m) > branchTol) {
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

      const isSameGround = usedAngles.some((a) => Math.abs(Math.atan2(Math.sin(a - angle), Math.cos(a - angle))) < 0.1);
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

  // Shared stretches can end at slightly different sampled points around one
  // narrow junction. Merge nearby fork records and preserve all branch labels.
  const mergedForks: ForkPoint[] = [];
  for (const fork of forks) {
    const point = lonlatToLocalMetres(fork.lon, fork.lat, origin);
    const existing = mergedForks.find((candidate) => {
      const other = lonlatToLocalMetres(candidate.lon, candidate.lat, origin);
      return Math.hypot(point.x_m - other.x_m, point.y_m - other.y_m) <= FORK_MERGE_TOLERANCE_M;
    });
    if (!existing) {
      mergedForks.push({ ...fork, branches: [...fork.branches] });
    } else {
      for (const branch of fork.branches) {
        if (!existing.branches.some((item) => item.legIndex === branch.legIndex && item.toLabel === branch.toLabel)) {
          existing.branches.push(branch);
        }
      }
    }
  }
  return mergedForks;
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
 * Elevations from grid.getElevation at each vertex's cell. `gradientDeg` remains
 * per segment; the steepest grade uses a baseline of at least 10 horizontal metres.
 */
export function slopeStats(
  line: [number, number][],
  grid: RouteGrid,
  minimumRunM = STEEPEST_MIN_RUN_M
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

  }

  for (let start = 0; start < line.length - 1; start++) {
    if (!Number.isFinite(elevations[start])) continue;
    const startM = grid.lonlatToLocalMetres(line[start][0], line[start][1]);
    for (let end = start + 1; end < line.length; end++) {
      if (!Number.isFinite(elevations[end])) break;
      const endM = grid.lonlatToLocalMetres(line[end][0], line[end][1]);
      const runM = Math.hypot(endM.x_m - startM.x_m, endM.y_m - startM.y_m);
      if (runM < minimumRunM) continue;
      // The intended baseline is the shortest one that reaches the minimum run.
      // Longer baselines add work without improving the noise floor.
      const grad = radToDeg(Math.atan((elevations[end] - elevations[start]) / runM));
      const absGrad = Math.abs(grad);
      if (steepestDeg === null || absGrad > steepestDeg) {
        steepestDeg = absGrad;
        let halfRun = runM / 2;
        let midX = startM.x_m;
        let midY = startM.y_m;
        for (let segment = start; segment < end; segment++) {
          const a = grid.lonlatToLocalMetres(line[segment][0], line[segment][1]);
          const b = grid.lonlatToLocalMetres(line[segment + 1][0], line[segment + 1][1]);
          const segmentM = Math.hypot(b.x_m - a.x_m, b.y_m - a.y_m);
          if (halfRun <= segmentM) {
            const fraction = segmentM > 0 ? halfRun / segmentM : 0;
            midX = a.x_m + fraction * (b.x_m - a.x_m);
            midY = a.y_m + fraction * (b.y_m - a.y_m);
            break;
          }
          halfRun -= segmentM;
        }
        const mid = grid.localMetresToLonLat(midX, midY);
        steepestAt = [mid.lon, mid.lat];
      }
      break;
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
