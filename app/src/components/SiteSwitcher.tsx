// Written with AI assistance, directed and reviewed by the team.

import React from 'react';

interface SiteSwitcherProps {
  availableSites: string[];
  currentSite: string;
  onSiteChange: (siteId: string) => void;
  siteTitle?: string;
  roverName?: string;
}

export const SiteSwitcher: React.FC<SiteSwitcherProps> = ({
  availableSites,
  currentSite,
  onSiteChange,
  siteTitle,
  roverName,
}) => {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
      <label
        htmlFor="site-select"
        style={{
          fontSize: '11px',
          fontWeight: 600,
          color: '#94a3b8',
          textTransform: 'uppercase',
          letterSpacing: '0.05em',
        }}
      >
        Site:
      </label>
      <select
        id="site-select"
        value={currentSite}
        onChange={(e) => onSiteChange(e.target.value)}
        style={{
          backgroundColor: '#0f172a',
          color: '#f8fafc',
          border: '1px solid #334155',
          borderRadius: '4px',
          padding: '6px 10px',
          fontSize: '13px',
          fontWeight: 500,
          cursor: 'pointer',
          outline: 'none',
        }}
      >
        {availableSites.map((site) => (
          <option key={site} value={site}>
            {site.toUpperCase()}
          </option>
        ))}
      </select>
      {siteTitle && (
        <span
          style={{
            fontSize: '12px',
            color: '#cbd5e1',
            maxWidth: '220px',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
          title={siteTitle}
        >
          {siteTitle} {roverName ? `(${roverName})` : ''}
        </span>
      )}
    </div>
  );
};
