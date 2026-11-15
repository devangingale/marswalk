// Written with AI assistance, directed and reviewed by the team.
// React side of the 360° surface view: loads panoramas.json (falling back to the built-in
// sample stops), owns the SurfaceView on the globe's viewer, and draws the enter popover and,
// while the camera is inside a panorama, the astronaut visor HUD.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { Viewer } from 'cesium';
import { formatDistance, loadManifest, nearestStop, stopById, type LoadedManifest, type LonLat, type PanoramaStop } from './panoramas';
import { SurfaceView, isInSurfaceView } from './SurfaceView';
import { stepsFor } from './steps';
import { VisorHud, type ImageState } from './VisorHud';
import './surface360.css';

/** Fade length for entering and leaving, ms; matches --s360-fade in surface360.css. */
const FADE_MS = 220;
const ZOOM_STEP_DEG = 5;

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
  /** Nearest panorama stop to a point, for the enter popover. */
  nearest: (at: LonLat) => { stop: PanoramaStop; distanceM: number } | null;
  enter: (stopId: string) => void;
  exit: () => void;
  overlay: React.ReactNode;
}

export function useSurface360(viewer: Viewer | null): Surface360 {
  const [loaded, setLoaded] = useState<LoadedManifest | null>(null);
  const [view, setView] = useState<SurfaceView | null>(null);
  const [stop, setStop] = useState<PanoramaStop | null>(null);
  const [imageState, setImageState] = useState<ImageState>('loading');
  const [fading, setFading] = useState(false);
  const [stepFade, setStepFade] = useState(false);
  /** EVA steps walked with < and > since entering the view. */
  const [stepsWalked, setStepsWalked] = useState(0);

  useEffect(() => {
    let live = true;
    void loadManifest().then((m) => {
      if (live) setLoaded(m);
    });
    return () => {
      live = false;
    };
  }, []);

  useEffect(() => {
    if (!viewer) return;
    const created = new SurfaceView(viewer, {
      onStop: (s, state) => {
        setStop(s);
        setImageState(state);
      },
      onWalk: (metres) => setStepsWalked((n) => n + stepsFor(metres)),
      onStepFade: setStepFade,
    });
    setView(created);
    return () => {
      created.destroy();
      setView(null);
      setStop(null);
    };
  }, [viewer]);

  const active = stop !== null;

  const fade = useCallback((then: () => void) => {
    setFading(true);
    window.setTimeout(() => {
      then();
      requestAnimationFrame(() => setFading(false));
    }, FADE_MS);
  }, []);

  const enter = useCallback(
    (stopId: string) => {
      const target = loaded && stopById(loaded.manifest, stopId);
      if (!view || !loaded || !target) return;
      setStepsWalked(0);
      fade(() => view.enter(loaded.manifest, loaded.baseUrl, target));
    },
    [view, loaded, fade],
  );

  const exit = useCallback(() => {
    if (!view?.active) return;
    fade(() => {
      view.exit();
      setStop(null);
    });
  }, [view, fade]);

  // ?pano=<stop id> opens straight into that stop's panorama, like the page's other URL state.
  const deepLinked = useRef(false);
  useEffect(() => {
    if (deepLinked.current || !view || !loaded) return;
    deepLinked.current = true;
    const id = new URLSearchParams(window.location.search).get('pano');
    if (id && stopById(loaded.manifest, id)) enter(id);
  }, [view, loaded, enter]);

  const walk = useCallback((stopId: string) => view?.walk(stopId), [view]);
  const jump = useCallback((stopId: string) => view?.goTo(stopId), [view]);
  const zoom = useCallback((delta: number) => view?.zoomBy(delta), [view]);

  // + / - zoom the lens. Escape is the visor's: it closes the POI drawer first, then exits.
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
          isSample={loaded.isSample}
          imageState={imageState}
          zoomStepDeg={ZOOM_STEP_DEG}
          stepsWalked={stepsWalked}
          onExit={exit}
          onZoom={zoom}
          onWalk={walk}
          onJump={jump}
        />
      )}
    </>
  );

  return { active, ready: !!loaded && !!view, nearest, enter, exit, overlay };
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
            Panorama: {near.stop.name} · {near.distanceM < 5 ? 'here' : `${formatDistance(near.distanceM)} away`}
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
        <div className="s360-popover__meta">Loading panoramas…</div>
      )}
    </div>
  );
};
