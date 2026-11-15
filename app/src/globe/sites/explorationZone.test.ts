// Written with AI assistance, directed and reviewed by the team.
import { describe, expect, it } from 'vitest';
import { Color } from 'cesium';
import { greatCircleKm } from '../annotations/geo';
import type { ValuesGrid } from '../layerManifest';
import {
  EXPLORATION_ZONE_CITATION,
  EXPLORATION_ZONE_RADIUS_KM,
  explorationZoneEntities,
  explorationZoneLabelPosition,
  geodesicCircle,
  geodesicDestination,
  queryCavesZone,
  queryHydratedHotspotsZone,
  queryIceZone,
  queryOtherSitesZone,
  queryRadiationZone,
  type HydratedHotspot,
} from './explorationZone';
import type { Site } from './types';

describe('Exploration Zone geometry', () => {
  it('defines the 100 km radius and NASA 2015 study citation', () => {
    expect(EXPLORATION_ZONE_RADIUS_KM).toBe(100);
    expect(EXPLORATION_ZONE_CITATION).toContain('NASA Human Landing Sites Study (2015)');
    expect(EXPLORATION_ZONE_CITATION).toContain('100 km');
  });

  it('computes exact destination coordinates on a Mars sphere', () => {
    // Due north from equator (0, 0)
    const [lonN, latN] = geodesicDestination(0, 0, 100, 0);
    expect(lonN).toBeCloseTo(0, 5);
    // 100 km on Mars radius 3396190 m is ~1.68706 degrees
    expect(latN).toBeCloseTo(1.68706, 4);
    expect(greatCircleKm(0, 0, lonN, latN)).toBeCloseTo(100, 3);

    // Due east from equator
    const [lonE, latE] = geodesicDestination(0, 0, 100, 90);
    expect(latE).toBeCloseTo(0, 5);
    expect(lonE).toBeCloseTo(1.68706, 4);
    expect(greatCircleKm(0, 0, lonE, latE)).toBeCloseTo(100, 3);

    // Due south from Gale (-4.6 lat, 137.4 lon)
    const [lonS, latS] = geodesicDestination(137.4, -4.6, 100, 180);
    expect(lonS).toBeCloseTo(137.4, 4);
    expect(latS).toBeLessThan(-4.6);
    expect(greatCircleKm(137.4, -4.6, lonS, latS)).toBeCloseTo(100, 3);
  });

  it('generates a closed 64-segment geodesic circle with every vertex within 1 metre of 100 km', () => {
    const ring = geodesicCircle(137.4, -4.6, 100, 64);
    expect(ring).toHaveLength(65);
    // Closed ring
    expect(ring[0][0]).toBe(ring[64][0]);
    expect(ring[0][1]).toBe(ring[64][1]);

    for (const [lon, lat] of ring) {
      const d = greatCircleKm(137.4, -4.6, lon, lat);
      expect(d).toBeCloseTo(100, 3); // within 0.001 km (1 m)
    }
  });

  it('positions perimeter label to prevent collision with site pins and tooltips', () => {
    // Low latitude: placed at northern perimeter (bearing 0)
    const [lonLow, latLow] = explorationZoneLabelPosition(10, 0, 100);
    expect(lonLow).toBeCloseTo(10, 4);
    expect(latLow).toBeGreaterThan(0);
    expect(greatCircleKm(10, 0, lonLow, latLow)).toBeCloseTo(100, 3);

    // High latitude (> 55° N): placed at southern perimeter (bearing 180) to avoid polar crowd
    const [lonHigh, latHigh] = explorationZoneLabelPosition(0, 60, 100);
    expect(lonHigh).toBeCloseTo(0, 4);
    expect(latHigh).toBeLessThan(60);
    expect(greatCircleKm(0, 60, lonHigh, latHigh)).toBeCloseTo(100, 3);
  });

  it('creates Cesium entities with outline, subtle fill and perimeter label', () => {
    const colours = {
      outline: Color.CYAN,
      fill: Color.CYAN.withAlpha(0.1),
      labelText: Color.WHITE,
      labelHalo: Color.BLACK,
    };
    const entities = explorationZoneEntities(137.4, -4.6, colours);
    expect(entities).toHaveLength(3);

    const fill = entities.find((e) => e.id === 'site-exploration-zone-fill');
    expect(fill).toBeDefined();
    expect(fill?.polygon).toBeDefined();

    const outline = entities.find((e) => e.id === 'site-exploration-zone-outline');
    expect(outline).toBeDefined();
    expect(outline?.polyline).toBeDefined();

    const label = entities.find((e) => e.id === 'site-exploration-zone-label');
    expect(label).toBeDefined();
    expect(label?.label?.text).toBe('Exploration Zone 100 km');
  });
});

describe('Exploration Zone in-zone queries', () => {
  it('formats cave candidate counts inside the 100 km zone', () => {
    expect(queryCavesZone(0)).toBe('No cave candidates');
    expect(queryCavesZone(1)).toBe('1 cave candidate');
    expect(queryCavesZone(4)).toBe('4 cave candidates');
    expect(queryCavesZone(12)).toBe('12 cave candidates');
  });

  function makeMockGrid(
    west: number,
    north: number,
    resDeg: number,
    width: number,
    height: number,
    values: number[][],
    scale = 1.0,
    offset = 0.0,
    nodata = 65535,
  ): ValuesGrid {
    const data = new Uint16Array(width * height);
    for (let r = 0; r < height; r++) {
      for (let c = 0; c < width; c++) {
        const val = values[r][c];
        if (val === nodata) {
          data[r * width + c] = nodata;
        } else {
          data[r * width + c] = Math.round((val - offset) / scale);
        }
      }
    }
    return {
      width,
      height,
      west,
      north,
      res_deg: resDeg,
      scale,
      offset,
      nodata,
      data,
    };
  }

  describe('queryIceZone', () => {
    it('uses fallback distance when SWIM grid is not yet loaded', () => {
      expect(queryIceZone(0, 0, null, 142)).toBe(
        'No ice signal within 100 km (nearest ice 142 km away)',
      );
      expect(queryIceZone(0, 0, null, 45.2)).toBe('Ice detected within 100 km (45 km away)');
      expect(queryIceZone(0, 0, null)).toBe('SWIM data loading…');
    });

    it('finds nearest and highest positive ice consistency within 100 km', () => {
      // 0.25° grid centered around (0, 0).
      // Row 0 is at lat +0.375, Row 1 at +0.125, Row 2 at -0.125, Row 3 at -0.375
      // Col 0 is at lon -0.375, Col 1 at -0.125, Col 2 at +0.125, Col 3 at +0.375
      // Distance from (0,0) to (+0.125, +0.125) is ~10.4 km.
      // Distance from (0,0) to (+0.375, +0.375) is ~31.3 km.
      const grid = makeMockGrid(
        -0.5,
        0.5,
        0.25,
        4,
        4,
        [
          [-0.5, -0.4, -0.2, -0.1],
          [-0.3, -0.1, 0.42, 0.25], // row 1, col 2 is +0.42 (~10 km away)
          [-0.2, 0.15, 0.88, 0.35], // row 2, col 2 is +0.88 (~10 km away, highest)
          [-0.1, 0.2, 0.3, 0.1],
        ],
        0.001,
        -1.0,
      );

      const result = queryIceZone(0, 0, grid);
      expect(result).toContain('Weak ice signal');
      expect(result).toContain('SWIM 0–1 m');
      expect(result).toContain('+0.42');
      expect(result).toContain('highest +0.88');
    });

    it('labels signals as likely ice when consistency is 0.5 or greater', () => {
      const grid = makeMockGrid(
        -0.5,
        0.5,
        0.25,
        4,
        4,
        [
          [-0.5, -0.4, -0.2, -0.1],
          [-0.3, -0.1, 0.75, 0.25],
          [-0.2, 0.15, 0.75, 0.35],
          [-0.1, 0.2, 0.3, 0.1],
        ],
        0.001,
        -1.0,
      );

      const result = queryIceZone(0, 0, grid);
      expect(result).toBe('Likely ice (SWIM 0–1 m, +0.75) at 10 km');
    });

    it('reports highest consistency when all cells within 100 km are negative (no ice)', () => {
      const grid = makeMockGrid(
        -0.5,
        0.5,
        0.25,
        4,
        4,
        [
          [-0.9, -0.8, -0.7, -0.6],
          [-0.8, -0.5, -0.35, -0.6], // highest is -0.35
          [-0.7, -0.6, -0.4, -0.7],
          [-0.9, -0.8, -0.7, -0.6],
        ],
        0.001,
        -1.0,
      );

      const result = queryIceZone(0, 0, grid);
      expect(result).toBe('No ice signal within 100 km (highest consistency −0.35)');
    });
  });

  describe('queryRadiationZone', () => {
    it('uses fallback dose when radiation grid is not loaded', () => {
      expect(queryRadiationZone(0, 0, null, 274.3)).toBe('~274 µGy/day (site average)');
      expect(queryRadiationZone(0, 0, null)).toBe('Radiation data loading…');
    });

    it('computes exact min and max radiation dose across cells in zone', () => {
      const grid = makeMockGrid(
        -0.5,
        0.5,
        0.25,
        4,
        4,
        [
          [260, 265, 270, 275],
          [262, 268, 274, 280],
          [265, 272, 278, 285],
          [270, 275, 282, 290],
        ],
        0.1,
        200,
      );

      const result = queryRadiationZone(0, 0, grid);
      expect(result).toBe('260–290 µGy/day');
    });
  });

  describe('queryHydratedHotspotsZone', () => {
    it('returns None when no hotspots are within 100 km', () => {
      const hotspots: HydratedHotspot[] = [
        { lon: 10, lat: 10, value: 500, title: 'Distant Clays' },
      ];
      expect(queryHydratedHotspotsZone(0, 0, hotspots)).toBe('None');
    });

    it('sorts and formats hotspots within 100 km by distance', () => {
      // Equator: 1 degree lon is ~59.27 km
      const hotspots: HydratedHotspot[] = [
        { lon: 0.7, lat: 0, value: 4200, title: 'Phyllosilicates (clays)' }, // ~41.5 km
        { lon: 1.4, lat: 0, value: 3100, title: 'Sulfates' }, // ~83.0 km
        { lon: 3.5, lat: 0, value: 1200, title: 'Carbonates' }, // ~207 km (outside 100 km)
      ];

      const result = queryHydratedHotspotsZone(0, 0, hotspots);
      expect(result).toBe('Phyllosilicates (clays) (41 km), Sulfates (83 km)');
      expect(result).not.toContain('Carbonates');
    });
  });

  describe('queryOtherSitesZone', () => {
    const currentSite = {
      id: 'current',
      name: 'Primary Site',
      lat: 0,
      lon: 0,
    } as Site;

    it('returns None when no other sites are within 100 km', () => {
      const other = {
        id: 'far',
        name: 'Far Site',
        lat: 10,
        lon: 10,
      } as Site;
      expect(queryOtherSitesZone(currentSite, [currentSite, other])).toBe('None');
    });

    it('excludes current site and lists neighboring sites sorted by distance', () => {
      const nearSite1 = {
        id: 'near1',
        name: 'Curiosity',
        lat: 0,
        lon: 0.5, // ~29.6 km
      } as Site;
      const nearSite2 = {
        id: 'near2',
        name: 'Gale East',
        lat: 0,
        lon: 0.25, // ~14.8 km
      } as Site;
      const farSite = {
        id: 'far',
        name: 'Jezero',
        lat: 0,
        lon: 3.0, // ~177 km
      } as Site;

      const result = queryOtherSitesZone(currentSite, [
        currentSite,
        nearSite1,
        nearSite2,
        farSite,
      ]);
      expect(result).toBe('Gale East (15 km), Curiosity (30 km)');
      expect(result).not.toContain('Primary Site');
      expect(result).not.toContain('Jezero');
    });
  });
});
