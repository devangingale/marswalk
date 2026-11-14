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
    <div role="status" className="s48-banner s48-banner--caution">
      <span>
        <strong>Sample data missing:</strong> using offline stub specification for <code>{siteId}</code> (expected at <code>{tilesBase}/{siteId}/site.json</code>).
      </span>
      <span className="standin-tag">Stub specification</span>
    </div>
  );
};
