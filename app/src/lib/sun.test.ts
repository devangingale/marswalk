// Written with AI assistance, directed and reviewed by the team.

import { describe, it, expect } from 'vitest';
import {
  marsSolarLongitude,
  localMeanSolarTime,
  localTrueSolarTime,
  sunElevationDeg,
  sunEvents,
  calculateMarsParameters,
  sunPosition,
  solStartAt,
  MARS_SOL_MS,
} from './sun';

describe('Mars24 Solar Times and Coordinates', () => {
  // Test 1: GISS worked example A (epoch 2000-01-06 00:00:00 UTC at 0°W 0°N)
  it('matches GISS worked example A intermediate values and solar parameters', () => {
    const millis = 947116800000; // 2000-01-06 00:00:00 UTC
    const latDeg = 0.0;
    const lonEastDeg = 0.0; // 0°W = 0°E

    const params = calculateMarsParameters(millis, latDeg, lonEastDeg);

    // Eq. A-1 & A-2: Julian Date (UT)
    expect(params.jdUt).toBeCloseTo(2451549.5, 5);

    // Eq. A-4: TT - UTC offset
    expect(params.ttMinusUtc).toBeCloseTo(64.184, 3);

    // Eq. A-5: Julian Date (TT)
    expect(params.jdTt).toBeCloseTo(2451549.50074, 5);

    // Eq. A-6: Delta t J2000
    expect(params.dtJ2000).toBeCloseTo(4.50074, 5);

    // Eq. B-1: Mars mean anomaly M
    expect(params.mDeg).toBeCloseTo(21.74558, 5);

    // Eq. B-2: Angle of Fictitious Mean Sun alpha_FMS
    expect(params.alphaFmsDeg).toBeCloseTo(272.74566, 5);

    // Eq. B-3: Perturbers PBS
    expect(params.pbsDeg).toBeCloseTo(0.00142, 5);

    // Eq. B-4: Equation of Center nu - M
    expect(params.nuMinusMDeg).toBeCloseTo(4.44193, 5);

    // Eq. B-5: Areocentric solar longitude Ls
    expect(params.lsDeg).toBeCloseTo(277.18758, 4);
    expect(marsSolarLongitude(millis)).toBeCloseTo(277.18758, 4);

    // Eq. C-1: Equation of Time EOT
    expect(params.eotDeg).toBeCloseTo(-5.18774, 4);
    expect(params.eotHours).toBeCloseTo(-0.34585, 4);

    // Eq. C-2: Mean Solar Time at prime meridian MST
    expect(params.mstHours).toBeCloseTo(23.99425, 5);

    // Eq. C-3: Local Mean Solar Time LMST
    expect(params.lmstHours).toBeCloseTo(23.99425, 5);
    expect(localMeanSolarTime(millis, lonEastDeg)).toBeCloseTo(23.99425, 5);

    // Eq. C-4: Local True Solar Time LTST
    expect(params.ltstHours).toBeCloseTo(23.6484, 4);
    expect(localTrueSolarTime(millis, lonEastDeg)).toBeCloseTo(23.6484, 4);

    // Eq. C-5: Subsolar longitude Lambda_s (deg West)
    expect(params.subsolarLonWestDeg).toBeCloseTo(174.726, 4);

    // Eq. D-1: Solar declination delta_s
    expect(params.subsolarLatDeg).toBeCloseTo(-25.22825, 4);

    // Eq. D-2: Heliocentric distance RM
    expect(params.rMAu).toBeCloseTo(1.39358, 5);

    // Eq. D-3: Heliocentric longitude lM
    expect(params.lMDeg).toBeCloseTo(2.26352, 4);

    // Eq. D-4: Heliocentric latitude bM
    expect(params.bMDeg).toBeCloseTo(-1.35957, 5);

    // Eq. D-5: Zenith angle Z & Solar Elevation
    expect(params.zenithDeg).toBeCloseTo(154.26182, 3);
    expect(sunElevationDeg(millis, latDeg, lonEastDeg)).toBeCloseTo(90.0 - 154.26182, 3);

    // Eq. D-6: Solar azimuth A
    expect(params.azimuthDeg).toBeCloseTo(191.03905, 4);
  });

  // Test 2: GISS worked example B (Spirit landing epoch Jan 3, 2004 13:46:31 UTC at 184.702°W -14.640°N)
  it('matches GISS worked example B intermediate values and solar parameters', () => {
    const millis = 1073137591000; // 2004-01-03 13:46:31 UTC
    const latDeg = -14.64;
    const lonWestDeg = 184.702;
    const lonEastDeg = 360.0 - lonWestDeg; // 175.298°E

    const params = calculateMarsParameters(millis, latDeg, lonEastDeg);

    // Eq. A-1 & A-2: Julian Date (UT)
    expect(params.jdUt).toBeCloseTo(2453008.07397, 5);

    // Eq. A-4: TT - UTC offset
    expect(params.ttMinusUtc).toBeCloseTo(64.184, 3);

    // Eq. A-5: Julian Date (TT)
    expect(params.jdTt).toBeCloseTo(2453008.07471, 5);

    // Eq. A-6: Delta t J2000
    expect(params.dtJ2000).toBeCloseTo(1463.07471, 5);

    // Eq. B-1: Mars mean anomaly M (modulo 360)
    expect(params.mDeg).toBeCloseTo(66.06858, 4);

    // Eq. B-2: Angle of Fictitious Mean Sun alpha_FMS (modulo 360)
    expect(params.alphaFmsDeg).toBeCloseTo(317.09457, 4);

    // Eq. B-3: Perturbers PBS
    expect(params.pbsDeg).toBeCloseTo(0.01614, 5);

    // Eq. B-4: Equation of Center nu - M
    expect(params.nuMinusMDeg).toBeCloseTo(10.22959, 4);

    // Eq. B-5: Areocentric solar longitude Ls
    expect(params.lsDeg).toBeCloseTo(327.32416, 4);
    expect(marsSolarLongitude(millis)).toBeCloseTo(327.32416, 4);

    // Eq. C-1: Equation of Time EOT
    expect(params.eotDeg).toBeCloseTo(-12.77553, 4);
    expect(params.eotHours).toBeCloseTo(-0.8517, 4);

    // Eq. C-2: Mean Solar Time at prime meridian MST
    expect(params.mstHours).toBeCloseTo(13.16537, 4);

    // Eq. C-3: Local Mean Solar Time LMST
    expect(params.lmstHours).toBeCloseTo(0.8519, 4);
    expect(localMeanSolarTime(millis, lonEastDeg)).toBeCloseTo(0.8519, 4);

    // Eq. C-4: Local True Solar Time LTST
    expect(params.ltstHours).toBeCloseTo(0.00025, 3);
    expect(localTrueSolarTime(millis, lonEastDeg)).toBeCloseTo(0.00025, 3);

    // Eq. C-5: Subsolar longitude Lambda_s (deg West)
    expect(params.subsolarLonWestDeg).toBeCloseTo(4.705, 3);

    // Eq. D-1: Solar declination delta_s
    expect(params.subsolarLatDeg).toBeCloseTo(-13.42065, 3);

    // Eq. D-2: Heliocentric distance RM
    expect(params.rMAu).toBeCloseTo(1.47767, 4);

    // Eq. D-3: Heliocentric longitude lM
    expect(params.lMDeg).toBeCloseTo(52.37564, 4);

    // Eq. D-4: Heliocentric latitude bM
    expect(params.bMDeg).toBeCloseTo(0.08965, 4);

    // Eq. D-5: Zenith angle Z & Solar Elevation
    expect(params.zenithDeg).toBeCloseTo(151.93895, 2);
    expect(sunElevationDeg(millis, latDeg, lonEastDeg)).toBeCloseTo(90.0 - 151.93895, 2);

    // Eq. D-6: Solar azimuth A
    expect(params.azimuthDeg).toBeCloseTo(179.99383, 3);
  });

  // Test 3: Gale (lat -4.5895, lon 137.4417 E) on 2026-08-25: sunrise and sunset LMST within 10 minutes of REMS-reported 06:46 and 18:51
  // (note in the test that REMS reports LMST and its definition of sunrise may differ slightly).
  it('calculates sunrise and sunset LMST at Gale on 2026-08-25 within 10 minutes of REMS 06:46 and 18:51', () => {
    const latGale = -4.5895;
    const lonEastGale = 137.4417;
    // Start of search: UTC midnight on 2026-08-25
    const solStartUtcMs = Date.UTC(2026, 7, 25, 0, 0, 0);

    const events = sunEvents(solStartUtcMs, latGale, lonEastGale);

    expect(events.sunriseUtcMs).not.toBeNull();
    expect(events.sunsetUtcMs).not.toBeNull();
    expect(events.sunriseLmst).not.toBeNull();
    expect(events.sunsetLmst).not.toBeNull();

    // REMS reports LMST and its definition of sunrise may differ slightly
    const remsSunriseHours = 6 + 46 / 60; // 06:46 LMST
    const remsSunsetHours = 18 + 51 / 60; // 18:51 LMST
    const tenMinutesInHours = 10 / 60;

    expect(Math.abs(events.sunriseLmst! - remsSunriseHours)).toBeLessThan(tenMinutesInHours);
    expect(Math.abs(events.sunsetLmst! - remsSunsetHours)).toBeLessThan(tenMinutesInHours);
  });

  // Test 4: A polar case (lat 85 N near northern summer solstice Ls ~90): sunsetUtcMs === null; and near Ls ~270: sunriseUtcMs === null.
  it('handles polar day (no sunset) near Ls ~90 and polar night (no sunrise) near Ls ~270 at 85 N', () => {
    const latNorthPolar = 85.0;
    const lonEast = 0.0;

    // Northern summer solstice (Ls ~ 90): ~2027-04-15
    const summerSolsticeSolStart = Date.UTC(2027, 3, 15, 0, 0, 0);
    const summerLs = marsSolarLongitude(summerSolsticeSolStart);
    expect(Math.abs(summerLs - 90.0)).toBeLessThan(5.0);

    const summerEvents = sunEvents(summerSolsticeSolStart, latNorthPolar, lonEast);
    expect(summerEvents.sunsetUtcMs).toBeNull();
    expect(summerEvents.polar).toBe('day');
    expect(summerEvents.sunsetLmst).toBeNull();

    // Northern winter solstice (Ls ~ 270): ~2026-04-24
    const winterSolsticeSolStart = Date.UTC(2026, 3, 24, 0, 0, 0);
    const winterLs = marsSolarLongitude(winterSolsticeSolStart);
    expect(Math.abs(winterLs - 270.0)).toBeLessThan(5.0);

    const winterEvents = sunEvents(winterSolsticeSolStart, latNorthPolar, lonEast);
    expect(winterEvents.sunriseUtcMs).toBeNull();
    expect(winterEvents.polar).toBe('night');
    expect(winterEvents.sunriseLmst).toBeNull();
  });

  // Test 5: sunElevationDeg at local true solar noon at the subsolar latitude is within 0.5 deg of 90.
  it('computes sunElevationDeg within 0.5 deg of 90 at local true solar noon at subsolar latitude', () => {
    const testUtcMs = Date.UTC(2026, 7, 25, 12, 0, 0);
    const params = calculateMarsParameters(testUtcMs, 0, 0);

    // Subsolar point coordinates
    const subsolarLat = params.subsolarLatDeg;
    // Subsolar longitude in East degrees
    const subsolarLonEast = ((360.0 - (params.subsolarLonWestDeg % 360.0)) % 360.0 + 360.0) % 360.0;

    // Verify this is local true solar noon (LTST = 12.0 hours)
    const ltst = localTrueSolarTime(testUtcMs, subsolarLonEast);
    expect(ltst).toBeCloseTo(12.0, 4);

    // Verify sun elevation is 90 deg (overhead at zenith) within 0.5 deg
    const elev = sunElevationDeg(testUtcMs, subsolarLat, subsolarLonEast);
    expect(Math.abs(elev - 90.0)).toBeLessThan(0.5);
  });
});

describe('sunPosition (Mars24 Eq. D-5, D-6)', () => {
  it('gives the GISS worked example A azimuth and elevation (2000-01-06 00:00 UTC, 0 E 0 N)', () => {
    const p = sunPosition(947116800000, 0, 0);
    expect(p.azimuthDeg).toBeCloseTo(191.03905, 4);
    expect(p.elevationDeg).toBeCloseTo(90 - 154.26182, 3);
  });

  it('gives the GISS worked example B azimuth and elevation (Spirit landing, 184.702 W 14.64 S)', () => {
    const p = sunPosition(1073137591000, -14.64, 360 - 184.702);
    expect(p.azimuthDeg).toBeCloseTo(179.99383, 3);
    expect(p.elevationDeg).toBeCloseTo(90 - 151.93895, 2);
  });

  it('solStartAt lands on local mean midnight of the same sol', () => {
    const now = Date.UTC(2026, 7, 25, 15, 0, 0);
    const start = solStartAt(now, 137.4);
    expect(localMeanSolarTime(start, 137.4)).toBeCloseTo(0, 6);
    expect(now - start).toBeGreaterThanOrEqual(0);
    expect(now - start).toBeLessThan(MARS_SOL_MS);
  });
});
