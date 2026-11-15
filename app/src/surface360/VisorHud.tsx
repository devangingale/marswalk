// Written with AI assistance, directed and reviewed by the team.
// Astronaut visor HUD for the 360° surface view. It reads the camera from
// window.marswalkTelemetry every frame and opens the science/hazard drawer on
// marswalk:poi-select, so anything else that publishes those (another view, a test) drives it too.
// The wrapper ignores the pointer so the panorama underneath can be dragged; controls opt back in.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { MiniMap } from './MiniMap';
import {
  FOV_MAX_DEG,
  FOV_MIN_DEG,
  compassPoint,
  stopById,
  wrap360,
  type PanoramaManifest,
  type PanoramaPoi,
  type PanoramaStop,
} from './panoramas';
import type { SurfaceTelemetry } from './SurfaceView';
import { formatClock, formatLatLon, parsePass } from './visorFormat';
import { legBetween, legLabel } from './steps';
import './VisorHud.css';

export type ImageState = 'loading' | 'photo' | 'synthetic';

interface VisorHudProps {
  stop: PanoramaStop;
  manifest: PanoramaManifest;
  isSample: boolean;
  imageState: ImageState;
  zoomStepDeg: number;
  /** EVA steps walked with < and > since entering. */
  stepsWalked: number;
  onExit: () => void;
  onZoom: (deltaDeg: number) => void;
  /** Step to the previous or next stop (counts as walked). */
  onWalk: (stopId: string) => void;
  /** Jump to any stop from the mini-map. */
  onJump: (stopId: string) => void;
}

/** Suit readings shown on the visor. Simulated: the demo has no suit link. */
const SUIT = { o2Pct: 94, pressurePsi: 4.3, extC: -62 };

/** Live copy of window.marswalkTelemetry, refreshed each animation frame when it changes. */
function useTelemetry(ref: React.MutableRefObject<SurfaceTelemetry | null>): SurfaceTelemetry | null {
  const [telemetry, setTelemetry] = useState<SurfaceTelemetry | null>(() => window.marswalkTelemetry ?? null);
  useEffect(() => {
    let frame = 0;
    let last = '';
    const tick = () => {
      const t = window.marswalkTelemetry;
      const key = t ? `${t.stop?.id}|${t.heading.toFixed(2)}|${t.pitch.toFixed(2)}|${t.fov.toFixed(2)}` : '';
      if (key !== last) {
        last = key;
        const copy = t ? { ...t } : null;
        ref.current = copy;
        setTelemetry(copy);
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [ref]);
  return telemetry;
}

/** Seconds since the stop was entered, ticking once a second. */
function useSecondsAtStop(stopId: string): number {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    const started = performance.now();
    setElapsed(0);
    const timer = window.setInterval(() => setElapsed((performance.now() - started) / 1000), 1000);
    return () => window.clearInterval(timer);
  }, [stopId]);
  return elapsed;
}

const CompassTape: React.FC<{ heading: number }> = ({ heading }) => {
  // Ticks every 5° across ±75° of the view heading; the tape scrolls continuously.
  const span = 75;
  const first = Math.ceil((heading - span) / 5) * 5;
  const ticks = [];
  for (let deg = first; deg <= heading + span; deg += 5) {
    const bearing = wrap360(deg);
    const left = 50 + ((deg - heading) / (2 * span)) * 100;
    const cardinal = bearing % 45 === 0;
    const labelled = bearing % 15 === 0;
    ticks.push(
      <span key={deg} className={`visor-tape__tick${labelled ? ' is-labelled' : ''}${cardinal ? ' is-cardinal' : ''}`} style={{ left: `${left}%` }}>
        {labelled && <span className="visor-tape__label">{cardinal ? compassPoint(bearing) : String(bearing).padStart(3, '0')}</span>}
      </span>,
    );
  }
  return (
    <div className="visor-tape" role="img" aria-label={`Heading ${Math.round(wrap360(heading))} degrees ${compassPoint(heading)}`}>
      <div className="visor-tape__scale">{ticks}</div>
      <div className="visor-tape__caret" aria-hidden="true" />
      <div className="visor-tape__value num">{String(Math.round(wrap360(heading)) % 360).padStart(3, '0')}°</div>
    </div>
  );
};

export const VisorHud: React.FC<VisorHudProps> = ({ stop, manifest, isSample, imageState, zoomStepDeg, stepsWalked, onExit, onZoom, onWalk, onJump }) => {
  const telemetryRef = useRef<SurfaceTelemetry | null>(null);
  const telemetry = useTelemetry(telemetryRef);
  const [hidden, setHidden] = useState(false);
  const [poi, setPoi] = useState<PanoramaPoi | null>(null);
  const elapsed = useSecondsAtStop(stop.id);
  const pass = useMemo(() => parsePass(stop.next_orbiter_pass), [stop.next_orbiter_pass]);
  const prev = stopById(manifest, stop.prev_id);
  const next = stopById(manifest, stop.next_id);
  const prevLeg = useMemo(() => (prev ? legLabel(legBetween(stop, prev)) : null), [stop, prev]);
  const nextLeg = useMemo(() => (next ? legLabel(legBetween(stop, next)) : null), [stop, next]);

  const heading = telemetry?.heading ?? stop.heading;
  const pitch = telemetry?.pitch ?? 0;
  const fov = telemetry?.fov ?? 75;

  // The drawer follows marswalk:poi-select from any source, and closes on a new stop.
  useEffect(() => {
    const onSelect = (event: CustomEvent<PanoramaPoi>) => setPoi(event.detail);
    window.addEventListener('marswalk:poi-select', onSelect);
    return () => window.removeEventListener('marswalk:poi-select', onSelect);
  }, []);
  useEffect(() => setPoi(null), [stop.id]);

  // Escape closes the drawer first, then leaves the view.
  const poiOpen = poi !== null;
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      if (poiOpen) setPoi(null);
      else onExit();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [poiOpen, onExit]);

  const remaining = pass ? pass.seconds - elapsed : null;
  const poiKind = poi?.type.toLowerCase() === 'hazard' ? 'hazard' : 'science';

  return (
    <div className={`visor${hidden ? ' visor--hidden' : ''}`} role="region" aria-label="Astronaut visor HUD">
      <div className="visor__glass" aria-hidden="true" />

      <header className="visor-top visor-hideable">
        <CompassTape heading={heading} />
        <div className="visor-telemetry num">
          <span>
            <b>POS</b> {formatLatLon(stop.lat, stop.lon_east)}
          </span>
          <span>
            <b>SOL</b> {String(stop.sol).padStart(4, '0')}
          </span>
          <span className={remaining !== null && remaining <= 0 ? 'is-live' : undefined}>
            <b>RELAY</b>{' '}
            {pass ? (remaining! > 0 ? `${pass.orbiter} AOS T−${formatClock(remaining!)}` : `${pass.orbiter} IN CONTACT`) : 'NO PASS SCHEDULED'}
            <i className="visor-sim">SIM</i>
          </span>
        </div>
      </header>

      <aside className="visor-suit">
        <div className="visor-suit__readings visor-hideable num" aria-label="Suit status (simulated)">
          <span>
            <b>O2</b> {SUIT.o2Pct}%
          </span>
          <span>
            <b>SUIT</b> {SUIT.pressurePsi.toFixed(1)} PSI
          </span>
          <span>
            <b>EXT</b> {SUIT.extC}°C
          </span>
          <i className="visor-sim">SIM</i>
          <span className="visor-suit__steps" aria-live="polite">
            <b>STEPS</b> {stepsWalked.toLocaleString('en-GB')}
          </span>
        </div>
        <div className="visor-controls">
          <button type="button" className="visor-btn" aria-pressed={hidden} onClick={() => setHidden((h) => !h)}>
            {hidden ? '[Show HUD]' : '[Hide HUD]'}
          </button>
          <button type="button" className="visor-btn visor-btn--exit" onClick={onExit}>
            Exit 360° View
          </button>
        </div>
      </aside>

      <section className="visor-stop visor-hideable" aria-label="Stop">
        <div className="visor-stop__name">{stop.name}</div>
        <div className="visor-stop__row">
          <span className={`visor-chip visor-chip--${stop.walkability}`}>{stop.walkability}</span>
          <span className="num">
            HDG {Math.round(wrap360(heading))}° · PITCH {pitch >= 0 ? '+' : ''}
            {Math.round(pitch)}° · FOV {Math.round(fov)}°
          </span>
        </div>
        <div className="visor-stop__nav">
          <button type="button" className="visor-btn" disabled={!prev} onClick={() => prev && onWalk(prev.id)}>
            &lt; {prev ? `PREV SOL ${prev.sol} · ${prevLeg}` : 'START OF TRAVERSE'}
          </button>
          <button type="button" className="visor-btn" disabled={!next} onClick={() => next && onWalk(next.id)}>
            {next ? `NEXT SOL ${next.sol} · ${nextLeg}` : 'END OF TRAVERSE'} &gt;
          </button>
        </div>
        {(imageState !== 'photo' || isSample) && (
          <p className="visor-stop__note">
            {imageState === 'loading' ? 'Loading panorama… ' : imageState === 'synthetic' ? 'No photo: synthetic horizon. ' : ''}
            {isSample ? 'Sample stops (panoramas.json not loaded).' : ''}
          </p>
        )}
      </section>

      <div className="visor-zoom visor-hideable" role="group" aria-label="Optical zoom">
        <button type="button" className="visor-btn" aria-label="Zoom in" disabled={fov <= FOV_MIN_DEG + 0.5} onClick={() => onZoom(-zoomStepDeg)}>
          +
        </button>
        <span className="num">{Math.round(fov)}°</span>
        <button type="button" className="visor-btn" aria-label="Zoom out" disabled={fov >= FOV_MAX_DEG - 0.5} onClick={() => onZoom(zoomStepDeg)}>
          −
        </button>
      </div>

      <section className={`visor-drawer visor-hideable${poi ? ' is-open' : ''}`} aria-label="Point of interest" aria-hidden={!poi}>
        {poi && (
          <>
            <div className="visor-drawer__head">
              <span className={`visor-chip visor-chip--${poiKind}`}>{poi.type}</span>
              <button type="button" className="visor-btn visor-drawer__close" aria-label="Close" onClick={() => setPoi(null)}>
                ×
              </button>
            </div>
            <h2 className="visor-drawer__title">{poi.title}</h2>
            <p className="visor-drawer__detail">{poi.detail}</p>
            <div className="visor-drawer__meta num">
              BRG {Math.round(wrap360(poi.heading))}° {compassPoint(poi.heading)} · EL {poi.pitch >= 0 ? '+' : ''}
              {Math.round(poi.pitch)}°
            </div>
          </>
        )}
      </section>

      <div className="visor-minimap visor-hideable">
        <MiniMap manifest={manifest} stop={stop} telemetryRef={telemetryRef} onSelect={onJump} />
      </div>
    </div>
  );
};
