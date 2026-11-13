// Written with AI assistance, directed and reviewed by the team.

import React from 'react';

interface WalkPlaceholderProps {
  onReturnToPlan: () => void;
}

export const WalkPlaceholder: React.FC<WalkPlaceholderProps> = ({ onReturnToPlan }) => {
  return (
    <div className="s48-panel s48-walk-placeholder">
      <h2>Walk Mode</h2>
      <p>Tablet field navigation view (Phase 4).</p>
      <button type="button" onClick={onReturnToPlan}>
        Return to Plan
      </button>
    </div>
  );
};
