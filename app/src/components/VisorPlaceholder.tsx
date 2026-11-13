// Written with AI assistance, directed and reviewed by the team.

import React from 'react';

interface VisorPlaceholderProps {
  onReturnToPlan: () => void;
}

export const VisorPlaceholder: React.FC<VisorPlaceholderProps> = ({ onReturnToPlan }) => {
  return (
    <div className="s48-panel s48-visor-placeholder">
      <h2>Visor Mode</h2>
      <p>Helmet visor display view (Phase 4).</p>
      <button type="button" onClick={onReturnToPlan}>
        Return to Plan
      </button>
    </div>
  );
};
