// Written with AI assistance, directed and reviewed by the team.

import React from 'react';

interface VisorPlaceholderProps {
  onReturnToPlan: () => void;
}

export const VisorPlaceholder: React.FC<VisorPlaceholderProps> = ({ onReturnToPlan }) => {
  return (
    <div
      data-theme="dark"
      style={{
        background: '#0b0d10',
        color: 'var(--visor-text)',
        width: '100%',
        height: '100%',
        display: 'grid',
        placeContent: 'center',
        textAlign: 'center',
        gap: 'var(--space-4)',
        padding: 'var(--space-6)',
      }}
    >
      <h2>Visor mode</h2>
      <p style={{ color: 'var(--visor-text-muted)' }}>Helmet visor display view (Phase 4).</p>
      <div>
        <button
          type="button"
          className="s48-btn s48-btn--secondary"
          onClick={onReturnToPlan}
        >
          Return to Plan
        </button>
      </div>
    </div>
  );
};
