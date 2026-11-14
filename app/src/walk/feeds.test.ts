import { describe, expect, it } from 'vitest';
import { readySiteFeeds } from './feeds';

describe('readySiteFeeds', () => {
  it('keeps Jezero feeds unavailable instead of substituting Gale photos or chemistry', () => {
    const feeds = readySiteFeeds(null, null, null);

    expect(feeds).toEqual({
      status: 'ready',
      error: null,
      photos: [],
      photosAvailable: false,
      conditions: null,
      chemistry: [],
      chemistryAvailable: false,
    });
  });

  it('retains carried-over radiation when Jezero has no site weather', () => {
    const conditions = {
      radiation: {
        source: 'RAD measured at Gale and carried over for Jezero',
        surface_dose_mgy_per_day: 0.2877,
        solar_event_mgy_per_day: 1.4527,
        note: 'Not measured at Jezero.',
      },
    };

    expect(readySiteFeeds(null, conditions, null).conditions).toEqual({
      radiation: {
        source: 'RAD measured at Gale and carried over for Jezero',
        surface_dose_mgy_per_day: 0.2877,
        solar_event_mgy_per_day: 1.4527,
        note: 'Not measured at Jezero.',
      },
    });
  });
});
