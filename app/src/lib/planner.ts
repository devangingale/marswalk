// Written with AI assistance, directed and reviewed by the team.

/**
 * A* route planner for Marswalk.
 * Implements Contracts Section 3, 6, 7 and 10.
 *
 * Traverses the cost grid with 8-neighbor connectivity using true metre step lengths
 * and signed grade (uphill and downhill costs differ via the Pandolf-Santee model).
 * Never crosses impassable cells (cost = 255 or nodata).
 * If a stop is unreachable, sets feasible: false with a clear warning and never
 * routes through impassable terrain.
 */

import { RouteGrid } from './grid';
import { EnergyModelParams, evaluateStep, StepEvaluation } from './energy';

export interface RowCol {
  row: number;
  col: number;
}

export interface PathStepDetail {
  row: number;
  col: number;
  lon: number;
  lat: number;
  distanceM: number;
  timeS: number;
  climbM: number;
  descentM: number;
  energyKj: number;
  slopeDeg: number;
}

export interface LegPathResult {
  feasible: boolean;
  warning?: string;
  cells: RowCol[];
  steps: PathStepDetail[];
  distance_m: number;
  time_s: number;
  climb_m: number;
  descent_m: number;
  energy_kj: number;
  max_slope_deg: number;
}

class MinHeap {
  private data: { idx: number; f: number }[] = [];

  push(idx: number, f: number) {
    this.data.push({ idx, f });
    this.bubbleUp(this.data.length - 1);
  }

  pop(): { idx: number; f: number } | undefined {
    if (this.data.length === 0) return undefined;
    const top = this.data[0];
    const bottom = this.data.pop()!;
    if (this.data.length > 0) {
      this.data[0] = bottom;
      this.sinkDown(0);
    }
    return top;
  }

  get size(): number {
    return this.data.length;
  }

  private bubbleUp(n: number) {
    const elem = this.data[n];
    while (n > 0) {
      const parentN = (n - 1) >> 1;
      const parent = this.data[parentN];
      if (elem.f >= parent.f) break;
      this.data[parentN] = elem;
      this.data[n] = parent;
      n = parentN;
    }
  }

  private sinkDown(n: number) {
    const length = this.data.length;
    const elem = this.data[n];
    while (true) {
      const leftChildN = (n << 1) + 1;
      const rightChildN = leftChildN + 1;
      let swap = -1;
      let minF = elem.f;

      if (leftChildN < length) {
        const leftChild = this.data[leftChildN];
        if (leftChild.f < minF) {
          minF = leftChild.f;
          swap = leftChildN;
        }
      }

      if (rightChildN < length) {
        const rightChild = this.data[rightChildN];
        if (rightChild.f < minF) {
          swap = rightChildN;
        }
      }

      if (swap === -1) break;
      this.data[n] = this.data[swap];
      this.data[swap] = elem;
      n = swap;
    }
  }
}

const NEIGHBORS = [
  { dr: -1, dc: 0, isDiag: false },
  { dr: 1, dc: 0, isDiag: false },
  { dr: 0, dc: -1, isDiag: false },
  { dr: 0, dc: 1, isDiag: false },
  { dr: -1, dc: -1, isDiag: true },
  { dr: -1, dc: 1, isDiag: true },
  { dr: 1, dc: -1, isDiag: true },
  { dr: 1, dc: 1, isDiag: true },
];

/**
 * Finds the least-cost A* path between two grid cells.
 */
export function findPath(
  grid: RouteGrid,
  start: RowCol,
  goal: RowCol,
  params?: EnergyModelParams
): LegPathResult {
  const width = grid.width;
  const height = grid.height;
  const N = width * height;

  if (!grid.isInside(start.row, start.col)) {
    return makeFailureResult(`Start point (${start.row}, ${start.col}) is outside grid bounds.`);
  }
  if (!grid.isInside(goal.row, goal.col)) {
    return makeFailureResult(`Destination point (${goal.row}, ${goal.col}) is outside grid bounds.`);
  }
  if (!grid.isPassable(start.row, start.col)) {
    return makeFailureResult(`Start point is on impassable terrain.`);
  }
  if (!grid.isPassable(goal.row, goal.col)) {
    return makeFailureResult(`Destination is on impassable terrain.`);
  }

  const startIdx = start.row * width + start.col;
  const goalIdx = goal.row * width + goal.col;

  if (startIdx === goalIdx) {
    const { lon, lat } = grid.rowColToLonLat(start.row, start.col);
    return {
      feasible: true,
      cells: [start],
      steps: [
        {
          row: start.row,
          col: start.col,
          lon,
          lat,
          distanceM: 0,
          timeS: 0,
          climbM: 0,
          descentM: 0,
          energyKj: 0,
          slopeDeg: 0,
        },
      ],
      distance_m: 0,
      time_s: 0,
      climb_m: 0,
      descent_m: 0,
      energy_kj: 0,
      max_slope_deg: 0,
    };
  }

  const cell_x_m = grid.cell_x_m;
  const cell_y_m = grid.cell_y_m;
  const diag_m = Math.hypot(cell_x_m, cell_y_m);

  // Pre-calculate target local metres for admissible Euclidean heuristic
  const targetPos = grid.rowColToLocalMetres(goal.row, goal.col);

  // Minimum metabolic cost per metre on optimal terrain ~0.15 kJ/m
  const MIN_ENERGY_PER_METRE_KJ = 0.15;

  const gScore = new Float64Array(N);
  gScore.fill(Infinity);
  gScore[startIdx] = 0.0;

  const cameFrom = new Int32Array(N);
  cameFrom.fill(-1);

  const closed = new Uint8Array(N);
  const heap = new MinHeap();

  const h0 = Math.hypot(
    grid.rowColToLocalMetres(start.row, start.col).x_m - targetPos.x_m,
    grid.rowColToLocalMetres(start.row, start.col).y_m - targetPos.y_m
  ) * MIN_ENERGY_PER_METRE_KJ;

  heap.push(startIdx, h0);

  let found = false;

  while (heap.size > 0) {
    const current = heap.pop()!;
    const currIdx = current.idx;

    if (currIdx === goalIdx) {
      found = true;
      break;
    }

    if (closed[currIdx]) continue;
    closed[currIdx] = 1;

    const currRow = Math.floor(currIdx / width);
    const currCol = currIdx % width;
    const currElev = grid.getElevation(currRow, currCol);
    const currG = gScore[currIdx];

    for (const nb of NEIGHBORS) {
      const nr = currRow + nb.dr;
      const nc = currCol + nb.dc;

      if (nr < 0 || nr >= height || nc < 0 || nc >= width) continue;
      const nIdx = nr * width + nc;
      if (closed[nIdx]) continue;

      if (!grid.isPassable(nr, nc)) continue;

      // Prevent corner cutting if both orthogonal neighbors are impassable
      if (nb.isDiag) {
        const orth1Pass = grid.isPassable(currRow + nb.dr, currCol);
        const orth2Pass = grid.isPassable(currRow, currCol + nb.dc);
        if (!orth1Pass && !orth2Pass) continue;
      }

      const nextElev = grid.getElevation(nr, nc);
      if (Number.isNaN(nextElev)) continue;

      const dz = nextElev - currElev;
      const hDist = nb.isDiag ? diag_m : nb.dr !== 0 ? cell_y_m : cell_x_m;
      const multiplier = grid.getCostMultiplier(nr, nc);

      const step = evaluateStep(hDist, dz, multiplier, params);
      if (!step.passable) continue;

      const tentativeG = currG + step.energyKj;

      if (tentativeG < gScore[nIdx]) {
        gScore[nIdx] = tentativeG;
        cameFrom[nIdx] = currIdx;

        const nPos = grid.rowColToLocalMetres(nr, nc);
        const h = Math.hypot(nPos.x_m - targetPos.x_m, nPos.y_m - targetPos.y_m) * MIN_ENERGY_PER_METRE_KJ;
        heap.push(nIdx, tentativeG + h);
      }
    }
  }

  if (!found) {
    return makeFailureResult(`No passable route found to destination.`);
  }

  const pathIndices: number[] = [];
  let curr = goalIdx;
  while (curr !== -1) {
    pathIndices.push(curr);
    curr = cameFrom[curr];
  }
  pathIndices.reverse();

  const cells: RowCol[] = [];
  const steps: PathStepDetail[] = [];

  let totalDistM = 0;
  let totalTimeS = 0;
  let totalClimbM = 0;
  let totalDescentM = 0;
  let totalEnergyKj = 0;
  let maxSlopeDeg = 0;

  for (let i = 0; i < pathIndices.length; i++) {
    const idx = pathIndices[i];
    const r = Math.floor(idx / width);
    const c = idx % width;
    cells.push({ row: r, col: c });

    const { lon, lat } = grid.rowColToLonLat(r, c);

    if (i === 0) {
      steps.push({
        row: r,
        col: c,
        lon,
        lat,
        distanceM: 0,
        timeS: 0,
        climbM: 0,
        descentM: 0,
        energyKj: 0,
        slopeDeg: 0,
      });
    } else {
      const prevIdx = pathIndices[i - 1];
      const pr = Math.floor(prevIdx / width);
      const pc = prevIdx % width;

      const prevElev = grid.getElevation(pr, pc);
      const curElev = grid.getElevation(r, c);
      const dz = curElev - prevElev;
      const isDiag = pr !== r && pc !== c;
      const hDist = isDiag ? diag_m : pr !== r ? cell_y_m : cell_x_m;
      const multiplier = grid.getCostMultiplier(r, c);

      const step = evaluateStep(hDist, dz, multiplier, params);

      totalDistM += step.distance3dM;
      totalTimeS += step.timeS;
      if (dz > 0) totalClimbM += dz;
      else if (dz < 0) totalDescentM += Math.abs(dz);
      totalEnergyKj += step.energyKj;
      if (step.slopeDeg > maxSlopeDeg) maxSlopeDeg = step.slopeDeg;

      steps.push({
        row: r,
        col: c,
        lon,
        lat,
        distanceM: step.distance3dM,
        timeS: step.timeS,
        climbM: dz > 0 ? dz : 0,
        descentM: dz < 0 ? Math.abs(dz) : 0,
        energyKj: step.energyKj,
        slopeDeg: step.slopeDeg,
      });
    }
  }

  return {
    feasible: true,
    cells,
    steps,
    distance_m: totalDistM,
    time_s: totalTimeS,
    climb_m: totalClimbM,
    descent_m: totalDescentM,
    energy_kj: totalEnergyKj,
    max_slope_deg: maxSlopeDeg,
  };
}

function makeFailureResult(warning: string): LegPathResult {
  return {
    feasible: false,
    warning,
    cells: [],
    steps: [],
    distance_m: 0,
    time_s: 0,
    climb_m: 0,
    descent_m: 0,
    energy_kj: 0,
    max_slope_deg: 0,
  };
}
