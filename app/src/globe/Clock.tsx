// Written with AI assistance, directed and reviewed by the team.
//
// Time slider across the Mars Years in the dust history. Scrubbing or playing
// moves one sol at a time, driving the dust layer frame and the Gale weather
// readout for that sol. Explore mounts it in the time bar under the map; the
// conditions panel (Now) sits in the right panel.

import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { Scene } from 'cesium';
import { GLOBE_BASE } from '../config';
import { decodeFrame, DustGrid, dustGrid, DustIndex, DustLayer, DustYear } from './dustLayer';
import './clock.css';

const STEP_MS = 280; // play cadence: a few sols per second, steady under the tile rebuild.

interface GaleDay {
  sol: number;
  earth_date: string;
  t_min_c: number | null;
  t_max_c: number | null;
  pressure_pa: number | null;
}

/** Nearest Gale day to a target Earth time, over Earth times sorted ascending. */
function nearestDay(days: GaleDay[], times: number[], targetMs: number): GaleDay | null {
  if (days.length === 0) return null;
  let lo = 0;
  let hi = times.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (times[mid] < targetMs) lo = mid + 1;
    else hi = mid;
  }
  const prev = lo > 0 ? lo - 1 : 0;
  return Math.abs(times[prev] - targetMs) <= Math.abs(times[lo] - targetMs) ? days[prev] : days[lo];
}

function fmtC(v: number | null): string {
  if (v === null || Number.isNaN(v)) return '–';
  return `${v < 0 ? '−' : ''}${Math.abs(Math.round(v))}`;
}

export const Clock: React.FC<{ scene: Scene; onLs?: (ls: number) => void }> = ({ scene, onLs }) => {
  const [index, setIndex] = useState<DustIndex | null>(null);
  const [bytes, setBytes] = useState<Uint8Array | null>(null);
  const [galeDays, setGaleDays] = useState<GaleDay[]>([]);
  const [frame, setFrame] = useState(359); // sol 360 by default: a clear mid-year state.
  const [playing, setPlaying] = useState(false);

  const dustRef = useRef<DustLayer | null>(null);

  const year: DustYear | null = index?.years[0] ?? null;
  const grid: DustGrid | null = index ? dustGrid(index) : null;
  const frameCount = year?.frames ?? 0;

  const galeTimes = useMemo(() => galeDays.map((d) => Date.parse(d.earth_date)), [galeDays]);

  // Load the dust index, the frame stack and the Gale weather history once.
  useEffect(() => {
    let live = true;
    void (async () => {
      try {
        const res = await fetch(`${GLOBE_BASE}/dust/index.json`);
        if (!res.ok) return;
        const idx = (await res.json()) as DustIndex;
        if (!live) return;
        setIndex(idx);
        const binRes = await fetch(`${GLOBE_BASE}/dust/${idx.years[0].url}`);
        if (binRes.ok && live) setBytes(new Uint8Array(await binRes.arrayBuffer()));
      } catch {
        /* dust history is optional; the bar stays hidden if it does not load */
      }
    })();
    void (async () => {
      try {
        const res = await fetch(`${GLOBE_BASE}/weather/gale.json`);
        if (res.ok && live) setGaleDays(((await res.json()) as { days: GaleDay[] }).days ?? []);
      } catch {
        /* weather readout is optional */
      }
    })();
    return () => {
      live = false;
    };
  }, []);

  // Build and tear down the dust layer primitive.
  useEffect(() => {
    dustRef.current = new DustLayer(scene);
    return () => {
      dustRef.current?.destroy();
      dustRef.current = null;
    };
  }, [scene]);

  // Draw the current frame whenever it, or the loaded data, changes.
  useEffect(() => {
    if (!year || !grid || !bytes || !dustRef.current) return;
    const f = Math.max(0, Math.min(frameCount - 1, frame));
    dustRef.current.showFrame(decodeFrame(bytes, grid, f), grid, index!.palette);
  }, [frame, year, grid, bytes, frameCount, index]);

  // Play: advance one sol per tick, wrapping at the end.
  useEffect(() => {
    if (!playing || frameCount === 0) return;
    const id = window.setInterval(() => setFrame((f) => (f + 1) % frameCount), STEP_MS);
    return () => window.clearInterval(id);
  }, [playing, frameCount]);

  // Report the shown sol's solar longitude, for layers that follow the season.
  const shownLs = year && frameCount > 0 ? year.sols[Math.max(0, Math.min(frameCount - 1, frame))]?.ls : undefined;
  useEffect(() => {
    if (shownLs !== undefined) onLs?.(shownLs);
  }, [shownLs, onLs]);

  if (!year || frameCount === 0) return null;

  const f = Math.max(0, Math.min(frameCount - 1, frame));
  const sol = year.sols[f];
  const day = sol ? nearestDay(galeDays, galeTimes, Date.parse(sol.earth_date)) : null;
  const step = (delta: number) => {
    setPlaying(false);
    setFrame((prev) => Math.max(0, Math.min(frameCount - 1, prev + delta)));
  };

  return (
    <div className="s48-clock" role="group" aria-label="Mars time slider">
        <div className="s48-clock__controls">
          <button
            type="button"
            className="s48-clock__btn"
            aria-pressed={playing}
            aria-label={playing ? 'Pause' : 'Play'}
            onClick={() => setPlaying((p) => !p)}
          >
            {playing ? 'Pause' : 'Play'}
          </button>
          <button type="button" className="s48-clock__btn" aria-label="Step back one sol" onClick={() => step(-1)}>
            &minus;1
          </button>
          <button type="button" className="s48-clock__btn" aria-label="Step forward one sol" onClick={() => step(1)}>
            +1
          </button>
        </div>

        <input
          className="s48-clock__range"
          type="range"
          min={0}
          max={frameCount - 1}
          step={1}
          value={f}
          aria-label="Sol"
          aria-valuetext={`Mars Year ${year.my}, sol ${sol?.sol ?? ''}`}
          onChange={(e) => {
            setPlaying(false);
            setFrame(Number(e.target.value));
          }}
        />

        <dl className="s48-clock__readout">
          <div className="s48-clock__field">
            <dt>MY</dt>
            <dd>{year.my}</dd>
          </div>
          <div className="s48-clock__field">
            <dt>sol</dt>
            <dd>{sol?.sol}</dd>
          </div>
          <div className="s48-clock__field">
            <dt>Ls</dt>
            <dd>{sol ? Math.round(sol.ls) : ''}</dd>
          </div>
          <div className="s48-clock__field">
            <dt>date</dt>
            <dd>{sol?.earth_date}</dd>
          </div>
        </dl>

        <dl className="s48-clock__readout s48-clock__weather">
          <div className="s48-clock__field">
            <dt>air</dt>
            <dd>
              {day ? (
                <>
                  {fmtC(day.t_min_c)} / {fmtC(day.t_max_c)} °C
                </>
              ) : (
                '–'
              )}
            </dd>
          </div>
          <div className="s48-clock__field">
            <dt>pressure</dt>
            <dd>{day && day.pressure_pa !== null ? `${Math.round(day.pressure_pa)} Pa` : '–'}</dd>
          </div>
        </dl>
    </div>
  );
};
