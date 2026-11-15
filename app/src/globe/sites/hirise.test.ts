import { describe, expect, it } from 'vitest';
import { HiriseIndex, hiriseFootprint, hiriseView, thumbCrop } from './hirise';

const INDEX: HiriseIndex = {
  version: 1,
  credit: 'NASA/JPL/University of Arizona',
  licence: 'Public domain: no copyright restriction on HiRISE images; credit requested',
  licence_url: 'https://www.uahirise.org/media/usage.php',
  sites: {
    'candidate-000003': {
      covered: true,
      name: 'Candidate 003',
      observation_id: 'ESP_051253_1750',
      product_id: 'ESP_051253_1750_RED',
      acquired: '2017-07-03',
      resolution_m_px: 0.25,
      browse_m_px: 3.39,
      emission_deg: 5.82,
      footprint: [
        [137.09, -4.8749],
        [137.008, -4.8848],
        [136.97, -4.58],
        [137.05, -4.57],
        [137.09, -4.8749],
      ],
      page_url: 'https://www.uahirise.org/ESP_051253_1750',
      image: 'hirise/candidate-000003.jpg',
      image_px: [2048, 5329],
      image_bytes: 1_860_000,
      site_px: [1014.3, 4611.1],
      observations_covering: 3,
      reason: 'Newest of 2 near-nadir RED products',
      credit: 'NASA/JPL/University of Arizona',
    },
    'landed-polar': {
      covered: true,
      name: 'Polar',
      observation_id: 'ESP_000001_2650',
      product_id: 'ESP_000001_2650_RED',
      acquired: '2010-01-02',
      resolution_m_px: 0.5,
      browse_m_px: 4,
      emission_deg: 1,
      footprint: [],
      page_url: 'https://www.uahirise.org/ESP_000001_2650',
      image: 'hirise/landed-polar.jpg',
      image_px: [1000, 2000],
      image_bytes: 1,
      site_px: null,
      observations_covering: 1,
      reason: '',
      credit: 'NASA/JPL/University of Arizona',
    },
    'candidate-000001': {
      covered: false,
      name: 'Candidate 001',
      reason: 'No HiRISE RDR V1.1 footprint in ODE contains the site point',
    },
  },
};

describe('hiriseView', () => {
  it('maps a covered site to the card fields', () => {
    expect(hiriseView(INDEX, 'candidate-000003', '/full-globe')).toEqual({
      kind: 'image',
      src: '/full-globe/hirise/candidate-000003.jpg',
      alt: 'HiRISE observation ESP_051253_1750 over Candidate 003',
      observationId: 'ESP_051253_1750',
      pageUrl: 'https://www.uahirise.org/ESP_051253_1750',
      date: '2017-07-03',
      resolution: '0.25 m/px (shown at 3.4 m/px)',
      credit: 'Image: NASA/JPL/University of Arizona',
      width: 2048,
      height: 5329,
      marker: { x: 49.5, y: 86.5 },
    });
  });

  it('has no marker when the site pixel is unknown', () => {
    const view = hiriseView(INDEX, 'landed-polar', '/g');
    expect(view?.kind === 'image' && view.marker).toBeNull();
    expect(view?.kind === 'image' && view.resolution).toBe('0.5 m/px (shown at 4.0 m/px)');
  });

  it('says so when no image covers the site', () => {
    expect(hiriseView(INDEX, 'candidate-000001', '/g')).toEqual({ kind: 'none' });
  });

  it('shows nothing for sites outside the index or without an index', () => {
    expect(hiriseView(INDEX, 'candidate-000200', '/g')).toBeNull();
    expect(hiriseView(null, 'candidate-000003', '/g')).toBeNull();
  });
});

describe('hiriseFootprint', () => {
  it('returns the ring of a covered site only', () => {
    expect(hiriseFootprint(INDEX, 'candidate-000003')).toHaveLength(5);
    expect(hiriseFootprint(INDEX, 'candidate-000003')?.[1]).toEqual([137.008, -4.8848]);
    expect(hiriseFootprint(INDEX, 'candidate-000001')).toBeNull();
    expect(hiriseFootprint(null, 'candidate-000003')).toBeNull();
  });
});

describe('thumbCrop', () => {
  it('centres a mid-image site in a 4:3 box', () => {
    // 1000 x 3000 image in a 4:3 box: shown 1000 wide, box height 750, image 3000 tall.
    expect(thumbCrop(1000, 3000, { x: 50, y: 50 }, 4 / 3)).toEqual({ position: '50% 50%', marker: { x: 50, y: 50 } });
  });

  it('centres an off-centre site vertically and keeps x where the image fills the width', () => {
    // Site 1/3 down: offset 375 - 1000 = -625 of a 2250 overflow -> 27.8 %.
    expect(thumbCrop(1000, 3000, { x: 20, y: 100 / 3 }, 4 / 3)).toEqual({ position: '50% 27.8%', marker: { x: 20, y: 50 } });
  });

  it('clamps at the image edge and moves the marker instead', () => {
    // Site 90 % down: the crop stops at the bottom; the marker sits at (2700 - 2250) / 750 = 60 %.
    expect(thumbCrop(1000, 3000, { x: 50, y: 90 }, 4 / 3)).toEqual({ position: '50% 100%', marker: { x: 50, y: 60 } });
  });

  it('falls back to the image centre without a marker', () => {
    expect(thumbCrop(1000, 3000, null, 4 / 3)).toEqual({ position: '50% 50%', marker: null });
  });
});
