// Written with AI assistance, directed and reviewed by the team.
import { describe, expect, it } from 'vitest';
import type { SiteLayer } from '../types';
import { syncImageryLayers } from './imageryLayers';

function layer(id: string, type: SiteLayer['type'] = 'raster', default_on = false): SiteLayer {
  return {
    id,
    title: id,
    kind: 'optical',
    type,
    url: `${id}.pmtiles`,
    resolution_m: 1,
    source: 'HiRISE',
    agency: 'NASA',
    units: null,
    legend: null,
    default_on,
  };
}

describe('syncImageryLayers', () => {
  it('adds every raster layer and sets show and alpha from the states', () => {
    const result = syncImageryLayers(new Map(), [layer('image'), layer('slope')], {
      image: { enabled: true, opacity: 1 },
      slope: { enabled: false, opacity: 0.7 },
    });
    expect(result).toEqual({
      add: ['image', 'slope'],
      remove: [],
      update: [
        { id: 'image', show: true, alpha: 1 },
        { id: 'slope', show: false, alpha: 0.7 },
      ],
    });
  });

  it('removes layers that the new site does not have', () => {
    const current = new Map([
      ['image', { show: true, alpha: 1 }],
      ['crism', { show: true, alpha: 0.5 }],
    ]);
    const result = syncImageryLayers(current, [layer('image')], { image: { enabled: true, opacity: 1 } });
    expect(result).toEqual({ add: [], remove: ['crism'], update: [] });
  });

  it('returns nothing to do when the state is unchanged', () => {
    const current = new Map([
      ['image', { show: true, alpha: 1 }],
      ['slope', { show: false, alpha: 0.7 }],
    ]);
    const result = syncImageryLayers(current, [layer('image'), layer('slope')], {
      image: { enabled: true, opacity: 1 },
      slope: { enabled: false, opacity: 0.7 },
    });
    expect(result).toEqual({ add: [], remove: [], update: [] });
  });

  it('updates only the layers whose show or alpha changed', () => {
    const current = new Map([
      ['image', { show: true, alpha: 1 }],
      ['slope', { show: false, alpha: 0.7 }],
    ]);
    const result = syncImageryLayers(current, [layer('image'), layer('slope')], {
      image: { enabled: true, opacity: 1 },
      slope: { enabled: true, opacity: 0.4 },
    });
    expect(result).toEqual({ add: [], remove: [], update: [{ id: 'slope', show: true, alpha: 0.4 }] });
  });

  it('never adds point layers as imagery', () => {
    const result = syncImageryLayers(new Map(), [layer('apxs', 'points', true), layer('image')], {
      apxs: { enabled: true, opacity: 1 },
      image: { enabled: true, opacity: 1 },
    });
    expect(result.add).toEqual(['image']);
    expect(result.update.map((u) => u.id)).toEqual(['image']);
  });

  it('falls back to default_on at full opacity for a layer without state', () => {
    const result = syncImageryLayers(new Map(), [layer('image', 'raster', true)], {});
    expect(result.update).toEqual([{ id: 'image', show: true, alpha: 1 }]);
  });
});
