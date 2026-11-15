// Written with AI assistance, directed and reviewed by the team.
// Which Mars Year the time slider opens on.

import type { DustYear } from './dustLayer';

export interface GaleDay {
  sol: number;
  earth_date: string;
  t_min_c: number | null;
  t_max_c: number | null;
  pressure_pa: number | null;
}

const hasReading = (d: GaleDay) => d.t_min_c !== null || d.t_max_c !== null || d.pressure_pa !== null;

/**
 * Index of the latest dust year whose Earth dates hold at least one Gale weather reading,
 * so the time bar opens with real values; the latest year when none does. Years are in
 * ascending order with ISO Earth dates.
 */
export function openingYearIndex(years: DustYear[], days: GaleDay[]): number {
  const dates = days.filter(hasReading).map((d) => d.earth_date);
  for (let i = years.length - 1; i >= 0; i--) {
    const first = years[i].sols[0]?.earth_date;
    const last = years[i].sols.at(-1)?.earth_date;
    if (first && last && dates.some((d) => d >= first && d <= last)) return i;
  }
  return years.length - 1;
}
