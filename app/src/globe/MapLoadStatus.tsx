import React, { useEffect, useState } from 'react';
import { mapLoadView, type MapLoadState } from './loadProgress';
import './mapLoadStatus.css';

export const MapLoadStatus: React.FC<{ state: MapLoadState }> = ({ state }) => {
  const view = mapLoadView(state);
  const [visible, setVisible] = useState(true);
  useEffect(() => { if (view.showOverlay) setVisible(true); }, [view.showOverlay]);
  return <>
    {(view.showOverlay || visible) && <div className={`s48-map-load${view.showOverlay ? '' : ' is-fading'}`} role="status" aria-live="polite" aria-hidden={!view.showOverlay} onAnimationEnd={() => { if (!view.showOverlay) setVisible(false); }}>
      <div className="s48-map-load__panel">
        <span className="s48-map-load__line">{view.line}</span>
        <progress className="s48-map-load__progress" max={100} value={view.percent} aria-label="Map loading progress" />
        {view.failureLine && <span className="s48-map-load__failure">{view.failureLine}</span>}
      </div>
    </div>}
    {!view.showOverlay && view.failureLine && <span className="s48-map-load-error" role="status">{view.failureLine}</span>}
    {view.showSpinner && <span className="s48-map-stream" role="status" aria-label="Map tiles loading" />}
  </>;
};
