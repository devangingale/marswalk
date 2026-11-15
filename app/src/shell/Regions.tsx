// Written with AI assistance, directed and reviewed by the team.
// The one layout every tab uses: left panel, map, right panel, time bar under the map,
// small map controls top-right. Both side panels collapse; below OVERLAY_BELOW_PX an open
// panel slides over the map instead of narrowing it.
import React, { useCallback, useEffect, useId, useState, type ReactNode } from 'react';
import { OVERLAY_BELOW_PX, readPanels, togglePanel, writePanels, type PanelState, type Side } from './regions';
import './regions.css';

export interface RegionsProps {
  /** Tab id; panel open/closed state is remembered per id. */
  id: string;
  main: ReactNode;
  left?: ReactNode;
  leftLabel?: string;
  right?: ReactNode;
  rightLabel?: string;
  /** Small buttons over the map, top-right (3D relief, whole planet). */
  controls?: ReactNode;
  /** Bar under the map: the clock in Explore, playback in Walk and Visor. */
  time?: ReactNode;
  /** Visor: full-bleed view with no side panels. */
  bare?: boolean;
}

const storage = (): Storage | null => {
  try { return window.localStorage; } catch { return null; }
};

const useOverlay = () => {
  const query = `(max-width: ${OVERLAY_BELOW_PX - 1}px)`;
  const [overlay, setOverlay] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const list = window.matchMedia(query);
    const update = () => setOverlay(list.matches);
    list.addEventListener('change', update);
    return () => list.removeEventListener('change', update);
  }, [query]);
  return overlay;
};

const Chevron: React.FC<{ pointing: Side }> = ({ pointing }) => (
  <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true" focusable="false">
    <path d={pointing === 'left' ? 'M7.5 2.5 4 6l3.5 3.5' : 'M4.5 2.5 8 6 4.5 9.5'} fill="none" stroke="currentColor" strokeWidth="1.5" />
  </svg>
);

export const Regions: React.FC<RegionsProps> = ({ id, main, left, leftLabel = 'Panel', right, rightLabel = 'Details', controls, time, bare = false }) => {
  const overlay = useOverlay();
  const [panels, setPanels] = useState<PanelState>(() => readPanels(id, window.innerWidth, storage()));
  const leftId = useId();
  const rightId = useId();

  useEffect(() => { setPanels(readPanels(id, window.innerWidth, storage())); }, [id]);

  const toggle = useCallback((side: Side) => {
    setPanels((current) => {
      const next = togglePanel(current, side, overlay);
      writePanels(id, next, storage());
      return next;
    });
  }, [id, overlay]);

  const hasLeft = !bare && left !== undefined;
  const hasRight = !bare && right !== undefined;
  const leftOpen = hasLeft && panels.left;
  const rightOpen = hasRight && panels.right;

  const handle = (side: Side, open: boolean, label: string, controlsId: string) => (
    <button
      type="button"
      className={`s48-regions__handle s48-regions__handle--${side}`}
      aria-expanded={open}
      aria-controls={controlsId}
      aria-label={`${open ? 'Hide' : 'Show'} ${label.toLowerCase()}`}
      title={`${open ? 'Hide' : 'Show'} ${label.toLowerCase()}`}
      onClick={() => toggle(side)}
    >
      <Chevron pointing={(side === 'left') === open ? 'left' : 'right'} />
      {!open && <span className="s48-regions__handle-label">{label}</span>}
    </button>
  );

  return (
    <div
      className="s48-regions"
      data-overlay={overlay ? 'true' : 'false'}
      data-left={leftOpen ? 'open' : 'closed'}
      data-right={rightOpen ? 'open' : 'closed'}
      data-bare={bare ? 'true' : 'false'}
    >
      {hasLeft && (
        <aside id={leftId} className="s48-regions__panel s48-regions__panel--left" aria-label={leftLabel} hidden={!leftOpen}>
          {left}
        </aside>
      )}
      <div className="s48-regions__centre">
        <div className="s48-regions__main">
          {main}
          {hasLeft && handle('left', leftOpen, leftLabel, leftId)}
          {hasRight && handle('right', rightOpen, rightLabel, rightId)}
          {controls && <div className="s48-regions__controls" data-over-map>{controls}</div>}
        </div>
        {time && <div className="s48-regions__time">{time}</div>}
      </div>
      {hasRight && (
        <aside id={rightId} className="s48-regions__panel s48-regions__panel--right" aria-label={rightLabel} hidden={!rightOpen}>
          {right}
        </aside>
      )}
    </div>
  );
};
