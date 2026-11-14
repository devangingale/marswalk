// Written with AI assistance, directed and reviewed by the team.

/**
 * Human-readable display names for layers (replacing raw technical IDs / pipeline output).
 */
export const LAYER_DISPLAY_NAMES: Record<string, string> = {
  bd1900_2: 'Hydration (CRISM 1.9 µm)',
  d2300: 'Mg-OH clays (CRISM 2.3 µm)',
  thermal: 'Thermal inertia (THEMIS)',
  thermal_inertia: 'Thermal inertia (THEMIS)',
  walkability: 'Walkability (experimental)',
  image: 'Orbital image',
  slope: 'Slope',
  crism_minerals: 'Clay / Sulfate minerals',
  chemistry_apxs: 'APXS chemistry',
};

/**
 * Resolves a concise, human-friendly display name for a layer.
 */
export function getLayerDisplayName(layer: { id: string; title: string }): string {
  if (LAYER_DISPLAY_NAMES[layer.id]) {
    return LAYER_DISPLAY_NAMES[layer.id];
  }
  const lower = layer.title.toLowerCase();
  if (lower.includes('bd1900') || (lower.includes('1.9') && lower.includes('crism'))) {
    return 'Hydration (CRISM 1.9 µm)';
  }
  if (lower.includes('d2300') || (lower.includes('2.3') && lower.includes('crism'))) {
    return 'Mg-OH clays (CRISM 2.3 µm)';
  }
  if (lower.includes('thermal inertia') || lower.includes('themis')) {
    return 'Thermal inertia (THEMIS)';
  }
  if (lower.includes('walkability')) {
    return 'Walkability (experimental)';
  }
  return layer.title;
}

/**
 * Formats a layer's ground resolution for human reading.
 * Examples: 0.24912... -> 0.25 m, 1.0 -> 1 m, 100.0 -> 100 m, 181.27 -> 181 m.
 */
export function formatResolution(resM: number): string {
  if (!resM || resM <= 0) return '0 m';
  if (resM < 1) {
    const rounded = Number(resM.toPrecision(2));
    return `${rounded} m`;
  }
  if (resM >= 1000) {
    const km = resM / 1000;
    return `${km >= 10 ? Math.round(km) : Number(km.toFixed(1))} km`;
  }
  if (resM >= 10) {
    return `${Math.round(resM)} m`;
  }
  return `${Number(resM.toFixed(1))} m`;
}

/**
 * Concise source and agency mappings for the muted note line.
 */
export const LAYER_SHORT_SOURCES: Record<string, string> = {
  image: 'HiRISE · NASA',
  slope: 'HiRISE · NASA',
  bd1900_2: 'CRISM · NASA',
  d2300: 'CRISM · NASA',
  thermal: 'THEMIS · NASA',
  thermal_inertia: 'THEMIS · NASA/ASU',
  walkability: 'Curiosity path model · NASA',
  crism_minerals: 'CRISM · NASA/JHUAPL',
  chemistry_apxs: 'APXS, Curiosity · CSA / NASA',
};

/**
 * Resolves one short muted source/agency line for a layer row.
 */
export function getLayerSourceAgency(layer: { id: string; source: string; agency: string }): string {
  if (LAYER_SHORT_SOURCES[layer.id]) {
    return LAYER_SHORT_SOURCES[layer.id];
  }
  let src = layer.source || '';
  if (src.includes(';')) {
    src = src.split(';')[0].trim();
  }
  if (src.length > 30) {
    src = src.slice(0, 30).trim();
  }
  if (layer.agency && !src.includes(layer.agency)) {
    return `${src} · ${layer.agency}`;
  }
  return src;
}

/**
 * Formats numeric legend stops cleanly for human reading.
 * Uses real minus sign (U+2212) and avoids scientific clutter.
 */
export function formatLegendValue(val: number): string {
  if (val === 0) return '0';
  const abs = Math.abs(val);
  const sign = val < 0 ? '\u2212' : '';
  if (abs >= 100) {
    return `${sign}${Math.round(abs)}`;
  }
  if (abs >= 1) {
    return `${sign}${Number(abs.toFixed(1))}`;
  }
  return `${sign}${Number(abs.toFixed(2))}`;
}

/**
 * Formats units cleanly without long sentences or raw technical strings.
 */
export function cleanUnits(units: string | null | undefined): string {
  if (!units) return '';
  if (units === 'degrees') return '°';
  if (units === 'dimensionless band depth') return 'band depth';
  if (units.toLowerCase().includes('rover-preference') || units.toLowerCase().includes('score')) {
    return 'score';
  }
  if (units.includes('J m^-2 K^-1 s^-1/2')) return 'J m⁻² K⁻¹ s⁻¹/²';
  return units;
}
