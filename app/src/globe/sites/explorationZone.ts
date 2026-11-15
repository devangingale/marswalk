// Written with AI assistance, directed and reviewed by the team.
// Exploration Zone (EZ) geometry and in-zone data queries.
// NASA's 2015 Human Landing Site workshop defines the Exploration Zone as a ~100 km
// radius circle around a central landing site (docs/research/landing-sites.md rows 5 and 17).
// Citation: Bussey & Davis (2015), First Landing Site/Exploration Zone Workshop;
// Bussey & Hoffman (2016), IEEE Aerospace, p. 4 (2 crew, >= 200 km rover range assumption).

import {
  ArcType,
  Cartesian2,
  ClassificationType,
  Color,
  Entity,
  HeightReference,
  HorizontalOrigin,
  LabelStyle,
  PolygonHierarchy,
  VerticalOrigin,
} from 'cesium';
import { MARS_RADIUS_METERS } from '../../config';
import { greatCircleKm } from '../annotations/geo';
import { lonLatToCartesian } from '../frame';
import type { ValuesGrid } from '../layerManifest';
import { formatCount, formatDistanceKm, formatDose } from './format';
import type { Site } from './types';

/** 100 km Exploration Zone radius established by NASA's 2015 Human Landing Sites Study. */
export const EXPLORATION_ZONE_RADIUS_KM = 100;

/** Short citation for the site card and references. */
export const EXPLORATION_ZONE_CITATION =
  'NASA Human Landing Sites Study (2015), ~100 km rover radius';

const RAD = Math.PI / 180;

/** Point at distance radiusKm on bearing bearingDeg (clockwise from north) from center. */
export function geodesicDestination(
  lon0: number,
  lat0: number,
  radiusKm: number,
  bearingDeg: number,
): [number, number] {
  const delta = (radiusKm * 1000) / MARS_RADIUS_METERS;
  const phi0 = lat0 * RAD;
  const lam0 = lon0 * RAD;
  const theta = bearingDeg * RAD;

  const sinPhi0 = Math.sin(phi0);
  const cosPhi0 = Math.cos(phi0);
  const sinDelta = Math.sin(delta);
  const cosDelta = Math.cos(delta);

  const sinPhi = sinPhi0 * cosDelta + cosPhi0 * sinDelta * Math.cos(theta);
  const phi = Math.asin(Math.max(-1, Math.min(1, sinPhi)));
  const y = Math.sin(theta) * sinDelta * cosPhi0;
  const x = cosDelta - sinPhi0 * sinPhi;
  const lam = lam0 + Math.atan2(y, x);

  const lat = phi / RAD;
  const lon = ((((lam / RAD + 180) % 360) + 360) % 360) - 180;
  return [lon, lat];
}

/**
 * A closed geodesic circle of `segments + 1` [lon, lat] points at radiusKm around center.
 * Each vertex is at exact radiusKm great-circle distance from the center.
 */
export function geodesicCircle(
  centerLon: number,
  centerLat: number,
  radiusKm = EXPLORATION_ZONE_RADIUS_KM,
  segments = 64,
): [number, number][] {
  const ring: [number, number][] = [];
  for (let i = 0; i < segments; i++) {
    const bearing = (360 * i) / segments;
    ring.push(geodesicDestination(centerLon, centerLat, radiusKm, bearing));
  }
  ring.push(ring[0]);
  return ring;
}

/**
 * Label position for the 'Exploration Zone 100 km' label.
 * Sits on the circle perimeter (~100 km from center) so it does not collide with
 * the site pin, rank badges, or site hover tooltips at the center.
 */
export function explorationZoneLabelPosition(
  centerLon: number,
  centerLat: number,
  radiusKm = EXPLORATION_ZONE_RADIUS_KM,
): [number, number] {
  if (centerLat > 55) {
    return geodesicDestination(centerLon, centerLat, radiusKm, 180);
  }
  return geodesicDestination(centerLon, centerLat, radiusKm, 0);
}

export interface ExplorationZoneColours {
  outline: Color;
  fill: Color;
  labelText: Color;
  labelHalo: Color;
}

/** Cesium entities for the Exploration Zone: thin outline, subtle fill, and outer perimeter label. */
export function explorationZoneEntities(
  centerLon: number,
  centerLat: number,
  colours: ExplorationZoneColours,
  radiusKm = EXPLORATION_ZONE_RADIUS_KM,
): Entity.ConstructorOptions[] {
  const ring = geodesicCircle(centerLon, centerLat, radiusKm);
  const [labelLon, labelLat] = explorationZoneLabelPosition(centerLon, centerLat, radiusKm);
  const isSouth = centerLat > 55;

  const outline: Entity.ConstructorOptions = {
    id: 'site-exploration-zone-outline',
    name: 'Exploration Zone (100 km) Outline',
    polyline: {
      positions: ring.map(([lon, lat]) => lonLatToCartesian(lon, lat, 0)),
      width: 1.5,
      clampToGround: true,
      arcType: ArcType.GEODESIC,
      classificationType: ClassificationType.BOTH,
      material: colours.outline,
    },
  };

  const fill: Entity.ConstructorOptions = {
    id: 'site-exploration-zone-fill',
    name: 'Exploration Zone (100 km) Fill',
    polygon: {
      hierarchy: new PolygonHierarchy(ring.map(([lon, lat]) => lonLatToCartesian(lon, lat, 0))),
      material: colours.fill,
      classificationType: ClassificationType.BOTH,
    },
  };

  const label: Entity.ConstructorOptions = {
    id: 'site-exploration-zone-label',
    name: 'Exploration Zone (100 km) Label',
    position: lonLatToCartesian(labelLon, labelLat, 0),
    label: {
      text: 'Exploration Zone 100 km',
      font: '600 12px "Space Grotesk", sans-serif',
      fillColor: colours.labelText,
      outlineColor: colours.labelHalo,
      outlineWidth: 4,
      style: LabelStyle.FILL_AND_OUTLINE,
      horizontalOrigin: HorizontalOrigin.CENTER,
      verticalOrigin: isSouth ? VerticalOrigin.TOP : VerticalOrigin.BOTTOM,
      pixelOffset: new Cartesian2(0, isSouth ? 6 : -6),
      heightReference: HeightReference.CLAMP_TO_GROUND,
      disableDepthTestDistance: Number.POSITIVE_INFINITY,
    },
  };

  return [fill, outline, label];
}

// --- In-zone queries -----------------------------------------------------------------

export interface HydratedHotspot {
  lon: number;
  lat: number;
  value: number;
  title?: string;
  layerTitle?: string;
}

/** One-liner for cave candidates inside the zone (cave_count_zone). */
export function queryCavesZone(caveCount: number): string {
  if (caveCount <= 0) return 'No cave candidates';
  if (caveCount === 1) return '1 cave candidate';
  return `${formatCount(caveCount)} cave candidates`;
}

function formatConsistency(val: number): string {
  const sign = val > 0 ? '+' : val < 0 ? '−' : '';
  return `${sign}${Math.abs(val).toFixed(2)}`;
}

/** Iterates grid cells within radiusKm of centerLon, centerLat. */
function forEachCellInRadius(
  grid: ValuesGrid,
  centerLon: number,
  centerLat: number,
  radiusKm: number,
  fn: (val: number, distKm: number, lon: number, lat: number) => void,
): void {
  const deltaDeg = (radiusKm * 1000) / (MARS_RADIUS_METERS * RAD);
  const minLat = centerLat - deltaDeg;
  const maxLat = centerLat + deltaDeg;

  const minRow = Math.max(0, Math.floor((grid.north - maxLat) / grid.res_deg));
  const maxRow = Math.min(grid.height - 1, Math.floor((grid.north - minLat) / grid.res_deg));

  for (let row = minRow; row <= maxRow; row++) {
    const lat = grid.north - (row + 0.5) * grid.res_deg;
    const cosLat = Math.cos(Math.abs(lat) * RAD);
    const lonStepDeg = cosLat > 0.05 ? deltaDeg / cosLat : 180;
    const minLon = centerLon - lonStepDeg;
    const maxLon = centerLon + lonStepDeg;

    // Scan column range
    const minCol = Math.floor((minLon - grid.west) / grid.res_deg);
    const maxCol = Math.floor((maxLon - grid.west) / grid.res_deg);
    const span = Math.min(grid.width, maxCol - minCol + 1);

    for (let c = 0; c < span; c++) {
      const col = ((((minCol + c) % grid.width) + grid.width) % grid.width);
      const lon = grid.west + (col + 0.5) * grid.res_deg;
      const d = greatCircleKm(centerLon, centerLat, lon, lat);
      if (d <= radiusKm) {
        const raw = grid.data[row * grid.width + col];
        if (raw !== grid.nodata) {
          fn(raw * grid.scale + grid.offset, d, lon, lat);
        }
      }
    }
  }
}

/** Nearest and highest ice signal inside the circle (from the SWIM values grid). */
export function queryIceZone(
  centerLon: number,
  centerLat: number,
  swimGrid: ValuesGrid | null,
  iceDistKmFallback?: number,
  radiusKm = EXPLORATION_ZONE_RADIUS_KM,
): string {
  if (!swimGrid) {
    if (iceDistKmFallback !== undefined) {
      if (iceDistKmFallback > radiusKm) {
        return `No ice signal within ${radiusKm} km (nearest ice ${formatDistanceKm(iceDistKmFallback)} km away)`;
      }
      return `Ice detected within ${radiusKm} km (${formatDistanceKm(iceDistKmFallback)} km away)`;
    }
    return 'SWIM data loading…';
  }

  let highestVal = -Infinity;
  let highestDist = 0;
  let nearestIceDist = Infinity;
  let nearestIceVal = 0;
  let sampled = 0;

  forEachCellInRadius(swimGrid, centerLon, centerLat, radiusKm, (val, dist) => {
    sampled++;
    if (val > highestVal) {
      highestVal = val;
      highestDist = dist;
    }
    if (val > 0 && dist < nearestIceDist) {
      nearestIceDist = dist;
      nearestIceVal = val;
    }
  });

  if (sampled === 0) return `No SWIM coverage within ${radiusKm} km`;

  if (nearestIceDist !== Infinity) {
    const isWeak = nearestIceVal < 0.5;
    const signalLabel = isWeak ? 'Weak ice signal' : 'Likely ice';
    const hasDifferentHighest =
      highestVal > nearestIceVal &&
      (formatConsistency(highestVal) !== formatConsistency(nearestIceVal) ||
        formatDistanceKm(highestDist) !== formatDistanceKm(nearestIceDist));
    const highestSuffix = hasDifferentHighest
      ? `; highest ${formatConsistency(highestVal)} (${formatDistanceKm(highestDist)} km)`
      : '';
    return `${signalLabel} (SWIM 0–1 m, ${formatConsistency(nearestIceVal)}) at ${formatDistanceKm(nearestIceDist)} km${highestSuffix}`;
  }

  return `No ice signal within ${radiusKm} km (highest consistency ${formatConsistency(highestVal)})`;
}

/** Max and min radiation dose inside the circle (from the dose_ugy_day grid). */
export function queryRadiationZone(
  centerLon: number,
  centerLat: number,
  radGrid: ValuesGrid | null,
  fallbackDose?: number,
  radiusKm = EXPLORATION_ZONE_RADIUS_KM,
): string {
  if (!radGrid) {
    if (fallbackDose !== undefined) return `~${formatDose(fallbackDose)} µGy/day (site average)`;
    return 'Radiation data loading…';
  }

  let minVal = Infinity;
  let maxVal = -Infinity;
  let sampled = 0;

  forEachCellInRadius(radGrid, centerLon, centerLat, radiusKm, (val) => {
    sampled++;
    if (val < minVal) minVal = val;
    if (val > maxVal) maxVal = val;
  });

  if (sampled === 0) {
    if (fallbackDose !== undefined) return `~${formatDose(fallbackDose)} µGy/day (site average)`;
    return 'No radiation data in zone';
  }

  return `${formatDose(minVal)}–${formatDose(maxVal)} µGy/day`;
}

/** Hydrated mineral hotspots inside the 100 km circle. */
export function queryHydratedHotspotsZone(
  centerLon: number,
  centerLat: number,
  hotspots: HydratedHotspot[],
  radiusKm = EXPLORATION_ZONE_RADIUS_KM,
): string {
  const matches: { title: string; distanceKm: number }[] = [];
  for (const h of hotspots) {
    const d = greatCircleKm(centerLon, centerLat, h.lon, h.lat);
    if (d <= radiusKm) {
      const title = h.title || h.layerTitle || 'Hydrated mineral';
      matches.push({ title, distanceKm: d });
    }
  }

  if (matches.length === 0) return 'None';

  matches.sort((a, b) => a.distanceKm - b.distanceKm);
  return matches.map((m) => `${m.title} (${formatDistanceKm(m.distanceKm)} km)`).join(', ');
}

/** Other known and candidate landing sites inside the 100 km circle. */
export function queryOtherSitesZone(
  site: Site,
  allSites: Site[],
  radiusKm = EXPLORATION_ZONE_RADIUS_KM,
): string {
  const matches: { name: string; distanceKm: number }[] = [];
  for (const other of allSites) {
    if (other.id === site.id) continue;
    const d = greatCircleKm(site.lon, site.lat, other.lon, other.lat);
    if (d <= radiusKm) {
      matches.push({ name: other.name, distanceKm: d });
    }
  }

  if (matches.length === 0) return 'None';

  matches.sort((a, b) => a.distanceKm - b.distanceKm);
  return matches.map((m) => `${m.name} (${formatDistanceKm(m.distanceKm)} km)`).join(', ');
}
