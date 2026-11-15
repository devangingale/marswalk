// Written with AI assistance, directed and reviewed by the team.
// React side of the 360° surface view: loads panoramas.json (from pipeline/build_panoramas.py),
// owns the SurfaceView on the globe's viewer, and draws the enter popover and, while the camera
// is inside a panorama, the astronaut visor HUD. There is no fallback content: if the manifest
// or a photo does not load, the popover or a notice says so.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { Viewer } from 'cesium';
import { formatMetres } from './geodesic';
import { loadManifest, nearestStop, stopById, type LoadedManifest, type LonLat, type PanoramaStop } from './panoramas';
import { SurfaceView, isInSurfaceView, type ReconGround, type ReconSite } from './SurfaceView';
import { ReconHud, VisorHud } from './VisorHud';
import './surface360.css';

/** Fade length for entering and leaving, ms; matches --s360-fade in surface360.css. */
const FADE_MS = 220;
const ZOOM_STEP_DEG = 5;
const NOTICE_MS = 6000;
/** A known site counts as having a surface mosaic when a panorama stop is this close, metres. */
export const MOSAIC_RADIUS_M = 2000;

export interface EnterCandidate {
  /** Screen position of the click, relative to the map container. */
  x: number;
  y: number;
  title: string;
  at: LonLat;
}

export interface Surface360 {
  active: boolean;
  ready: boolean;
  /** Why panoramas are unavailable, when the manifest failed to load. */
  unavailable: string | null;
  /** Nearest panorama stop to a point, for the enter popover. */
  nearest: (at: LonLat) => { stop: PanoramaStop; distanceM: number } | null;
  enter: (stopId: string) => void;
  /** Eye-level view on the orbital surface at a site with no surface mosaic. */
  enterRecon: (site: ReconSite) => void;
  exit: () => void;
  overlay: React.ReactNode;
}

export function useSurface360(viewer: Viewer | null): Surface360 {
  const [loaded, setLoaded] = useState<LoadedManifest | null>(null);
  const [unavailable, setUnavailable] = useState<string | null>(null);
  const [view, setView] = useState<SurfaceView | null>(null);
  const [stop, setStop] = useState<PanoramaStop | null>(null);
  const [recon, setRecon] = useState<{ site: ReconSite; ground: ReconGround } | null>(null);
  const [fading, setFading] = useState(false);
  const [stepFade, setStepFade] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [texture, setTexture] = useState<{ stopId: string; widthPx: number; final: boolean } | null>(null);

  useEffect(() => {
    let live = true;
    loadManifest()
      .then((m) => live && setLoaded(m))
      .catch((error: unknown) => {
        if (!live) return;
        const message = error instanceof Error ? error.message : String(error);
        console.warn('360° surface view unavailable:', message);
        setUnavailable(message);
      });
    return () => {
      live = false;
    };
  }, []);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), NOTICE_MS);
    return () => window.clearTimeout(timer);
  }, [notice]);

  useEffect(() => {
    if (!viewer) return;
    const created = new SurfaceView(viewer, {
      onStop: (s) => {
        setStop(s);
        setRecon(null);
      },
      onRecon: (site, ground) => {
        setRecon({ site, ground });
        setStop(null);
      },
      onError: setNotice,
      onTexture: (s, widthPx, final) => setTexture({ stopId: s.id, widthPx, final }),
      onStepFade: setStepFade,
    });
    setView(created);
    return () => {
      created.destroy();
      setView(null);
      setStop(null);
      setRecon(null);
    };
  }, [viewer]);

  const active = stop !== null || recon !== null;

  const enter = useCallback(
    (stopId: string) => {
      const target = loaded && stopById(loaded.manifest, stopId);
      if (!view || !loaded || !target) return;
      // The photo loads first (the screen dims meanwhile); only then does the orbital view fade out.
      setFading(true);
      void view.enter(loaded.manifest, loaded.baseUrl, target).then(() => {
        window.setTimeout(() => setFading(false), FADE_MS);
      });
    },
    [view, loaded],
  );

  const enterRecon = useCallback(
    (site: ReconSite) => {
      if (!view || view.active) return;
      setFading(true);
      void view.enterRecon(site).then(() => window.setTimeout(() => setFading(false), FADE_MS));
    },
    [view],
  );

  const exit = useCallback(() => {
    if (!view?.active) return;
    setFading(true);
    window.setTimeout(() => {
      view.exit();
      setStop(null);
      setRecon(null);
      requestAnimationFrame(() => setFading(false));
    }, FADE_MS);
  }, [view]);

  // ?pano=<stop id> opens straight into that stop's panorama, like the page's other URL state.
  const deepLinked = useRef(false);
  useEffect(() => {
    if (deepLinked.current || !view || !loaded) return;
    deepLinked.current = true;
    const id = new URLSearchParams(window.location.search).get('pano');
    if (id && stopById(loaded.manifest, id)) enter(id);
  }, [view, loaded, enter]);

  const walk = useCallback((stopId: string) => void view?.walk(stopId), [view]);
  const jump = useCallback((stopId: string) => void view?.goTo(stopId), [view]);
  const zoom = useCallback((delta: number) => view?.zoomBy(delta), [view]);

  // + / - zoom the lens. Escape is the visor's: it collapses the metadata card first, then exits.
  useEffect(() => {
    if (!active) return;
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))) return;
      if (event.key === '+' || event.key === '=' || event.key === 'Add') {
        zoom(-ZOOM_STEP_DEG);
        event.preventDefault();
      } else if (event.key === '-' || event.key === '_' || event.key === 'Subtract') {
        zoom(ZOOM_STEP_DEG);
        event.preventDefault();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [active, zoom]);

  const nearest = useCallback((at: LonLat) => (loaded ? nearestStop(loaded.manifest, at) : null), [loaded]);

  // The visor exists only while the camera is locked inside a panorama.
  const inside = !!viewer && !viewer.isDestroyed() && isInSurfaceView(viewer);
  const overlay = (
    <>
      <div className={`s360-fade${fading ? ' is-on' : ''}`} aria-hidden="true" />
      <div className={`s360-step${stepFade ? ' is-on' : ''}`} aria-hidden="true" />
      {inside && stop && loaded && (
        <VisorHud
          stop={stop}
          manifest={loaded.manifest}
          baseUrl={loaded.baseUrl}
          textureWidthPx={texture?.stopId === stop.id ? texture.widthPx : null}
          textureFinal={texture?.stopId === stop.id && texture.final}
          zoomStepDeg={ZOOM_STEP_DEG}
          onExit={exit}
          onZoom={zoom}
          onWalk={walk}
          onJump={jump}
        />
      )}
      {inside && recon && <ReconHud site={recon.site} ground={recon.ground} zoomStepDeg={ZOOM_STEP_DEG} onExit={exit} onZoom={zoom} />}
      {notice && (
        <div className="s360-notice" role="alert">
          {notice}
        </div>
      )}
    </>
  );

  return { active, ready: !!loaded && !!view, unavailable, nearest, enter, enterRecon, exit, overlay };
}

/** The popover on a clicked waypoint or rover marker. */
export const EnterSurfacePopover: React.FC<{
  candidate: EnterCandidate;
  surface: Surface360;
  onClose: () => void;
}> = ({ candidate, surface, onClose }) => {
  const near = surface.nearest(candidate.at);
  return (
    <div className="s360-popover" style={{ left: candidate.x, top: candidate.y }} role="dialog" aria-label={candidate.title} data-over-map>
      <div className="s360-popover__head">
        <span className="s360-popover__title">{candidate.title}</span>
        <button type="button" className="s360-popover__close" aria-label="Close" onClick={onClose}>
          ×
        </button>
      </div>
      {near ? (
        <>
          <div className="s360-popover__meta">
            {near.stop.pia_id} · {near.stop.rover} sol {near.stop.sol} · {near.distanceM < 5 ? 'here' : `${formatMetres(near.distanceM)} away`}
          </div>
          <button
            type="button"
            className="s48-btn s48-btn--primary s360-enter"
            disabled={!surface.ready}
            onClick={() => {
              surface.enter(near.stop.id);
              onClose();
            }}
          >
            Enter 360° Surface View
          </button>
        </>
      ) : (
        <div className="s360-popover__meta">{surface.unavailable ? `360° view unavailable: ${surface.unavailable}` : 'Loading panoramas…'}</div>
      )}
    </div>
  );
};
