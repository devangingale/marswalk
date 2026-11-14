// Written with AI assistance, directed and reviewed by the team.
//
// "Now" panel for the globe: the latest Gale (REMS) weather, the last Jezero
// (MEDA) reading, live DONKI space-weather alerts that name Mars, and the dust
// season from the current solar longitude. Each value carries its own age.

import React, { useEffect, useState } from 'react';
import { GLOBE_BASE } from '../config';
import { marsSolarLongitude } from '../lib/sun';
import './conditions.css';

const DAY_MS = 86_400_000;

/**
 * Age of a reading as a short human label, relative to now. Pure and tested.
 * Thresholds step from "just now" through minutes and hours to whole days.
 */
export function ageLabel(nowMs: number, readingMs: number): string {
  const s = Math.floor((nowMs - readingMs) / 1000);
  if (s < 60) return 'just now';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(s / 3600);
  if (h < 24) return `${h} h ago`;
  const d = Math.floor(s / 86_400);
  return `${d} day${d === 1 ? '' : 's'} ago`;
}

/**
 * Dust season from solar longitude. The Mars dust-storm season is southern
 * spring and summer (Ls 180-360, peaking near perihelion ~Ls 251); the rest of
 * the year is comparatively clear. Pure and tested.
 */
export function dustSeason(ls: number): { label: string; dusty: boolean } {
  const x = ((ls % 360) + 360) % 360;
  const dusty = x >= 180 && x < 360;
  return { label: dusty ? 'dust storm season' : 'low-dust season', dusty };
}

/** "-71" style, with a true minus sign; null becomes an en dash. */
function fmtC(v: number | null): string {
  if (v === null || Number.isNaN(v)) return '–';
  return `${v < 0 ? '−' : ''}${Math.abs(Math.round(v))}`;
}

function fmtPressure(v: number | null): string {
  return v === null || Number.isNaN(v) ? '–' : `${Math.round(v)} Pa`;
}

function numOrNull(raw: unknown): number | null {
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null;
  if (typeof raw !== 'string' || raw === '--' || raw.trim() === '') return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

interface Weather {
  sol: number;
  readingMs: number;
  tMinC: number | null;
  tMaxC: number | null;
  pressurePa: number | null;
  opacity: string | null;
  source: 'feed' | 'snapshot';
}

interface MslSol {
  sol: string;
  terrestrial_date: string;
  min_temp: string;
  max_temp: string;
  pressure: string;
  atmo_opacity: string;
}

interface GaleDay {
  sol: number;
  earth_date: string;
  t_min_c: number | null;
  t_max_c: number | null;
  pressure_pa: number | null;
  atmo_opacity: string | null;
}

interface MarsImpact {
  arrivalMs: number;
  glancing: boolean;
  minor: boolean;
}

interface EnlilSim {
  impactList?: { location: string; arrivalTime: string; isGlancingBlow?: boolean; isMinorImpact?: boolean }[];
}

// Last Jezero (Mars 2020 / MEDA) daily report before the public feed froze:
// sol 1133, 2024-04-27, air -79.3/-24.7 C, 778.9 Pa (docs/research/current-conditions.md, finding 11).
const JEZERO = {
  sol: 1133,
  readingMs: Date.UTC(2024, 3, 27),
  tMinC: -79.3,
  tMaxC: -24.7,
  pressurePa: 778.9,
};

const DONKI_KEY = 'sol48-donki-mars-v1';
const DONKI_TTL_MS = 30 * 60 * 1000;

function yyyymmdd(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

async function loadGaleSnapshot(): Promise<Weather | null> {
  try {
    const res = await fetch(`${GLOBE_BASE}/weather/gale.json`);
    if (!res.ok) return null;
    const data = (await res.json()) as { days: GaleDay[] };
    const last = data.days[data.days.length - 1];
    if (!last) return null;
    return {
      sol: last.sol,
      readingMs: Date.parse(last.earth_date),
      tMinC: last.t_min_c,
      tMaxC: last.t_max_c,
      pressurePa: last.pressure_pa,
      opacity: last.atmo_opacity,
      source: 'snapshot',
    };
  } catch {
    return null;
  }
}

async function loadGaleLatest(): Promise<Weather | null> {
  try {
    const res = await fetch('https://mars.nasa.gov/rss/api/?feed=weather&category=msl&feedtype=json');
    if (!res.ok) return null;
    const data = (await res.json()) as { soles?: MslSol[] };
    const soles = data.soles ?? [];
    let latest: MslSol | null = null;
    for (const s of soles) if (!latest || Number(s.sol) > Number(latest.sol)) latest = s;
    if (!latest) return null;
    return {
      sol: Number(latest.sol),
      readingMs: Date.parse(latest.terrestrial_date),
      tMinC: numOrNull(latest.min_temp),
      tMaxC: numOrNull(latest.max_temp),
      pressurePa: numOrNull(latest.pressure),
      opacity: latest.atmo_opacity && latest.atmo_opacity !== '--' ? latest.atmo_opacity : null,
      source: 'feed',
    };
  } catch {
    return null;
  }
}

function readDonkiCache(): MarsImpact[] | null {
  try {
    const raw = sessionStorage.getItem(DONKI_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { at: number; impacts: MarsImpact[] };
    if (Date.now() - parsed.at > DONKI_TTL_MS) return null;
    return parsed.impacts;
  } catch {
    return null;
  }
}

async function loadDonkiMars(): Promise<MarsImpact[] | null> {
  const cached = readDonkiCache();
  if (cached) return cached;
  const now = Date.now();
  const url = `https://api.nasa.gov/DONKI/WSAEnlilSimulations?startDate=${yyyymmdd(now - 30 * DAY_MS)}&endDate=${yyyymmdd(now)}&api_key=DEMO_KEY`;
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const sims = (await res.json()) as EnlilSim[];
    const impacts: MarsImpact[] = [];
    for (const sim of sims) {
      for (const hit of sim.impactList ?? []) {
        if (!/mars/i.test(hit.location)) continue;
        const arrivalMs = Date.parse(hit.arrivalTime);
        if (Number.isNaN(arrivalMs)) continue;
        impacts.push({ arrivalMs, glancing: !!hit.isGlancingBlow, minor: !!hit.isMinorImpact });
      }
    }
    impacts.sort((a, b) => b.arrivalMs - a.arrivalMs);
    try {
      sessionStorage.setItem(DONKI_KEY, JSON.stringify({ at: now, impacts }));
    } catch {
      /* storage may be unavailable; the fetch still succeeded */
    }
    return impacts;
  } catch {
    return null;
  }
}

export const ConditionsPanel: React.FC = () => {
  const [now] = useState(() => Date.now());
  const [gale, setGale] = useState<Weather | null>(null);
  const [donki, setDonki] = useState<MarsImpact[] | null | 'hidden'>(null);

  useEffect(() => {
    let live = true;
    void (async () => {
      const latest = (await loadGaleLatest()) ?? (await loadGaleSnapshot());
      if (live && latest) setGale(latest);
    })();
    void (async () => {
      const impacts = await loadDonkiMars();
      if (live) setDonki(impacts ?? 'hidden');
    })();
    return () => {
      live = false;
    };
  }, []);

  const season = dustSeason(marsSolarLongitude(now));
  const latestImpact = Array.isArray(donki) && donki.length > 0 ? donki[0] : null;

  return (
    <aside className="s48-cond" aria-label="Current conditions">
      <h2 className="s48-cond__title">Now</h2>

      <div className="s48-cond__row">
        <div className="s48-cond__head">
          <span className="s48-cond__label">Gale weather</span>
          {gale && (
            <span className="s48-cond__age">
              sol {gale.sol} · {ageLabel(now, gale.readingMs)}
            </span>
          )}
        </div>
        {gale ? (
          <>
            <div className="s48-cond__vals">
              <span className="s48-cond__val">
                {fmtC(gale.tMinC)} / {fmtC(gale.tMaxC)} °C
              </span>
              <span className="s48-cond__val">{fmtPressure(gale.pressurePa)}</span>
              {gale.opacity && <span className="s48-cond__val">{gale.opacity}</span>}
            </div>
            <span className="s48-cond__src">
              REMS, {gale.source === 'feed' ? 'live feed' : 'bundled snapshot'} · NASA/JPL-Caltech/CAB
            </span>
          </>
        ) : (
          <span className="s48-cond__src">loading</span>
        )}
      </div>

      <div className="s48-cond__row">
        <div className="s48-cond__head">
          <span className="s48-cond__label">Jezero weather</span>
          <span className="s48-cond__age">
            sol {JEZERO.sol} · {ageLabel(now, JEZERO.readingMs)}
          </span>
        </div>
        <div className="s48-cond__vals">
          <span className="s48-cond__val">
            {fmtC(JEZERO.tMinC)} / {fmtC(JEZERO.tMaxC)} °C
          </span>
          <span className="s48-cond__val">{fmtPressure(JEZERO.pressurePa)}</span>
        </div>
        <span className="s48-cond__src">MEDA feed, frozen since Apr 2024 · NASA/JPL-Caltech</span>
      </div>

      {donki !== 'hidden' && (
        <div className="s48-cond__row">
          <div className="s48-cond__head">
            <span className="s48-cond__label">Space weather</span>
            {latestImpact && <span className="s48-cond__age">{ageLabel(now, latestImpact.arrivalMs)}</span>}
          </div>
          {donki === null ? (
            <span className="s48-cond__src">loading</span>
          ) : latestImpact ? (
            <>
              <div className="s48-cond__vals">
                <span className="s48-cond__val">CME to Mars</span>
                <span className="s48-cond__val">{new Date(latestImpact.arrivalMs).toISOString().slice(0, 10)}</span>
                <span className="s48-cond__val">{latestImpact.glancing ? 'glancing' : 'direct'}</span>
              </div>
              <span className="s48-cond__src">
                {donki.length} Mars-bound in 30 days · NASA CCMC DONKI (WSA-ENLIL)
              </span>
            </>
          ) : (
            <>
              <div className="s48-cond__vals">
                <span className="s48-cond__val">none</span>
              </div>
              <span className="s48-cond__src">no Mars-bound CME in 30 days · NASA CCMC DONKI</span>
            </>
          )}
        </div>
      )}

      <div className="s48-cond__row">
        <div className="s48-cond__head">
          <span className="s48-cond__label">Dust season</span>
          <span className="s48-cond__age">now</span>
        </div>
        <div className="s48-cond__vals">
          <span className={`s48-cond__val${season.dusty ? ' s48-cond__val--caution' : ''}`}>{season.label}</span>
          <span className="s48-cond__val">Ls {Math.round(marsSolarLongitude(now))}</span>
        </div>
        <span className="s48-cond__src">from solar longitude (Mars24)</span>
      </div>
    </aside>
  );
};
