// Written with AI assistance, directed and reviewed by the team.

const COMPASS_POINTS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];

export function formatDuration(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  if (h > 0) return `${h} h ${String(m).padStart(2, '0')} min`;
  if (m > 0) return `${m} min`;
  return `${total} s`;
}

export function formatDistance(metres: number): string {
  if (metres >= 1000) return `${(metres / 1000).toFixed(2)} km`;
  return `${Math.round(metres)} m`;
}

export function formatEnergy(kj: number): string {
  return `${Math.round(kj)} kJ`;
}

export function formatDose(mgy: number): string {
  return `${mgy.toFixed(3)} mGy`;
}

export function formatHeading(deg: number): string {
  const rounded = Math.round(deg) % 360;
  return `${rounded}° ${COMPASS_POINTS[Math.round(rounded / 45) % 8]}`;
}
