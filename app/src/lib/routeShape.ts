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
 * `matchToleranceM` (default `toleranceM`) count as the same ground.
 * Vertices of the same leg are only matched if separated by > 3 * toleranceM
 * along the path (genuine revisits).
 */
export function sharedSegments(
  legs: PlanLeg[],
  origin: GridOrigin,
  toleranceM = 3,
  matchToleranceM = toleranceM
): SharedSegment[] {
  if (legs.length === 0) return [];
  const effectiveMatchToleranceM = Math.max(toleranceM, matchToleranceM);
  const revisitThresholdM = 3 * toleranceM;

  // Convert all legs to local points
  const rawLegs = legs.map((leg) => toLocalPoints(leg.line, origin));

  // Compute cumulative path distances and unit tangents for each leg
  const rawPathDists: number[][] = rawLegs.map((pts) => {
    const dists: number[] = [0];
    for (let i = 1; i < pts.length; i++) {
      dists.push(dists[i - 1] + distLocal(pts[i - 1], pts[i]));
    }
    return dists;
  });

  const rawTanX: Float64Array[] = [];
  const rawTanY: Float64Array[] = [];
  for (let l = 0; l < rawLegs.length; l++) {
    const pts = rawLegs[l];
    const n = pts.length;
    const tx = new Float64Array(n);
    const ty = new Float64Array(n);
    if (n >= 2) {
      for (let i = 0; i < n; i++) {
        let dx = 0;
        let dy = 0;
        if (i === 0) {
          dx = pts[1].x_m - pts[0].x_m;
          dy = pts[1].y_m - pts[0].y_m;
        } else if (i === n - 1) {
          dx = pts[n - 1].x_m - pts[n - 2].x_m;
          dy = pts[n - 1].y_m - pts[n - 2].y_m;
        } else {
          dx = pts[i + 1].x_m - pts[i - 1].x_m;
          dy = pts[i + 1].y_m - pts[i - 1].y_m;
        }
        const h = Math.hypot(dx, dy);
        if (h > 0) {
          tx[i] = dx / h;
          ty[i] = dy / h;
        }
      }
    }
    rawTanX.push(tx);
    rawTanY.push(ty);
  }

  // Compute leg bounding boxes to quickly bypass non-overlapping legs
  const legMinX = new Float64Array(rawLegs.length);
  const legMaxX = new Float64Array(rawLegs.length);
  const legMinY = new Float64Array(rawLegs.length);
  const legMaxY = new Float64Array(rawLegs.length);
  const legHasCandidateOverlap = new Uint8Array(rawLegs.length);

  for (let l = 0; l < rawLegs.length; l++) {
    let mnx = Infinity, mxx = -Infinity, mny = Infinity, mxy = -Infinity;
    const pts = rawLegs[l];
    for (let i = 0; i < pts.length; i++) {
      const x = pts[i].x_m;
      const y = pts[i].y_m;
      if (x < mnx) mnx = x;
      if (x > mxx) mxx = x;
      if (y < mny) mny = y;
      if (y > mxy) mxy = y;
    }
    legMinX[l] = mnx - effectiveMatchToleranceM;
    legMaxX[l] = mxx + effectiveMatchToleranceM;
    legMinY[l] = mny - effectiveMatchToleranceM;
    legMaxY[l] = mxy + effectiveMatchToleranceM;
  }

  for (let l2 = 0; l2 < rawLegs.length; l2++) {
    for (let l1 = 0; l1 < rawLegs.length; l1++) {
      if (l1 === l2) continue;
      if (
        legMinX[l1] <= legMaxX[l2] && legMaxX[l1] >= legMinX[l2] &&
        legMinY[l1] <= legMaxY[l2] && legMaxY[l1] >= legMinY[l2]
      ) {
        legHasCandidateOverlap[l2] = 1;
        break;
      }
    }
  }

  // Step 1: Project vertices onto segments to detect T-junctions or partial overlaps
  let totalRawV = 0;
  for (let l = 0; l < rawLegs.length; l++) {
    totalRawV += rawLegs[l].length;
  }

  const step1CellSize = Math.max(effectiveMatchToleranceM * 2, 10);
  const HASH_SIZE_1 = Math.max(1024, 1 << Math.ceil(Math.log2(totalRawV * 2 + 1)));
  const HASH_MASK_1 = HASH_SIZE_1 - 1;
  const head1 = new Int32Array(HASH_SIZE_1).fill(-1);
  const next1 = new Int32Array(totalRawV);
  const v1CX = new Int32Array(totalRawV);
  const v1CY = new Int32Array(totalRawV);
  const v1Leg = new Int32Array(totalRawV);
  const v1Idx = new Int32Array(totalRawV);
  const v1X = new Float64Array(totalRawV);
  const v1Y = new Float64Array(totalRawV);

  let rawVCount = 0;
  for (let l = 0; l < rawLegs.length; l++) {
    const pts = rawLegs[l];
    for (let i = 0; i < pts.length; i++) {
      const vid = rawVCount++;
      const p = pts[i];
      const cx = Math.floor(p.x_m / step1CellSize);
      const cy = Math.floor(p.y_m / step1CellSize);
      v1CX[vid] = cx;
      v1CY[vid] = cy;
      v1Leg[vid] = l;
      v1Idx[vid] = i;
      v1X[vid] = p.x_m;
      v1Y[vid] = p.y_m;

      const h = ((cx * 73856093) ^ (cy * 19349663)) & HASH_MASK_1;
      next1[vid] = head1[h];
      head1[h] = vid;
    }
  }

  interface SplitPoint extends LocalPoint {
    ux: number;
    uy: number;
  }
  const splitLegs: SplitPoint[][] = [];
  const tolSq = effectiveMatchToleranceM * effectiveMatchToleranceM;
  const projections: { t: number; x: number; y: number }[] = [];

  for (let l2 = 0; l2 < rawLegs.length; l2++) {
    const line = rawLegs[l2];
    if (line.length < 2 || legHasCandidateOverlap[l2] === 0) {
      splitLegs.push(line.map((p, idx) => ({ ...p, ux: rawTanX[l2][idx] ?? 0, uy: rawTanY[l2][idx] ?? 0 })));
      continue;
    }

    const t0x = rawTanX[l2][0];
    const t0y = rawTanY[l2][0];
    const newLine: SplitPoint[] = [{ ...line[0], ux: t0x, uy: t0y }];

    for (let s = 0; s < line.length - 1; s++) {
      const a = line[s];
      const b = line[s + 1];
      const dx = b.x_m - a.x_m;
      const dy = b.y_m - a.y_m;
      const segLenSq = dx * dx + dy * dy;

      if (segLenSq === 0) {
        newLine.push({ ...b, ux: rawTanX[l2][s + 1], uy: rawTanY[l2][s + 1] });
        continue;
      }
      const segLen = Math.sqrt(segLenSq);
      const invSegLenSq = 1 / segLenSq;
      const sUx = dx / segLen;
      const sUy = dy / segLen;

      const minX = Math.min(a.x_m, b.x_m) - effectiveMatchToleranceM;
      const maxX = Math.max(a.x_m, b.x_m) + effectiveMatchToleranceM;
      const minY = Math.min(a.y_m, b.y_m) - effectiveMatchToleranceM;
      const maxY = Math.max(a.y_m, b.y_m) + effectiveMatchToleranceM;

      const minCX = Math.floor(minX / step1CellSize);
      const maxCX = Math.floor(maxX / step1CellSize);
      const minCY = Math.floor(minY / step1CellSize);
      const maxCY = Math.floor(maxY / step1CellSize);

      projections.length = 0;

      for (let cx = minCX; cx <= maxCX; cx++) {
        for (let cy = minCY; cy <= maxCY; cy++) {
          const h = ((cx * 73856093) ^ (cy * 19349663)) & HASH_MASK_1;
          for (let vid = head1[h]; vid !== -1; vid = next1[vid]) {
            if (v1Leg[vid] === l2) continue;
            if (v1CX[vid] !== cx || v1CY[vid] !== cy) continue;

            const vx = v1X[vid];
            if (vx < minX || vx > maxX) continue;
            const vy = v1Y[vid];
            if (vy < minY || vy > maxY) continue;

            const cLeg = v1Leg[vid];
            const cIdx = v1Idx[vid];

            const isEndpoint = cIdx === 0 || cIdx === rawLegs[cLeg].length - 1;
            const cosAlign = Math.abs(rawTanX[cLeg][cIdx] * sUx + rawTanY[cLeg][cIdx] * sUy);

            if (!isEndpoint && cosAlign < 0.707) {
              continue;
            }

            if (isEndpoint) {
              const distA = Math.hypot(vx - a.x_m, vy - a.y_m);
              const distB = Math.hypot(vx - b.x_m, vy - b.y_m);
              if (distA <= effectiveMatchToleranceM || distB <= effectiveMatchToleranceM) {
                continue;
              }
            }

            const t = ((vx - a.x_m) * dx + (vy - a.y_m) * dy) * invSegLenSq;
            if (t > 1e-4 && t < 1 - 1e-4) {
              const projX = a.x_m + t * dx;
              const projY = a.y_m + t * dy;
              const ddx = vx - projX;
              const ddy = vy - projY;
              const distSq = ddx * ddx + ddy * ddy;
              if (distSq <= tolSq) {
                projections.push({ t, x: projX, y: projY });
              }
            }
          }
        }
      }

      if (projections.length > 0) {
        projections.sort((p1, p2) => p1.t - p2.t);
        let lastT = -1;
        for (let pi = 0; pi < projections.length; pi++) {
          const proj = projections[pi];
          if (proj.t - lastT > 1e-4) {
            const { lon, lat } = localMetresToLonLat(proj.x, proj.y, origin);
            newLine.push({ lon, lat, x_m: proj.x, y_m: proj.y, ux: sUx, uy: sUy });
            lastT = proj.t;
          }
        }
      }

      newLine.push({ ...b, ux: rawTanX[l2][s + 1], uy: rawTanY[l2][s + 1] });
    }

    splitLegs.push(newLine);
  }

  // Step 2: Cluster vertices within toleranceM, allowing matches only across
  // different legs or between genuine revisits on the same leg (> 3 * toleranceM).
  let totalV = 0;
  for (let l = 0; l < splitLegs.length; l++) {
    totalV += splitLegs[l].length;
  }

  const posX = new Float64Array(totalV);
  const posY = new Float64Array(totalV);
  const tanX = new Float64Array(totalV);
  const tanY = new Float64Array(totalV);
  const legOf = new Int32Array(totalV);
  const pathOf = new Float64Array(totalV);

  let vCounter = 0;
  for (let l = 0; l < splitLegs.length; l++) {
    const pts = splitLegs[l];
    let cumDist = 0;
    for (let i = 0; i < pts.length; i++) {
      if (i > 0) {
        cumDist += distLocal(pts[i - 1], pts[i]);
      }
      const id = vCounter++;
      posX[id] = pts[i].x_m;
      posY[id] = pts[i].y_m;
      tanX[id] = pts[i].ux;
      tanY[id] = pts[i].uy;
      legOf[id] = l;
      pathOf[id] = cumDist;
    }
  }

  const step2CellSize = Math.max(effectiveMatchToleranceM * 2, 10);
  const HASH_SIZE_2 = Math.max(1024, 1 << Math.ceil(Math.log2(totalV * 2 + 1)));
  const HASH_MASK_2 = HASH_SIZE_2 - 1;
  const head2 = new Int32Array(HASH_SIZE_2).fill(-1);
  const next2 = new Int32Array(totalV);
  const v2CX = new Int32Array(totalV);
  const v2CY = new Int32Array(totalV);

  for (let i = 0; i < totalV; i++) {
    const cx = Math.floor(posX[i] / step2CellSize);
    const cy = Math.floor(posY[i] / step2CellSize);
    v2CX[i] = cx;
    v2CY[i] = cy;
    const h = ((cx * 73856093) ^ (cy * 19349663)) & HASH_MASK_2;
    next2[i] = head2[h];
    head2[h] = i;
  }

  const maxPairs = totalV * 4;
  const pairU = new Int32Array(maxPairs);
  const pairV = new Int32Array(maxPairs);
  const pairDistSq = new Float64Array(maxPairs);
  let numPairs = 0;

  const uLocalV = new Int32Array(32);
  const uLocalDistSq = new Float64Array(32);

  for (let u = 0; u < totalV; u++) {
    const ux = posX[u];
    const uy = posY[u];
    const uLeg = legOf[u];
    const uPath = pathOf[u];

    const minCX = Math.floor((ux - effectiveMatchToleranceM) / step2CellSize);
    const maxCX = Math.floor((ux + effectiveMatchToleranceM) / step2CellSize);
    const minCY = Math.floor((uy - effectiveMatchToleranceM) / step2CellSize);
    const maxCY = Math.floor((uy + effectiveMatchToleranceM) / step2CellSize);

    let localCount = 0;

    for (let cx = minCX; cx <= maxCX; cx++) {
      for (let cy = minCY; cy <= maxCY; cy++) {
        const h = ((cx * 73856093) ^ (cy * 19349663)) & HASH_MASK_2;
        for (let vId = head2[h]; vId !== -1; vId = next2[vId]) {
          if (vId <= u) continue;
          if (v2CX[vId] !== cx || v2CY[vId] !== cy) continue;

          if (uLeg === legOf[vId]) {
            if (Math.abs(uPath - pathOf[vId]) <= revisitThresholdM) {
              continue;
            }
          }

          const dx = Math.abs(ux - posX[vId]);
          if (dx > effectiveMatchToleranceM) continue;
          const dy = Math.abs(uy - posY[vId]);
          if (dy > effectiveMatchToleranceM) continue;

          const distSq = dx * dx + dy * dy;
          if (distSq <= tolSq) {
            if (distSq > 0.25) {
              const cosAlign = Math.abs(tanX[u] * tanX[vId] + tanY[u] * tanY[vId]);
              if (cosAlign < 0.707) continue;
            }

            // Prune duplicate neighbours along the same pass of the other leg
            const vLeg = legOf[vId];
            const vPath = pathOf[vId];
            let foundPass = -1;
            for (let k = 0; k < localCount; k++) {
              const cand = uLocalV[k];
              if (legOf[cand] === vLeg && Math.abs(pathOf[cand] - vPath) <= revisitThresholdM) {
                foundPass = k;
                break;
              }
            }

            if (foundPass >= 0) {
              if (distSq < uLocalDistSq[foundPass]) {
                uLocalV[foundPass] = vId;
                uLocalDistSq[foundPass] = distSq;
              }
            } else if (localCount < 32) {
              uLocalV[localCount] = vId;
              uLocalDistSq[localCount] = distSq;
              localCount++;
            }
          }
        }
      }
    }

    for (let k = 0; k < localCount; k++) {
      if (numPairs < maxPairs) {
        pairU[numPairs] = u;
        pairV[numPairs] = uLocalV[k];
        pairDistSq[numPairs] = uLocalDistSq[k];
        numPairs++;
      }
    }
  }

  // Counting sort on pairDistSq (scaled to integer keys 0..9000)
  const pairOrder = new Int32Array(numPairs);
  const maxBucket = 9000;
  const bucketCounts = new Int32Array(maxBucket + 1);
  for (let i = 0; i < numPairs; i++) {
    const b = Math.min(maxBucket, (pairDistSq[i] * 1000) | 0);
    bucketCounts[b]++;
  }
  for (let i = 1; i <= maxBucket; i++) {
    bucketCounts[i] += bucketCounts[i - 1];
  }
  for (let i = numPairs - 1; i >= 0; i--) {
    const b = Math.min(maxBucket, (pairDistSq[i] * 1000) | 0);
    pairOrder[--bucketCounts[b]] = i;
  }

  const parent = new Int32Array(totalV);
  for (let i = 0; i < totalV; i++) parent[i] = i;

  function find(i: number): number {
    let root = i;
    while (parent[root] !== root) {
      root = parent[root];
    }
    let curr = i;
    while (curr !== root) {
      const nxt = parent[curr];
      parent[curr] = root;
      curr = nxt;
    }
    return root;
  }

  // Linked list for cluster members to avoid allocating array objects
  const clusterHead = new Int32Array(totalV);
  const clusterNext = new Int32Array(totalV);
  const clusterTail = new Int32Array(totalV);
  const clusterSize = new Int32Array(totalV);
  for (let i = 0; i < totalV; i++) {
    clusterHead[i] = i;
    clusterNext[i] = -1;
    clusterTail[i] = i;
    clusterSize[i] = 1;
  }

  for (let i = 0; i < numPairs; i++) {
    const pIdx = pairOrder[i];
    const u = pairU[pIdx];
    const v = pairV[pIdx];

    const rootU = find(u);
    const rootV = find(v);
    if (rootU === rootV) continue;

    const szU = clusterSize[rootU];
    const szV = clusterSize[rootV];

    if (szU === 1 && szV === 1) {
      const uMember = clusterHead[rootU];
      const vMember = clusterHead[rootV];
      if (legOf[uMember] === legOf[vMember]) {
        if (Math.abs(pathOf[uMember] - pathOf[vMember]) <= revisitThresholdM) {
          continue;
        }
      }
      parent[rootU] = rootV;
      clusterNext[clusterTail[rootV]] = uMember;
      clusterTail[rootV] = uMember;
      clusterSize[rootV] = 2;
      continue;
    }

    let conflict = false;
    for (let mU = clusterHead[rootU]; mU !== -1; mU = clusterNext[mU]) {
      const legU = legOf[mU];
      const pathU = pathOf[mU];
      for (let mV = clusterHead[rootV]; mV !== -1; mV = clusterNext[mV]) {
        if (legU === legOf[mV]) {
          if (Math.abs(pathU - pathOf[mV]) <= revisitThresholdM) {
            conflict = true;
            break;
          }
        }
      }
      if (conflict) break;
    }

    if (conflict) continue;

    if (szU < szV) {
      parent[rootU] = rootV;
      clusterNext[clusterTail[rootV]] = clusterHead[rootU];
      clusterTail[rootV] = clusterTail[rootU];
      clusterSize[rootV] = szU + szV;
    } else {
      parent[rootV] = rootU;
      clusterNext[clusterTail[rootU]] = clusterHead[rootV];
      clusterTail[rootU] = clusterTail[rootV];
      clusterSize[rootU] = szU + szV;
    }
  }

  const vertexToCluster = new Int32Array(totalV);
  const clusterSumX = new Float64Array(totalV);
  const clusterSumY = new Float64Array(totalV);
  const clusterCount = new Int32Array(totalV);

  for (let i = 0; i < totalV; i++) {
    const r = find(i);
    vertexToCluster[i] = r;
    clusterSumX[r] += posX[i];
    clusterSumY[r] += posY[i];
    clusterCount[r]++;
  }

  const centroidComputed = new Uint8Array(totalV);
  const centroidLon = new Float64Array(totalV);
  const centroidLat = new Float64Array(totalV);

  function getCentroid(r: number): [number, number] {
    if (centroidComputed[r]) {
      return [centroidLon[r], centroidLat[r]];
    }
    const { lon, lat } = localMetresToLonLat(clusterSumX[r] / clusterCount[r], clusterSumY[r] / clusterCount[r], origin);
    centroidLon[r] = lon;
    centroidLat[r] = lat;
    centroidComputed[r] = 1;
    return [lon, lat];
  }

  // Step 3: Convert each leg into a sequence of cluster IDs, removing consecutive duplicates
  let globalVIdx = 0;
  const legClusterSequences: number[][] = splitLegs.map((pts) => {
    const seq: number[] = [];
    for (let i = 0; i < pts.length; i++) {
      const c = vertexToCluster[globalVIdx++];
      if (seq.length === 0 || seq[seq.length - 1] !== c) {
        seq.push(c);
      }
    }
    return seq;
  });

  // Step 4: Map elementary edges between clusters
  interface UndirectedEdge {
    id: number;
    u: number;
    v: number;
    legs: number[];
    directions: ('fwd' | 'back')[];
    visited: boolean;
  }

  const undirectedEdges = new Map<number, UndirectedEdge>();
  let edgeIdCounter = 0;

  for (let l = 0; l < legClusterSequences.length; l++) {
    const seq = legClusterSequences[l];
    for (let i = 0; i < seq.length - 1; i++) {
      const from = seq[i];
      const to = seq[i + 1];
      if (from === to) continue;

      const u = Math.min(from, to);
      const v = Math.max(from, to);
      const key = u * 1000000 + v;
      const dir: 'fwd' | 'back' = from < to ? 'fwd' : 'back';

      let edge = undirectedEdges.get(key);
      if (!edge) {
        edge = { id: edgeIdCounter++, u, v, legs: [l], directions: [dir], visited: false };
        undirectedEdges.set(key, edge);
      } else {
        edge.legs.push(l);
        edge.directions.push(dir);
      }
    }
  }

  for (const edge of undirectedEdges.values()) {
    if (edge.legs.length === 2 && edge.legs[0] > edge.legs[1]) {
      const tmpL = edge.legs[0];
      edge.legs[0] = edge.legs[1];
      edge.legs[1] = tmpL;
      const tmpD = edge.directions[0];
      edge.directions[0] = edge.directions[1];
      edge.directions[1] = tmpD;
    } else if (edge.legs.length > 2) {
      const order = edge.legs.map((_, i) => i);
      order.sort((a, b) => edge.legs[a] - edge.legs[b]);
      edge.legs = order.map((i) => edge.legs[i]);
      edge.directions = order.map((i) => edge.directions[i]);
    }
  }

  // Step 5: Path decomposition into maximal stretches
  const allEdges = Array.from(undirectedEdges.values());
  const maxNodeId = totalV;
  const incDeg = new Int32Array(maxNodeId);
  const incEdge0 = new Int32Array(maxNodeId).fill(-1);
  const incEdge1 = new Int32Array(maxNodeId).fill(-1);
  const higherDegreeNodes = new Map<number, number[]>();

  for (let eIdx = 0; eIdx < allEdges.length; eIdx++) {
    const edge = allEdges[eIdx];
    const u = edge.u;
    const v = edge.v;

    // Node u
    if (incDeg[u] === 0) incEdge0[u] = eIdx;
    else if (incDeg[u] === 1) incEdge1[u] = eIdx;
    else {
      let list = higherDegreeNodes.get(u);
      if (!list) {
        list = [incEdge0[u], incEdge1[u]];
        higherDegreeNodes.set(u, list);
      }
      list.push(eIdx);
    }
    incDeg[u]++;

    // Node v
    if (incDeg[v] === 0) incEdge0[v] = eIdx;
    else if (incDeg[v] === 1) incEdge1[v] = eIdx;
    else {
      let list = higherDegreeNodes.get(v);
      if (!list) {
        list = [incEdge0[v], incEdge1[v]];
        higherDegreeNodes.set(v, list);
      }
      list.push(eIdx);
    }
    incDeg[v]++;
  }

  function canPassThrough(w: number): boolean {
    if (incDeg[w] !== 2) return false;
    const e1 = allEdges[incEdge0[w]];
    const e2 = allEdges[incEdge1[w]];
    if (e1.legs.length !== e2.legs.length) return false;

    for (let k = 0; k < e1.legs.length; k++) {
      if (e1.legs[k] !== e2.legs[k]) return false;
      const towards1 = w === e1.v ? e1.directions[k] === 'fwd' : e1.directions[k] === 'back';
      const towards2 = w === e2.v ? e2.directions[k] === 'fwd' : e2.directions[k] === 'back';
      if (towards1 === towards2) return false;
    }
    return true;
  }

  interface StretchRaw {
    nodes: number[];
    legs: number[];
    directions: ('fwd' | 'back')[];
  }
  const stretches: StretchRaw[] = [];

  // Walk edges in order of legs (allEdges) to discover maximal stretches
  for (let eIdx = 0; eIdx < allEdges.length; eIdx++) {
    const edge = allEdges[eIdx];
    if (edge.visited) continue;
    edge.visited = true;

    // Trace forward from edge.v
    const forwardNodes: number[] = [edge.v];
    let currNode = edge.v;
    let currEdge = edge;
    while (canPassThrough(currNode)) {
      const nextEIdx = incEdge0[currNode] === currEdge.id ? incEdge1[currNode] : incEdge0[currNode];
      const nextEdge = allEdges[nextEIdx];
      if (nextEdge.visited) break;
      nextEdge.visited = true;
      const nextNode = nextEdge.u === currNode ? nextEdge.v : nextEdge.u;
      forwardNodes.push(nextNode);
      currNode = nextNode;
      currEdge = nextEdge;
    }

    // Trace backward from edge.u
    const backwardNodes: number[] = [];
    currNode = edge.u;
    currEdge = edge;
    while (canPassThrough(currNode)) {
      const prevEIdx = incEdge0[currNode] === currEdge.id ? incEdge1[currNode] : incEdge0[currNode];
      const prevEdge = allEdges[prevEIdx];
      if (prevEdge.visited) break;
      prevEdge.visited = true;
      const prevNode = prevEdge.u === currNode ? prevEdge.v : prevEdge.u;
      backwardNodes.push(prevNode);
      currNode = prevNode;
      currEdge = prevEdge;
    }

    const pathNodes = [...backwardNodes.reverse(), edge.u, ...forwardNodes];
    stretches.push({
      nodes: pathNodes,
      legs: [...edge.legs],
      directions: [...edge.directions],
    });
  }

  // Canonicalize stretch direction: first leg (lowest index) is always 'fwd'
  const result: SharedSegment[] = stretches.map((s) => {
    const legIndices = s.legs.map((_, i) => i);
    legIndices.sort((a, b) => s.legs[a] - s.legs[b]);

    const sortedLegs = legIndices.map((i) => s.legs[i]);
    let sortedDirs = legIndices.map((i) => s.directions[i]);
    let nodes = [...s.nodes];

    if (sortedDirs[0] === 'back') {
      nodes.reverse();
      sortedDirs = sortedDirs.map((d) => (d === 'fwd' ? 'back' : 'fwd'));
    }

    const line = nodes.map((c) => getCentroid(c));
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
