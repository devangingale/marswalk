const milestones = {
  ground: 's48:first-ground',
  imagery: 's48:first-site-imagery',
  frame: 's48:first-ground-imagery-frame',
} as const;

export type MapLoadMilestone = keyof typeof milestones;

export function markMapLoadMilestone(milestone: MapLoadMilestone): void {
  if (typeof performance === 'undefined' || performance.getEntriesByName(milestones[milestone], 'mark').length) return;
  performance.mark(milestones[milestone]);
}
