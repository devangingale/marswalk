// Written with AI assistance, directed and reviewed by the team.

import React from 'react';

interface NoticeBannerProps {
  isSampleFallback: boolean;
  siteId: string;
  tilesBase: string;
}

export const NoticeBanner: React.FC<NoticeBannerProps> = ({
  isSampleFallback,
  siteId,
  tilesBase,
}) => {
  if (!isSampleFallback) return null;

  return (
    <div
      role="status"
      style={{
        backgroundColor: '#78350f',
        color: '#fef3c7',
        borderBottom: '1px solid #b45309',
        padding: '8px 16px',
        fontSize: '13px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        zIndex: 50,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        <span
          style={{
            display: 'inline-block',
            width: '8px',
            height: '8px',
            borderRadius: '50%',
            backgroundColor: '#f59e0b',
          }}
        />
        <strong>Sample data missing:</strong>
        <span>
          Using offline stub specification for <code>{siteId}</code> (expected at <code>{tilesBase}/{siteId}/site.json</code>).
        </span>
      </div>
      <span style={{ fontSize: '11px', opacity: 0.85, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
        Phase 3 Shell Fallback Active
      </span>
    </div>
  );
};
