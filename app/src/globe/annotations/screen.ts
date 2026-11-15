// Written with AI assistance, directed and reviewed by the team.
// Screen-space thinning of points and greedy label placement, both pure.

export interface ScreenPoint {
  x: number;
  y: number;
  /** Higher wins a crowded cell or a contested label slot. */
  priority: number;
}

/**
 * One point per square cell of cellPx: the highest priority, then the earliest in input order.
 * Returns the kept indices in input order.
 */
export function thinPoints(points: ScreenPoint[], cellPx: number): number[] {
  const best = new Map<string, number>();
  points.forEach((p, i) => {
    const key = `${Math.floor(p.x / cellPx)}:${Math.floor(p.y / cellPx)}`;
    const held = best.get(key);
    if (held === undefined || p.priority > points[held].priority) best.set(key, i);
  });
  return [...best.values()].sort((a, b) => a - b);
}

/** Left, top, right, bottom in CSS pixels. */
export type Rect = [number, number, number, number];

export interface LabelBox {
  rect: Rect;
  priority: number;
}

const overlaps = (a: Rect, b: Rect) => a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3];

/**
 * Labels that can be drawn without overlapping each other or the blocked rects, placed
 * highest priority first (ties in input order). Returns the kept indices in input order.
 */
export function placeLabels(labels: LabelBox[], blocked: Rect[] = []): number[] {
  const order = labels.map((_, i) => i).sort((a, b) => labels[b].priority - labels[a].priority || a - b);
  const taken: Rect[] = [...blocked];
  const kept: number[] = [];
  for (const i of order) {
    const rect = labels[i].rect;
    if (taken.some((t) => overlaps(rect, t))) continue;
    taken.push(rect);
    kept.push(i);
  }
  return kept.sort((a, b) => a - b);
}
