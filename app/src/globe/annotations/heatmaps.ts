// Written with AI assistance, directed and reviewed by the team.
// The two headline heatmaps: shallow ice on when Explore opens, radiation one click away.

export interface Heatmap {
  id: string;
  label: string;
}

export const HEATMAPS: Heatmap[] = [
  { id: 'SWIM4MIM_Ci_0_1', label: 'Ice 0–1 m' },
  { id: 'dose_ugy_day', label: 'Radiation' },
];

/** Whole-planet layers on at open: the URL's list when it names one, else shallow ice. */
export function defaultGlobalOn(urlLayers: string[] | null): string[] {
  return urlLayers ?? [HEATMAPS[0].id];
}

/**
 * Layer states after choosing a heatmap: the chosen one on and the other headline heatmap
 * off; choosing the one already on turns it off. Other layers are left as they are.
 */
export function chooseHeatmap<S extends { enabled: boolean }>(states: Record<string, S>, id: string): Record<string, S> {
  const next = { ...states };
  const turnOn = !states[id]?.enabled;
  for (const h of HEATMAPS) {
    if (!next[h.id]) continue;
    next[h.id] = { ...next[h.id], enabled: h.id === id ? turnOn : false };
  }
  return next;
}
