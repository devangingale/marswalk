// Written with AI assistance, directed and reviewed by the team.
// Maps a site's veto reason ids to human labels and their cited source.

import { Veto } from './types';

const VETO_LABELS: Record<string, string> = {
  latitude: 'Latitude beyond ±50°',
  elevation: 'Elevation above +2 km (MOLA datum)',
  flat_area: 'No 25 km² patch below ~10° slope',
  elevation_no_data: 'Elevation data missing for the +2 km test',
  flat_area_no_data: 'Slope data missing for the flat-area test',
};

export interface VetoLine {
  label: string;
  source?: string;
}

/** The source id a "_no_data" reason is derived from, for citing the rule. */
function baseId(id: string): string {
  return id.replace(/_no_data$/, '');
}

/** Human label and cited source for each veto reason id on a site. */
export function vetoLines(reasons: string[], vetoes: Veto[]): VetoLine[] {
  return reasons.map((id) => {
    const cited = vetoes.find((v) => v.id === id) ?? vetoes.find((v) => v.id === baseId(id));
    return { label: VETO_LABELS[id] ?? id, source: cited?.source };
  });
}
