// Written with AI assistance, directed and reviewed by the team.

import React from 'react';

interface SiteSwitcherProps {
  availableSites: string[];
  currentSite: string;
  onSiteChange: (siteId: string) => void;
  siteTitle?: string;
}

export const SiteSwitcher: React.FC<SiteSwitcherProps> = ({
  availableSites,
  currentSite,
  onSiteChange,
  siteTitle,
}) => {
  return (
    <div className="s48-site-switcher">
      <label htmlFor="s48-site-select" className="s48-site-label">Site: </label>
      <select
        id="s48-site-select"
        className="s48-site-select"
        value={currentSite}
        onChange={(e) => onSiteChange(e.target.value)}
      >
        {availableSites.map((site) => (
          <option key={site} value={site}>
            {site.toUpperCase()}
          </option>
        ))}
      </select>
      {siteTitle && <span className="s48-site-title"> {siteTitle}</span>}
    </div>
  );
};
