// Written with AI assistance, directed and reviewed by the team.
// MGC3 cave candidate type codes in plain language (Cushing & Okubo 2016, table C-4;
// docs/research/caves.md row 4). "con" and "smrp" are not defined in the catalog document.

export interface CaveType {
  label: string;
  /** An opening into the subsurface: drawn larger than the rest. */
  entry: boolean;
}

const TYPES: Record<string, CaveType> = {
  sky: { label: 'Skylight', entry: true },
  apc: { label: 'Atypical pit', entry: true },
  pit: { label: 'Pit', entry: true },
  pin: { label: 'Pinhole', entry: true },
  lat: { label: 'Cliff entrance', entry: true },
  srp: { label: 'Shallow pit', entry: false },
  crk: { label: 'Fracture', entry: false },
  flr: { label: 'Channel floor', entry: false },
  irr: { label: 'Irregular', entry: false },
  rim: { label: 'Pit rim', entry: false },
  end: { label: 'Channel end', entry: false },
  pol: { label: 'Polar ice', entry: false },
  kst: { label: 'Thermokarst', entry: false },
};

const UNCLASSIFIED: CaveType = { label: 'Unclassified', entry: false };

export function caveType(code: string): CaveType {
  return TYPES[code.toLowerCase()] ?? UNCLASSIFIED;
}
