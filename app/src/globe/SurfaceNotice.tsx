// Written with AI assistance, directed and reviewed by the team.
import React, { useState } from 'react';
import { cesiumFailureMessage, type CesiumFailure } from './cesiumSetup';
import { setSurfaceMode } from './surfaceMode';
import './surfaceNotice.css';

/**
 * Shown over the map when online is chosen but Cesium Mars did not load. Our own layers keep
 * working on the plain globe underneath; the notice stays until dismissed or Offline is chosen.
 */
export const SurfaceNotice: React.FC<{
  failure: CesiumFailure | null;
  /** 'low' keeps it clear of readouts along the top edge (Visor). */
  placement?: 'top' | 'low';
}> = ({ failure, placement = 'top' }) => {
  const [dismissed, setDismissed] = useState<CesiumFailure | null>(null);
  if (!failure || dismissed === failure) return null;
  return (
    <div className={`s48-surface-notice${placement === 'low' ? ' s48-surface-notice--low' : ''}`} role="alert" data-over-map>
      <span className="s48-surface-notice__text">{cesiumFailureMessage(failure)}</span>
      <button type="button" className="s48-btn s48-btn--primary s48-surface-notice__action" onClick={() => setSurfaceMode('offline')}>
        Use offline view
      </button>
      <button type="button" className="s48-btn s48-btn--icon s48-surface-notice__close" aria-label="Dismiss" title="Dismiss" onClick={() => setDismissed(failure)}>
        ×
      </button>
    </div>
  );
};
