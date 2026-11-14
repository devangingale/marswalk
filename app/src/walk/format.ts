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
  if (metres >= 1000) return `${(metres / 1000).toFixed(1)} km`;
  const rounded = metres < 100 ? Math.round(metres / 5) * 5 : Math.round(metres);
  return `${rounded} m`;
}

export function formatEnergy(kj: number): string {
  const rounded = Math.round(kj / 50) * 50;
  const grouped = String(rounded).replace(/\B(?=(\d{3})+(?!\d))/g, '\u00a0');
  return `${grouped} kJ`;
}

export function formatDose(mgy: number): string {
  if (mgy === 0) return '0 mGy';
  if (mgy < 0.001) return '< 0.001 mGy';
  return `${Number(mgy.toPrecision(2))} mGy`;
}

export function formatHeading(deg: number): string {
  const rounded = Math.round(deg) % 360;
  return `${rounded}° ${COMPASS_POINTS[Math.round(rounded / 45) % 8]}`;
}
