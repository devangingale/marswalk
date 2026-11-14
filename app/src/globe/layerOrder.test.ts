// Written with AI assistance, directed and reviewed by the team.
import { describe, expect, it } from 'vitest';
import type { ImageryLayer, ImageryLayerCollection } from 'cesium';
import { imageryLayerRank, orderImageryLayer } from './layerOrder';

describe('imageryLayerRank', () => {
  it('places each layer group at its fixed draw rank', () => {
    expect(imageryLayerRank('offline-basemap')).toBe(0);
    expect(imageryLayerRank('site-orbital')).toBe(100);
    expect(imageryLayerRank('temperature')).toBe(200);
    expect(imageryLayerRank('whole-planet', 0)).toBe(201);
    expect(imageryLayerRank('whole-planet', 3)).toBe(204);
    expect(imageryLayerRank('site-data', 0, 'slope')).toBe(1000);
  });

  it('keeps whole-planet layers in manifest order and site data in fixed category order', () => {
    expect([
      imageryLayerRank('temperature'),
      imageryLayerRank('whole-planet', 0),
      imageryLayerRank('whole-planet', 1),
      imageryLayerRank('whole-planet', 2),
      imageryLayerRank('whole-planet', 3),
      imageryLayerRank('site-data', 1, 'slope'),
      imageryLayerRank('site-data', 5, 'walkability'),
      imageryLayerRank('site-data', 2, 'bd1900_2'),
      imageryLayerRank('site-data', 4, 'thermal'),
    ]).toEqual([200, 201, 202, 203, 204, 1001, 1105, 1202, 1304]);
  });

  it('re-sorts layers after each add regardless of registration order', () => {
    const rows: ImageryLayer[] = [];
    const collection = {
      contains: (layer: ImageryLayer) => rows.includes(layer),
      indexOf: (layer: ImageryLayer) => rows.indexOf(layer),
      raise: (layer: ImageryLayer) => {
        const index = rows.indexOf(layer);
        if (index >= 0 && index < rows.length - 1) [rows[index], rows[index + 1]] = [rows[index + 1], rows[index]];
      },
    } as unknown as ImageryLayerCollection;
    const basemap = {} as ImageryLayer;
    const orbital = {} as ImageryLayer;
    const temperature = {} as ImageryLayer;
    const wholePlanet = {} as ImageryLayer;
    const slope = {} as ImageryLayer;

    for (const [layer, rank] of [
      [slope, imageryLayerRank('site-data', 1, 'slope')],
      [wholePlanet, imageryLayerRank('whole-planet', 0)],
      [temperature, imageryLayerRank('temperature')],
      [orbital, imageryLayerRank('site-orbital')],
      [basemap, imageryLayerRank('offline-basemap')],
    ] as const) {
      rows.push(layer);
      orderImageryLayer(collection, layer, rank);
    }

    expect(rows).toEqual([basemap, orbital, temperature, wholePlanet, slope]);
  });
});
