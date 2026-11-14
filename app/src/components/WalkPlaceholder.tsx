// Written with AI assistance, directed and reviewed by the team.

import React from 'react';

interface WalkPlaceholderProps {
  onReturnToPlan: () => void;
}

export const WalkPlaceholder: React.FC<WalkPlaceholderProps> = ({ onReturnToPlan }) => {
  return (
    <div
      className="panel"
      style={{
        padding: 'var(--space-6)',
        display: 'grid',
        placeContent: 'center',
        textAlign: 'center',
        gap: 'var(--space-4)',
        height: '100%',
      }}
    >
      <h2>Walk mode</h2>
      <p className="muted">Tablet field navigation view (Phase 4).</p>
      <div>
        <button
          type="button"
          className="s48-btn s48-btn--primary"
          onClick={onReturnToPlan}
        >
          Return to Plan
        </button>
      </div>
    </div>
  );
};
