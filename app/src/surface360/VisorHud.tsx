// Written with AI assistance, directed and reviewed by the team.
// Astronaut visor HUD for the 360° surface view. Everything on it is measured or catalogued:
// the camera from window.marswalkTelemetry (read every frame), the stop's rover pose (PDS PLACES),
// walkability from the pipeline's DEM cost grid, relay passes from the passes.py SPICE bundle,
// distances on the Mars ellipsoid, and the NASA/JPL Photojournal metadata. Where a source does
// not cover the stop, the HUD says so instead of showing a value.
// The wrapper ignores the pointer so the panorama underneath can be dragged; controls opt back in.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { MiniMap } from './MiniMap';
import { formatMetres, geodesicM } from './geodesic';
import { FOV_MAX_DEG, FOV_MIN_DEG, compassPoint, resolveUrl, stopById, wrap360, type PanoramaManifest, type PanoramaStop } from './panoramas';
import { ORBITER_NAMES, isPassBundle, relayStatus, type PassBundle } from './relay';
import type { ReconGround, ReconSite, SurfaceTelemetry } from './SurfaceView';
import { formatClock, formatLatLon } from './visorFormat';
import './VisorHud.css';

interface VisorHudProps {
  stop: PanoramaStop;
  manifest: PanoramaManifest;
  baseUrl: string;
  /** Width of the texture now showing, px (2048 first, then the high-resolution one). */
  textureWidthPx: number | null;
  zoomStepDeg: number;
  onExit: () => void;
  onZoom: (deltaDeg: number) => void;
  /** Step to the previous or next stop on the traverse. */
  onWalk: (stopId: string) => void;
  /** Jump to any stop from the mini-map. */
  onJump: (stopId: string) => void;
}

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

const passCache = new Map<string, Promise<PassBundle | null>>();

/** The stop's SPICE pass bundle and whether it loaded. */
function usePassBundle(stop: PanoramaStop, baseUrl: string): { bundle: PassBundle | null; state: 'none' | 'loading' | 'ready' | 'failed' } {
  const url = stop.passes_url ? resolveUrl(stop.passes_url, baseUrl) : null;
  const [result, setResult] = useState<{ url: string | null; bundle: PassBundle | null }>({ url: null, bundle: null });
  useEffect(() => {
    if (!url) return;
    let live = true;
    let request = passCache.get(url);
    if (!request) {
      request = fetch(url)
        .then((r) => (r.ok ? r.json() : null))
        .then((body: unknown) => (isPassBundle(body) ? body : null))
        .catch(() => null);
      passCache.set(url, request);
    }
    void request.then((bundle) => {
      if (live) setResult({ url, bundle });
    });
    return () => {
      live = false;
    };
  }, [url]);
  if (!url) return { bundle: null, state: 'none' };
  if (result.url !== url) return { bundle: null, state: 'loading' };
  return { bundle: result.bundle, state: result.bundle ? 'ready' : 'failed' };
}

/** Wall clock, ticking once a second, for pass countdowns. */
function useNow(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  return now;
}

const hhmm = (iso: string) => iso.slice(11, 16);

const RelayReadout: React.FC<{ stop: PanoramaStop; baseUrl: string }> = ({ stop, baseUrl }) => {
  const { bundle, state } = usePassBundle(stop, baseUrl);
  const now = useNow();
  if (state === 'none') return <span>NO SPICE PASS BUNDLE FOR THIS SITE</span>;
  if (state === 'loading') return <span>LOADING PASSES…</span>;
  if (!bundle) return <span>PASS BUNDLE DID NOT LOAD</span>;
  const status = relayStatus(bundle, now);
  const where = `SPICE passes above 10° at ${bundle.lat.toFixed(4)}°, ${bundle.lon_east.toFixed(4)}°E (${bundle.site} reference point)`;
  if (status.kind === 'outside-window') {
    return (
      <span title={where}>
        PASSES COMPUTED {status.window.start.slice(0, 10)} – {status.window.end.slice(0, 10)} ONLY
      </span>
    );
  }
  const name = ORBITER_NAMES[status.pass.orbiter] ?? status.pass.orbiter;
  return status.kind === 'overhead' ? (
    <span className="is-live" title={where}>
      {name} IN VIEW · LOS {hhmm(status.pass.set_utc)}Z (T−{formatClock(status.setsInS)})
    </span>
  ) : (
    <span title={where}>
      {name} AOS {hhmm(status.pass.rise_utc)}Z (T−{formatClock(status.risesInS)}) · MAX {Math.round(status.pass.peak_elevation_deg)}°
    </span>
  );
};

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
    <div className="visor-tape" role="img" aria-label={`Camera azimuth ${Math.round(wrap360(heading))} degrees ${compassPoint(heading)}`}>
      <div className="visor-tape__scale">{ticks}</div>
      <div className="visor-tape__caret" aria-hidden="true" />
      <div className="visor-tape__value num">{String(Math.round(wrap360(heading)) % 360).padStart(3, '0')}°</div>
    </div>
  );
};

export const VisorHud: React.FC<VisorHudProps> = ({ stop, manifest, baseUrl, textureWidthPx, zoomStepDeg, onExit, onZoom, onWalk, onJump }) => {
  const telemetryRef = useRef<SurfaceTelemetry | null>(null);
  const telemetry = useTelemetry(telemetryRef);
  const [hidden, setHidden] = useState(false);
  const [metaOpen, setMetaOpen] = useState(true);
  const prev = stopById(manifest, stop.prev_id);
  const next = stopById(manifest, stop.next_id);
  const prevLeg = useMemo(() => (prev ? { geodesic: geodesicM(stop, prev), drive: prev.drive_m_to_next } : null), [stop, prev]);
  const nextLeg = useMemo(() => (next ? { geodesic: geodesicM(stop, next), drive: stop.drive_m_to_next } : null), [stop, next]);

  const azimuth = telemetry?.heading ?? stop.heading;
  const pitch = telemetry?.pitch ?? 0;
  const fov = telemetry?.fov ?? 75;

  // Escape collapses the metadata card first, then leaves the view.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      if (metaOpen) setMetaOpen(false);
      else onExit();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [metaOpen, onExit]);

  const leg = (l: { geodesic: number; drive: number | null }) =>
    `${formatMetres(l.geodesic)}${l.drive !== null ? ` · ${formatMetres(l.drive)} driven` : ''}`;

  return (
    <div className={`visor${hidden ? ' visor--hidden' : ''}`} role="region" aria-label="Astronaut visor HUD">
      <div className="visor__glass" aria-hidden="true" />

      <header className="visor-top visor-hideable">
        <CompassTape heading={azimuth} />
        <div className="visor-telemetry num">
          <span title={stop.sol_source}>
            <b>SOL</b> {stop.sol_source.startsWith('capture date') && '≈'}
            {stop.sol}
            {stop.sol_end !== null && `–${stop.sol_end}`}
            {stop.pose_sol !== null && stop.pose_sol !== stop.sol && <i className="visor-note"> (pose sol {stop.pose_sol})</i>}
          </span>
          <span>
            <b>POS</b> {formatLatLon(stop.lat, stop.lon_east)}
          </span>
          <span>
            <b>ELEV</b> {stop.height !== null ? `${Math.round(stop.height).toLocaleString('en-GB')} m` : 'not published'}
          </span>
          <span>
            <b>AZ</b> {Math.round(wrap360(azimuth))}° <b>EL</b> {pitch >= 0 ? '+' : ''}
            {Math.round(pitch)}° <b>FOV</b> {Math.round(fov)}°
          </span>
        </div>
      </header>

      <aside className="visor-suit">
        <div className="visor-suit__readings visor-hideable num" aria-label="Site status">
          <span>
            <b>RELAY</b> <RelayReadout stop={stop} baseUrl={baseUrl} />
          </span>
          <span title={stop.walkability_source ?? 'No grids.py DEM cost grid covers this stop'}>
            <b>WALK</b>{' '}
            {stop.walkability ? (
              <>
                <span className={`visor-chip visor-chip--${stop.walkability}`}>{stop.walkability}</span>
                {stop.slope_deg !== null && ` ${stop.slope_deg}° slope`}
              </>
            ) : (
              'NO DEM GRID AT STOP'
            )}
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
          {stop.rover} · {stop.instrument} · {stop.pia_id}
        </div>
        <div className="visor-stop__nav">
          <button type="button" className="visor-btn" disabled={!prev} onClick={() => prev && onWalk(prev.id)}>
            &lt; {prev && prevLeg ? `PREV SOL ${prev.sol} · ${leg(prevLeg)}` : 'START OF TRAVERSE'}
          </button>
          <button type="button" className="visor-btn" disabled={!next} onClick={() => next && onWalk(next.id)}>
            {next && nextLeg ? `NEXT SOL ${next.sol} · ${leg(nextLeg)}` : 'END OF TRAVERSE'} &gt;
          </button>
        </div>
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

      <section className={`visor-meta visor-hideable${metaOpen ? ' is-open' : ''}`} aria-label="NASA/JPL mission metadata">
        <button type="button" className="visor-btn visor-meta__toggle" aria-expanded={metaOpen} onClick={() => setMetaOpen((o) => !o)}>
          NASA/JPL Mission Metadata {metaOpen ? '▾' : '▸'}
        </button>
        {metaOpen && (
          <div className="visor-meta__body">
            <dl className="visor-meta__fields num">
              <dt>Catalog</dt>
              <dd>
                <a href={stop.source_url} target="_blank" rel="noreferrer">
                  {stop.pia_id}
                </a>
              </dd>
              <dt>Rover</dt>
              <dd>
                {stop.rover} ({stop.mission})
              </dd>
              <dt>Instrument</dt>
              <dd>{stop.instrument}</dd>
              <dt>Texture</dt>
              <dd>
                {textureWidthPx ? `${textureWidthPx} × ${textureWidthPx / 2} px` : '…'}
                {stop.image_hi_width && textureWidthPx !== null && textureWidthPx < stop.image_hi_width && ` (loading ${stop.image_hi_width} px)`}
              </dd>
              <dt>Sol captured</dt>
              <dd>
                {stop.sol}
                {stop.sol_end !== null && `–${stop.sol_end}`}
                {stop.sol_source !== 'caption' && stop.sol_source !== 'curated from caption' && ` (from the ${stop.sol_source})`}
              </dd>
              <dt>Position</dt>
              <dd>
                {stop.position_source}
              </dd>
            </dl>
            <p className="visor-meta__caption">{stop.caption}</p>
            <p className="visor-meta__credit">Image credit: {stop.credit}</p>
            <p className="visor-meta__note">
              Horizon levelled by {stop.horizon_offset_deg}° ({stop.horizon_source}).{' '}
              {stop.heading_source === 'caption'
                ? `Orientation from the official caption (image centre faces ${Math.round(stop.heading)}°).`
                : stop.heading_source.startsWith('rover yaw')
                  ? `Image centre set to the ${stop.heading_source}; the mosaic's own pointing is not published with the image, so the photo may be rotated relative to the compass.`
                  : 'Neither the caption nor the rover position data gives this mosaic\'s pointing: the image centre is placed at north, so the photo may be rotated relative to the compass.'}
            </p>
          </div>
        )}
      </section>

      <div className="visor-minimap visor-hideable">
        <MiniMap manifest={manifest} stop={stop} telemetryRef={telemetryRef} onSelect={onJump} />
      </div>
    </div>
  );
};

interface ReconHudProps {
  site: ReconSite;
  ground: ReconGround;
  zoomStepDeg: number;
  onExit: () => void;
  onZoom: (deltaDeg: number) => void;
}

/**
 * Visor for orbital recon at a known site with no surface mosaic: the camera stands at eye level
 * on the orbital surface. The badge says plainly that this is orbital data, not a surface photo,
 * and which surface is actually rendered.
 */
export const ReconHud: React.FC<ReconHudProps> = ({ site, ground, zoomStepDeg, onExit, onZoom }) => {
  const telemetryRef = useRef<SurfaceTelemetry | null>(null);
  const telemetry = useTelemetry(telemetryRef);
  const [hidden, setHidden] = useState(false);
  const azimuth = telemetry?.heading ?? 0;
  const pitch = telemetry?.pitch ?? 0;
  const fov = telemetry?.fov ?? 75;

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => event.key === 'Escape' && onExit();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onExit]);

  return (
    <div className={`visor${hidden ? ' visor--hidden' : ''}`} role="region" aria-label="Orbital recon visor">
      <div className="visor__glass" aria-hidden="true" />

      <header className="visor-top visor-hideable">
        <CompassTape heading={azimuth} />
        <div className="visor-telemetry num">
          <span>
            <b>SITE</b> {site.name}
          </span>
          <span>
            <b>POS</b> {formatLatLon(site.lat, site.lon_east)}
          </span>
          <span title="MOLA elevation from the site finder (sites.json)">
            <b>ELEV</b> {site.elevation_m !== null ? `${Math.round(site.elevation_m).toLocaleString('en-GB')} m (MOLA)` : 'not published'}
          </span>
          <span>
            <b>AZ</b> {Math.round(wrap360(azimuth))}° <b>EL</b> {pitch >= 0 ? '+' : ''}
            {Math.round(pitch)}° <b>FOV</b> {Math.round(fov)}°
          </span>
        </div>
      </header>

      <aside className="visor-suit">
        <div className="visor-recon visor-hideable" role="status">
          <strong>SOURCE: ORBITAL DEM RECON (NO SURFACE MOSAIC AT SITE)</strong>
          <span>
            {ground.terrain === 'tiles'
              ? `3D terrain tiles from orbital DEMs cover this site; eye 1.8 m above the tile surface at ${Math.round(ground.groundM).toLocaleString('en-GB')} m.`
              : 'No 3D terrain tiles cover this site, so orbital imagery is draped on the smooth Mars ellipsoid with no relief.'}
          </span>
        </div>
        <div className="visor-controls">
          <button type="button" className="visor-btn" aria-pressed={hidden} onClick={() => setHidden((h) => !h)}>
            {hidden ? '[Show HUD]' : '[Hide HUD]'}
          </button>
          <button type="button" className="visor-btn visor-btn--exit" onClick={onExit}>
            Exit Surface View
          </button>
        </div>
      </aside>

      <div className="visor-zoom visor-hideable" role="group" aria-label="Optical zoom">
        <button type="button" className="visor-btn" aria-label="Zoom in" disabled={fov <= FOV_MIN_DEG + 0.5} onClick={() => onZoom(-zoomStepDeg)}>
          +
        </button>
        <span className="num">{Math.round(fov)}°</span>
        <button type="button" className="visor-btn" aria-label="Zoom out" disabled={fov >= FOV_MAX_DEG - 0.5} onClick={() => onZoom(zoomStepDeg)}>
          −
        </button>
      </div>
    </div>
  );
};
