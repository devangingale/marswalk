// Written with AI assistance, directed and reviewed by the team.
// Layer panel structure: the This site and Whole planet sections, their group order and labels,
// how many layers each group has on, and which groups are open, remembered per tab.

export type LayerSection = 'site' | 'planet';

export interface GroupItem {
  /** Unique within the panel, such as site:slope or planet:dust_p95. */
  key: string;
  group: string;
  on: boolean;
}

export interface PanelGroup<T extends GroupItem = GroupItem> {
  /** Section-qualified id, such as planet:ice; the key for the remembered open state. */
  id: string;
  section: LayerSection;
  group: string;
  label: string;
  items: T[];
  onCount: number;
}

/** Site layer kinds, in panel order. Kinds not listed here follow thermal; Rover is always last. */
export const SITE_GROUP_ORDER = ['optical', 'topographic', 'spectral', 'thermal', 'rover'];

/** Whole-planet groups, in panel order. Groups not listed here go just before Other. */
export const PLANET_GROUP_ORDER = [
  'ice',
  'radiation',
  'dust',
  'thermal',
  'temperature',
  'caves',
  'geology',
  'minerals',
  'terrain',
  'other',
];

const SITE_LABELS: Record<string, string> = {
  optical: 'Optical',
  topographic: 'Topographic',
  spectral: 'Spectral',
  thermal: 'Thermal inertia',
  chemical: 'Chemistry',
  radiation: 'Radiation',
  atmospheric: 'Atmosphere',
  geologic: 'Geology',
  rover: 'Rover',
};

const PLANET_LABELS: Record<string, string> = {
  ice: 'Ice',
  radiation: 'Radiation',
  dust: 'Dust',
  thermal: 'Thermal inertia',
  temperature: 'Temperature',
  caves: 'Caves',
  geology: 'Geology',
  minerals: 'Minerals',
  terrain: 'Terrain',
  habitability: 'Site score',
  score: 'Site score',
  other: 'Other',
};

export function groupTitle(section: LayerSection, group: string): string {
  const labels = section === 'site' ? SITE_LABELS : PLANET_LABELS;
  return labels[group] ?? group.charAt(0).toUpperCase() + group.slice(1);
}

function rank(section: LayerSection, group: string): number {
  if (section === 'site') {
    if (group === 'rover') return 1000;
    const i = SITE_GROUP_ORDER.indexOf(group);
    return i >= 0 ? i : SITE_GROUP_ORDER.indexOf('thermal') + 0.5;
  }
  const i = PLANET_GROUP_ORDER.indexOf(group);
  return i >= 0 ? i : PLANET_GROUP_ORDER.indexOf('other') - 0.5;
}

/** Items gathered into ordered groups; within a group and among unlisted groups, first seen first. */
export function buildGroups<T extends GroupItem>(section: LayerSection, items: T[]): PanelGroup<T>[] {
  const groups: PanelGroup<T>[] = [];
  for (const item of items) {
    let entry = groups.find((g) => g.group === item.group);
    if (!entry) {
      entry = { id: `${section}:${item.group}`, section, group: item.group, label: groupTitle(section, item.group), items: [], onCount: 0 };
      groups.push(entry);
    }
    entry.items.push(item);
    if (item.on) entry.onCount += 1;
  }
  return groups
    .map((g, seen) => ({ g, seen }))
    .sort((a, b) => rank(section, a.g.group) - rank(section, b.g.group) || a.seen - b.seen)
    .map(({ g }) => g);
}

/** Disclosure text, such as Ice · 1 on, or just Ice when nothing in it is on. */
export function groupSummary(group: Pick<PanelGroup, 'label' | 'onCount'>): string {
  return group.onCount > 0 ? `${group.label} · ${group.onCount} on` : group.label;
}

/** Remembered choice first; otherwise a group starts open when one of its layers is on. */
export function isGroupOpen(remembered: Record<string, boolean>, group: Pick<PanelGroup, 'id' | 'onCount'>): boolean {
  const choice = remembered[group.id];
  return typeof choice === 'boolean' ? choice : group.onCount > 0;
}

const KEY = 's48.layerGroups.';

export function readOpenGroups(tab: string, storage: Pick<Storage, 'getItem'> | null): Record<string, boolean> {
  try {
    const raw = storage?.getItem(KEY + tab);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return Object.fromEntries(Object.entries(parsed).filter(([, v]) => typeof v === 'boolean')) as Record<string, boolean>;
  } catch {
    return {};
  }
}

export function writeOpenGroups(tab: string, state: Record<string, boolean>, storage: Pick<Storage, 'setItem'> | null): void {
  try {
    storage?.setItem(KEY + tab, JSON.stringify(state));
  } catch {
    // Private windows and blocked storage: groups still open and close, they just are not remembered.
  }
}

/** Short source for a whole-planet row, from the citation: the part before the first comma, semicolon or data. */
export function shortCitation(citation: string): string {
  const head = citation.split(/[,;(]| data\b/)[0].trim();
  return head.length > 32 ? `${head.slice(0, 31).trim()}…` : head;
}

/** Grid spacing for a whole-planet row, such as 0.25° grid. */
export function gridText(resDeg: number | undefined): string {
  return resDeg ? `${Number(resDeg.toFixed(3))}° grid` : '';
}
