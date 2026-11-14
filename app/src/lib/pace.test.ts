// Written with AI assistance, directed and reviewed by the team.

import { describe, it, expect } from 'vitest';
import {
  type SunEvents,
  deadline,
  startWindow,
  recommendedStart,
  paceCheck,
  temperatureAt,
  formatPace,
} from './pace';

const baseDate = (h: number, m: number, s = 0) => Date.UTC(2026, 10, 14, h, m, s);

describe('pace and daylight planning', () => {
  it('1. computes deadline, spare time, and pace format for standard plan', () => {
    // 6.3 km plan, walk 2 h 35 min + stops 1 h 00 min (total 3 h 35 min), depart 09:00, sunset 17:46, reserve 30 min, time limit 8 h:
    // deadline = 17:00 (time limit is earlier than 17:16); spare = 4 h 25 min; fits = true;
    // expected pace = 2h35m / 6.3 km = 1476.19... s/km -> formatPace "24:36 /km".
    const depart = baseDate(9, 0);
    const sunset = baseDate(17, 46);
    const reserveS = 1800; // 30 min
    const timeLimitS = 8 * 3600; // 8 h = 28800 s
    const walkDistanceM = 6300;
    const walkTimeS = 2 * 3600 + 35 * 60; // 9300 s
    const stopTimeS = 1 * 3600; // 3600 s

    const dl = deadline(sunset, depart, timeLimitS, reserveS);
    expect(dl).toBe(baseDate(17, 0));

    const check = paceCheck(walkDistanceM, walkTimeS, stopTimeS, depart, dl!);
    expect(check.fits).toBe(true);
    expect(check.spareS).toBe(4 * 3600 + 25 * 60); // 15900 s (4 h 25 min)
    expect(check.expectedSPerKm).toBeCloseTo(9300 / 6.3, 5);
    expect(check.requiredSPerKm).toBeCloseTo((28800 - 3600) / 6.3, 5); // 25200 / 6.3 = 4000
    expect(formatPace(check.expectedSPerKm)).toBe('24:36 /km');
  });

  it('2. evaluates deadline and spare when sunset is tight and plan does not fit', () => {
    // Same plan, sunset 12:00: deadline = 11:30; fits = false; spare = -1 h 05 min (-3900 s).
    const depart = baseDate(9, 0);
    const sunset = baseDate(12, 0);
    const reserveS = 1800;
    const timeLimitS = 8 * 3600;
    const walkDistanceM = 6300;
    const walkTimeS = 2 * 3600 + 35 * 60;
    const stopTimeS = 1 * 3600;

    const dl = deadline(sunset, depart, timeLimitS, reserveS);
    expect(dl).toBe(baseDate(11, 30));

    const check = paceCheck(walkDistanceM, walkTimeS, stopTimeS, depart, dl!);
    expect(check.fits).toBe(false);
    expect(check.spareS).toBe(-(1 * 3600 + 5 * 60)); // -3900 s (-1 h 05 min)
  });

  it('3. calculates start window with sunrise and sunset', () => {
    // startWindow with sunrise 05:58, sunset 17:46, total 3 h 35 min, limit 8 h: earliest 06:28, latest 13:41.
    const events: SunEvents = {
      polar: null,
      solStartUtcMs: baseDate(0, 0),
      sunriseUtcMs: baseDate(5, 58),
      sunsetUtcMs: baseDate(17, 46),
      sunriseLmst: 5.9667,
      sunsetLmst: 17.7667,
    };
    const totalTimeS = 2 * 3600 + 35 * 60 + 1 * 3600; // 3 h 35 min = 12900 s
    const limitS = 8 * 3600; // 28800 s

    const window = startWindow(events, totalTimeS, limitS);
    expect(window).not.toBeNull();
    expect(window!.earliestUtcMs).toBe(baseDate(6, 28));
    expect(window!.latestUtcMs).toBe(baseDate(13, 41));
  });

  it('4. returns null when total time exceeds daylight span or in polar night', () => {
    const events: SunEvents = {
      polar: null,
      solStartUtcMs: baseDate(0, 0),
      sunriseUtcMs: baseDate(5, 58),
      sunsetUtcMs: baseDate(17, 46),
      sunriseLmst: 5.9667,
      sunsetLmst: 17.7667,
    };
    // Daylight span is 17:46 - 05:58 = 11 h 48 min.
    // Minus reserve (30m) and sunriseMargin (30m) = 10 h 48 min max walk duration.
    // Total time 11 h exceeds daylight span:
    const exceedsDaylight = startWindow(events, 11 * 3600, 12 * 3600);
    expect(exceedsDaylight).toBeNull();

    // Total time exceeds EVA time limit:
    const exceedsLimit = startWindow(events, 9 * 3600, 8 * 3600);
    expect(exceedsLimit).toBeNull();

    // Polar night: sunrise and sunset both null
    const polarNight: SunEvents = {
      polar: 'night',
      solStartUtcMs: baseDate(0, 0),
      sunriseUtcMs: null,
      sunsetUtcMs: null,
      sunriseLmst: null,
      sunsetLmst: null,
    };
    expect(startWindow(polarNight, 3600, 28800)).toBeNull();
  });

  it('5. centres recommended start on warmest and clamps to window', () => {
    // recommendedStart centres on warmest 13:00 for a 3 h 35 min walk -> start 11:12:30,
    // and clamps to latest when the centred start would be later.
    const window = {
      earliestUtcMs: baseDate(6, 28),
      latestUtcMs: baseDate(13, 41),
    };
    const totalTimeS = 3 * 3600 + 35 * 60; // 12900 s
    const warmestUtcMs = baseDate(13, 0);

    const rec = recommendedStart(window, totalTimeS, warmestUtcMs);
    expect(rec).toBe(baseDate(11, 12, 30));

    // Centred start later than latest window -> clamps to latest
    const lateWarmest = baseDate(16, 0);
    const recLate = recommendedStart(window, totalTimeS, lateWarmest);
    expect(recLate).toBe(window.latestUtcMs);

    // Centred start earlier than earliest window -> clamps to earliest
    const earlyWarmest = baseDate(7, 0);
    const recEarly = recommendedStart(window, totalTimeS, earlyWarmest);
    expect(recEarly).toBe(window.earliestUtcMs);
  });

  it('6. produces half-cosine diurnal curve with min at sunrise and max at warmest', () => {
    // temperatureAt returns tMin at sunrise, tMax at warmestLmst, and a value strictly between them halfway.
    const tMin = -80;
    const tMax = -10;
    const sunriseLmst = 6;
    const warmestLmst = 13;

    expect(temperatureAt(sunriseLmst, tMin, tMax, sunriseLmst, warmestLmst)).toBeCloseTo(tMin, 5);
    expect(temperatureAt(warmestLmst, tMin, tMax, sunriseLmst, warmestLmst)).toBeCloseTo(tMax, 5);

    // Halfway during daytime rise: (6 + 13) / 2 = 9.5
    const halfwayRise = temperatureAt(9.5, tMin, tMax, sunriseLmst, warmestLmst);
    expect(halfwayRise).toBeGreaterThan(tMin);
    expect(halfwayRise).toBeLessThan(tMax);
    expect(halfwayRise).toBeCloseTo((tMin + tMax) / 2, 5);

    // Halfway during nighttime cooling: warmest (13) + (24 - (13 - 6)) / 2 = 13 + 8.5 = 21.5
    const halfwayFall = temperatureAt(21.5, tMin, tMax, sunriseLmst, warmestLmst);
    expect(halfwayFall).toBeGreaterThan(tMin);
    expect(halfwayFall).toBeLessThan(tMax);
    expect(halfwayFall).toBeCloseTo((tMin + tMax) / 2, 5);
  });

  it('handles polar day and formatting edges', () => {
    // Polar day: sun does not set (sunsetUtcMs === null).
    // Window is [sunrise + margin, earliest + (timeLimitS - totalTimeS)]
    const polarDay: SunEvents = {
      polar: 'day',
      solStartUtcMs: baseDate(4, 0),
      sunriseUtcMs: null,
      sunsetUtcMs: null,
      sunriseLmst: 4,
      sunsetLmst: null,
    };
    const totalTimeS = 3 * 3600; // 10800 s
    const limitS = 8 * 3600; // 28800 s
    const win = startWindow(polarDay, totalTimeS, limitS);
    expect(win).not.toBeNull();
    expect(win!.earliestUtcMs).toBe(baseDate(4, 0));
    expect(win!.latestUtcMs).toBe(baseDate(4, 0) + (limitS - totalTimeS) * 1000);

    // Deadline when sunset is null
    const dlNoSunset = deadline(null, baseDate(9, 0), 8 * 3600);
    expect(dlNoSunset).toBe(baseDate(17, 0));

    // formatPace
    expect(formatPace(0)).toBe('0:00 /km');
    expect(formatPace(1480)).toBe('24:40 /km');
    expect(formatPace(60)).toBe('1:00 /km');
  });
});
