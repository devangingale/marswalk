// Written with AI assistance, directed and reviewed by the team.

/**
 * Mars solar time, coordinates, and sun events implementation.
 *
 * Implements the Mars24 algorithm:
 * Allison, M., and M. McEwen 2000. "A post-Pathfinder evaluation of aerocentric solar
 * coordinates with improved timing recipes for Mars seasonal/diurnal climate studies."
 * Planetary and Space Science 48, 215-235 (AM2000).
 *
 * Allison, M. 1997. "Accurate analytic representations of solar time and seasons on
 * Mars with applications to the Pathfinder/Surveyor missions."
 * Geophys. Res. Lett. 24, 1967-1970 (A1997).
 *
 * NASA GISS Mars24 Sunclock — Algorithm and Worked Examples (updated 2025-01-07):
 * https://www.giss.nasa.gov/tools/mars24/help/algorithm.html
 */

import { degToRad, radToDeg } from './grid';

/** Mars sol duration in seconds (GISS Mars24 notes / AM2000) */
export const MARS_SOL_SECONDS = 88775.244;
export const MARS_SOL_MS = MARS_SOL_SECONDS * 1000.0;

/** Unix epoch in Julian Date (UT) (GISS Eq. A-2) */
const JD_UNIX_EPOCH = 2440587.5;

/** Milliseconds in a standard Julian Earth day (GISS Eq. A-2) */
const MS_PER_DAY = 8.64e7;

/** J2000 standard epoch in Julian Date (GISS Eq. A-3 / AM2000 eq. 15) */
const JD_J2000 = 2451545.0;

/** Mars sol ratio to Earth day (GISS Eq. C-2 / AM2000 eq. 22) */
const MARS_SOL_RATIO = 1.0274912517;

/**
 * Perturbation series coefficients for Mars fictitious mean sun (GISS Eq. B-3; AM2000 eq. 18).
 * Planetary perturbations primarily driven by Jupiter and Earth.
 */
const PERTURBERS = [
  { a: 0.0071, tau: 2.2353, phi: 49.409 },
  { a: 0.0057, tau: 2.7543, phi: 168.173 },
  { a: 0.0039, tau: 1.1177, phi: 191.837 },
  { a: 0.0037, tau: 15.7866, phi: 21.736 },
  { a: 0.0021, tau: 2.1354, phi: 15.704 },
  { a: 0.002, tau: 2.4694, phi: 95.528 },
  { a: 0.0018, tau: 32.8493, phi: 49.095 },
];

/**
 * Historical IERS leap seconds table: [UTC timestamp in ms, TAI - UTC in seconds].
 * Valid for dates after Jan 1, 1972. TT - UTC = (TAI - UTC) + 32.184 s.
 */
const LEAP_SECONDS_TABLE: Array<[number, number]> = [
  [Date.UTC(1972, 0, 1), 10],
  [Date.UTC(1972, 6, 1), 11],
  [Date.UTC(1973, 0, 1), 12],
  [Date.UTC(1974, 0, 1), 13],
  [Date.UTC(1975, 0, 1), 14],
  [Date.UTC(1976, 0, 1), 15],
  [Date.UTC(1977, 0, 1), 16],
  [Date.UTC(1978, 0, 1), 17],
  [Date.UTC(1979, 0, 1), 18],
  [Date.UTC(1980, 0, 1), 19],
  [Date.UTC(1981, 6, 1), 20],
  [Date.UTC(1982, 6, 1), 21],
  [Date.UTC(1983, 6, 1), 22],
  [Date.UTC(1985, 6, 1), 23],
  [Date.UTC(1988, 0, 1), 24],
  [Date.UTC(1990, 0, 1), 25],
  [Date.UTC(1991, 0, 1), 26],
  [Date.UTC(1992, 6, 1), 27],
  [Date.UTC(1993, 6, 1), 28],
  [Date.UTC(1994, 6, 1), 29],
  [Date.UTC(1996, 0, 1), 30],
  [Date.UTC(1997, 6, 1), 31],
  [Date.UTC(1999, 0, 1), 32],
  [Date.UTC(2006, 0, 1), 33],
  [Date.UTC(2009, 0, 1), 34],
  [Date.UTC(2012, 6, 1), 35],
  [Date.UTC(2015, 6, 1), 36],
  [Date.UTC(2017, 0, 1), 37],
];

/**
 * Determines TT - UTC offset in seconds (GISS Eq. A-4, replacing AM2000 eq. 27).
 * For dates after 2017-01-01, TAI - UTC = 37.0 s, TT - UTC = 69.184 s.
 */
export function getTtMinusUtcSeconds(utcMs: number, jdUt: number): number {
  const start1972 = Date.UTC(1972, 0, 1);
  if (utcMs >= start1972) {
    let taiMinusUtc = 37.0;
    for (let i = LEAP_SECONDS_TABLE.length - 1; i >= 0; i--) {
      if (utcMs >= LEAP_SECONDS_TABLE[i][0]) {
        taiMinusUtc = LEAP_SECONDS_TABLE[i][1];
        break;
      }
    }
    return taiMinusUtc + 32.184;
  }

  // Pre-1972 empirical polynomial (GISS Eq. A-4)
  const T = (jdUt - JD_J2000) / 36525.0;
  return 64.184 + 59.0 * T - 51.2 * T * T - 67.1 * Math.pow(T, 3) - 16.4 * Math.pow(T, 4);
}

export interface MarsIntermediateValues {
  millis: number;
  jdUt: number;
  ttMinusUtc: number;
  jdTt: number;
  dtJ2000: number;
  mDeg: number;
  alphaFmsDeg: number;
  pbsDeg: number;
  nuMinusMDeg: number;
  lsDeg: number;
  eotDeg: number;
  eotHours: number;
  mstHours: number;
  lmstHours: number;
  ltstHours: number;
  subsolarLonWestDeg: number;
  subsolarLatDeg: number;
  rMAu: number;
  lMDeg: number;
  bMDeg: number;
  zenithDeg: number;
  azimuthDeg: number;
  elevationDeg: number;
}

/**
 * Calculates step-by-step Mars24 parameters for a given UTC timestamp and surface location.
 */
export function calculateMarsParameters(
  utcMs: number,
  latDeg: number = 0.0,
  lonEastDeg: number = 0.0
): MarsIntermediateValues {
  // A-1: Earth time in millis
  const millis = utcMs;

  // A-2: Julian Date (UT) (GISS Eq. A-2)
  const jdUt = JD_UNIX_EPOCH + millis / MS_PER_DAY;

  // A-4: TT - UTC conversion offset (GISS Eq. A-4)
  const ttMinusUtc = getTtMinusUtcSeconds(millis, jdUt);

  // A-5: Julian Date (TT) (GISS Eq. A-5)
  const jdTt = jdUt + ttMinusUtc / 86400.0;

  // A-6: Time offset from J2000 epoch (TT) in days (GISS Eq. A-6; AM2000 eq. 15)
  const dtJ2000 = jdTt - JD_J2000;

  // B-1: Mars mean anomaly M in degrees (GISS Eq. B-1; AM2000 eq. 16)
  const mUnmod = 19.3871 + 0.52402073 * dtJ2000;
  const mDeg = ((mUnmod % 360.0) + 360.0) % 360.0;
  const mRad = degToRad(mDeg);

  // B-2: Angle of Fictitious Mean Sun alpha_FMS in degrees (GISS Eq. B-2; AM2000 eq. 17)
  const alphaFmsUnmod = 270.3871 + 0.524038496 * dtJ2000;
  const alphaFmsDeg = ((alphaFmsUnmod % 360.0) + 360.0) % 360.0;

  // B-3: Perturbers PBS in degrees (GISS Eq. B-3; AM2000 eq. 18)
  let pbsDeg = 0.0;
  for (let i = 0; i < PERTURBERS.length; i++) {
    const p = PERTURBERS[i];
    const angle = (0.985626 * dtJ2000) / p.tau + p.phi;
    pbsDeg += p.a * Math.cos(degToRad(angle));
  }

  // B-4: Equation of Center nu - M in degrees (GISS Eq. B-4; AM2000 eqs. 19-20)
  const nuMinusMDeg =
    (10.691 + 3.0e-7 * dtJ2000) * Math.sin(mRad) +
    0.623 * Math.sin(2 * mRad) +
    0.05 * Math.sin(3 * mRad) +
    0.005 * Math.sin(4 * mRad) +
    0.0005 * Math.sin(5 * mRad) +
    pbsDeg;

  // B-5: Areocentric solar longitude Ls in degrees (GISS Eq. B-5; AM2000 eq. 19)
  const lsUnmod = alphaFmsUnmod + nuMinusMDeg;
  const lsDeg = ((lsUnmod % 360.0) + 360.0) % 360.0;
  const lsRad = degToRad(lsDeg);

  // C-1: Equation of Time EOT in degrees and hours (GISS Eq. C-1; AM2000 eq. 20)
  const eotDeg =
    2.861 * Math.sin(2 * lsRad) -
    0.071 * Math.sin(4 * lsRad) +
    0.002 * Math.sin(6 * lsRad) -
    nuMinusMDeg;
  const eotHours = eotDeg / 15.0;

  // C-2: Mean Solar Time at prime meridian MST (GISS Eq. C-2; AM2000 eq. 22 modified)
  const msd = (jdTt - 2451549.5) / MARS_SOL_RATIO + 44796.0 - 0.0009626;
  const mstHours = (((24.0 * msd) % 24.0) + 24.0) % 24.0;

  // Longitude conversion: West longitude Lambda = 360 - East longitude
  const lonWestDeg = ((360.0 - (lonEastDeg % 360.0)) % 360.0 + 360.0) % 360.0;

  // C-3: Local Mean Solar Time LMST in hours (GISS Eq. C-3)
  const lmstHours = (((mstHours - lonWestDeg / 15.0) % 24.0) + 24.0) % 24.0;

  // C-4: Local True Solar Time LTST in hours (GISS Eq. C-4; AM2000 eq. 23)
  const ltstHours = (((lmstHours + eotHours) % 24.0) + 24.0) % 24.0;

  // C-5: Subsolar longitude Lambda_s in degrees West (GISS Eq. C-5)
  const subsolarLonWestDeg = (((mstHours * 15.0 + eotDeg + 180.0) % 360.0) + 360.0) % 360.0;

  // D-1: Solar declination delta_s (subsolar latitude) in degrees (GISS Eq. D-1; A1997 eq. 5)
  const subsolarLatDeg = radToDeg(Math.asin(0.42565 * Math.sin(lsRad))) + 0.25 * Math.sin(lsRad);

  // D-2: Heliocentric distance RM in AU (GISS Eq. D-2; AM2000 eq. 25 corrected)
  const rMAu =
    1.52367934 *
    (1.00436 -
      0.09309 * Math.cos(mRad) -
      0.004336 * Math.cos(2 * mRad) -
      0.00031 * Math.cos(3 * mRad) -
      0.00003 * Math.cos(4 * mRad));

  // D-3: Heliocentric longitude lM in degrees (GISS Eq. D-3; AM2000 eq. 26)
  const lMUnmod =
    lsDeg + 85.061 - 0.015 * Math.sin(degToRad(71.0 + 2 * lsDeg)) - 5.5e-6 * dtJ2000;
  const lMDeg = ((lMUnmod % 360.0) + 360.0) % 360.0;

  // D-4: Heliocentric latitude bM in degrees (GISS Eq. D-4)
  const bMDeg =
    -(1.8497 - 2.23e-5 * dtJ2000) * Math.sin(degToRad(lsDeg - 144.5 + 2.57e-6 * dtJ2000));

  // D-5: Zenith angle Z and local solar elevation (GISS Eq. D-5)
  // Hour angle H = Lambda - Lambda_s (where Lambda is west longitude)
  const H = lonWestDeg - subsolarLonWestDeg;
  const cosZ =
    Math.sin(degToRad(subsolarLatDeg)) * Math.sin(degToRad(latDeg)) +
    Math.cos(degToRad(subsolarLatDeg)) * Math.cos(degToRad(latDeg)) * Math.cos(degToRad(H));
  const clampedCosZ = Math.max(-1.0, Math.min(1.0, cosZ));
  const zenithDeg = radToDeg(Math.acos(clampedCosZ));
  const elevationDeg = 90.0 - zenithDeg;

  // D-6: Local solar azimuth A in degrees (GISS Eq. D-6)
  const sinH = Math.sin(degToRad(H));
  const denom =
    Math.cos(degToRad(latDeg)) * Math.tan(degToRad(subsolarLatDeg)) -
    Math.sin(degToRad(latDeg)) * Math.cos(degToRad(H));
  const azimuthDeg = ((radToDeg(Math.atan2(sinH, denom)) % 360.0) + 360.0) % 360.0;

  return {
    millis,
    jdUt,
    ttMinusUtc,
    jdTt,
    dtJ2000,
    mDeg,
    alphaFmsDeg,
    pbsDeg,
    nuMinusMDeg,
    lsDeg,
    eotDeg,
    eotHours,
    mstHours,
    lmstHours,
    ltstHours,
    subsolarLonWestDeg,
    subsolarLatDeg,
    rMAu,
    lMDeg,
    bMDeg,
    zenithDeg,
    azimuthDeg,
    elevationDeg,
  };
}

/**
 * Areocentric solar longitude Ls in degrees [0, 360).
 * Mars24 / AM2000 eq. 19.
 */
export function marsSolarLongitude(utcMs: number): number {
  return calculateMarsParameters(utcMs, 0, 0).lsDeg;
}

/**
 * Local Mean Solar Time (LMST) in hours [0, 24).
 * Mars24 Eq. C-3.
 */
export function localMeanSolarTime(utcMs: number, lonEastDeg: number): number {
  return calculateMarsParameters(utcMs, 0, lonEastDeg).lmstHours;
}

/**
 * Local True Solar Time (LTST) in hours [0, 24).
 * Mars24 Eq. C-4; AM2000 eq. 23.
 */
export function localTrueSolarTime(utcMs: number, lonEastDeg: number): number {
  return calculateMarsParameters(utcMs, 0, lonEastDeg).ltstHours;
}

/**
 * Local solar elevation above horizon in degrees [-90, +90].
 * Mars24 Eq. D-5.
 */
export function sunElevationDeg(utcMs: number, latDeg: number, lonEastDeg: number): number {
  return calculateMarsParameters(utcMs, latDeg, lonEastDeg).elevationDeg;
}

/**
 * The Sun in the local sky: azimuth in degrees clockwise from true north [0, 360) and
 * elevation above the horizon [-90, 90]. Mars24 Eq. D-5 and D-6 (declination, local true
 * solar time and hour angle), as calculateMarsParameters.
 */
export function sunPosition(
  utcMs: number,
  latDeg: number,
  lonEastDeg: number
): { azimuthDeg: number; elevationDeg: number } {
  const { azimuthDeg, elevationDeg } = calculateMarsParameters(utcMs, latDeg, lonEastDeg);
  return { azimuthDeg, elevationDeg };
}

/** UTC ms of local mean midnight that starts the sol containing utcMs at lonEastDeg. */
export function solStartAt(utcMs: number, lonEastDeg: number): number {
  return utcMs - (localMeanSolarTime(utcMs, lonEastDeg) / 24) * MARS_SOL_MS;
}

/**
 * Helper bisection search for zero solar elevation between tA and tB.
 * Tolerates up to 1000 ms (1 second) interval window.
 */
function bisectZeroElevation(
  tA: number,
  tB: number,
  latDeg: number,
  lonEastDeg: number,
  isRising: boolean
): number {
  let low = tA;
  let high = tB;

  while (high - low > 1000) {
    const mid = (low + high) / 2;
    const elevMid = sunElevationDeg(mid, latDeg, lonEastDeg);

    if (isRising) {
      if (elevMid <= 0) {
        low = mid;
      } else {
        high = mid;
      }
    } else {
      if (elevMid >= 0) {
        low = mid;
      } else {
        high = mid;
      }
    }
  }

  return Math.round((low + high) / 2);
}

/**
 * Computes sunrise and sunset events for a given site within a Martian sol.
 *
 * Sunrise/sunset = sun centre at elevation 0 deg.
 *
 * Searches within the sol starting at solStartUtcMs (one sol = 88775.244 s)
 * by sampling then bisection to 1 s. Returns null for an event that does not
 * occur that sol (e.g. polar day or night).
 */
export function sunEvents(
  solStartUtcMs: number,
  latDeg: number,
  lonEastDeg: number
): {
  polar: 'day' | 'night' | null;
  solStartUtcMs: number;
  sunriseUtcMs: number | null;
  sunsetUtcMs: number | null;
  sunriseLmst: number | null;
  sunsetLmst: number | null;
} {
  const solEndUtcMs = solStartUtcMs + MARS_SOL_MS;
  const sampleStepMs = 30000; // 30 seconds sampling

  let sunriseUtcMs: number | null = null;
  let sunsetUtcMs: number | null = null;

  let prevT = solStartUtcMs;
  let prevElev = sunElevationDeg(prevT, latDeg, lonEastDeg);

  for (let t = solStartUtcMs + sampleStepMs; t <= solEndUtcMs; t += sampleStepMs) {
    const elev = sunElevationDeg(t, latDeg, lonEastDeg);

    if (sunriseUtcMs === null && prevElev <= 0 && elev > 0) {
      sunriseUtcMs = bisectZeroElevation(prevT, t, latDeg, lonEastDeg, true);
    }

    if (sunsetUtcMs === null && prevElev >= 0 && elev < 0) {
      sunsetUtcMs = bisectZeroElevation(prevT, t, latDeg, lonEastDeg, false);
    }

    if (sunriseUtcMs !== null && sunsetUtcMs !== null) {
      break;
    }

    prevT = t;
    prevElev = elev;
  }

  if (prevT < solEndUtcMs && (sunriseUtcMs === null || sunsetUtcMs === null)) {
    const elev = sunElevationDeg(solEndUtcMs, latDeg, lonEastDeg);
    if (sunriseUtcMs === null && prevElev <= 0 && elev > 0) {
      sunriseUtcMs = bisectZeroElevation(prevT, solEndUtcMs, latDeg, lonEastDeg, true);
    }
    if (sunsetUtcMs === null && prevElev >= 0 && elev < 0) {
      sunsetUtcMs = bisectZeroElevation(prevT, solEndUtcMs, latDeg, lonEastDeg, false);
    }
  }

  const sunriseLmst = sunriseUtcMs !== null ? localMeanSolarTime(sunriseUtcMs, lonEastDeg) : null;
  const sunsetLmst = sunsetUtcMs !== null ? localMeanSolarTime(sunsetUtcMs, lonEastDeg) : null;

  return {
    polar: sunriseUtcMs === null && sunsetUtcMs === null
      ? (sunElevationDeg(solStartUtcMs + MARS_SOL_MS / 2, latDeg, lonEastDeg) > 0 ? 'day' : 'night')
      : null,
    solStartUtcMs,
    sunriseUtcMs,
    sunsetUtcMs,
    sunriseLmst,
    sunsetLmst,
  };
}
